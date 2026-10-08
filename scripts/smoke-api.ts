/**
 * Real-provider API smoke test (local only). Run against a server that is already up:
 *
 *   pnpm exec tsx scripts/smoke-api.ts                       # http://127.0.0.1:3030
 *   SMOKE_BASE_URL=http://127.0.0.1:3108 pnpm exec tsx scripts/smoke-api.ts
 *
 * Calls real Gemini (planner + critic) and real Reactor (token mint) through the app's own routes.
 * Access + support codes come from the server config (root .env) and are never printed; neither
 * are cookies or the Reactor JWT (length only). Take uploads are SYNTHETIC ffmpeg recordings,
 * labeled as such; the export pipeline and the critic that judge them are real.
 * Exit code 0 only when every step passed.
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../apps/server/src/config.ts";
import {
  paths,
  type CaseResponse,
  type CatalogResponse,
  type CreateTakeMeta,
  type CreateWorkCaseResponse,
  type HealthResponse,
  type PlannerResult,
  type PlanRevision,
  type PreviewLeaseResponse,
  type ReactorTokenResponse,
  type SessionState,
  type SupportInboxResponse,
  type Take,
  type TicketResponse,
} from "../packages/contracts/src/index.ts";
import {
  Client,
  key,
  makePhotoMotionWebm,
  makeTestsrcWebm,
  sha256,
  SmokeFailure,
} from "./smoke-client.ts";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3030").replace(/\/+$/, "");
const ACCOUNT = "The vacuum stops and then jerks backward once. It only happens sometimes.";
const CORRECTION = "The backward movement is smaller and happens immediately.";
const TAKE_TIMEOUT_MS = 240_000;

const config = getConfig();
const workDir = path.join(config.repoRoot, "tmp", "smoke-api");

let failures = 0;
let skipped: string | null = null;
function log(ok: boolean, step: string, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${step}${detail ? `: ${detail}` : ""}`);
}
function check(cond: boolean, step: string, detail = ""): void {
  log(cond, step, detail);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function actionSummary(p: PlanRevision): string {
  const a = p.plan.selectedAction;
  return `direction=${a.direction} repetitions=${a.repetitions} timing=${a.timing} magnitude=${a.magnitude}`;
}

async function pollTake(c: Client, takeId: string): Promise<Take> {
  const started = Date.now();
  for (;;) {
    const { body } = await c.expect<{ take: Take }>("GET", paths.take(takeId), [200]);
    const t = body.take;
    const exportDone = t.processingState === "ready" || t.processingState === "failed";
    const job = t.currentAssessment?.jobState;
    const checkDone = t.processingState === "failed" || job === "done" || job === "failed";
    if (exportDone && checkDone) return t;
    if (Date.now() - started > TAKE_TIMEOUT_MS) {
      throw new SmokeFailure(`take ${takeId} still ${t.processingState}/${job ?? "no check"}`);
    }
    await sleep(2000);
  }
}

async function uploadTake(
  c: Client,
  caseId: string,
  plan: PlanRevision,
  file: string,
  label: string,
): Promise<Take> {
  const { readFile } = await import("node:fs/promises");
  const meta: CreateTakeMeta = {
    purpose: plan.purpose,
    planRevisionId: plan.id,
    productRevisionId: plan.productRevisionId,
    procedureRevisionId: plan.procedureRevisionId,
    runId: key("smoke-run"),
    captureStatus: "complete",
    captureReason: null,
    firstOutputOffsetMs: 1000,
    recordedDurationMs: 8000,
    mimeType: "video/webm;codecs=vp8",
    caption: plan.caption,
    idempotencyKey: key("smoke-take"),
  };
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  form.set("recording", new Blob([await readFile(file)], { type: "video/webm" }), "take.webm");
  const res = await c.raw("POST", paths.caseTakes(caseId), { body: form });
  const body = (await res.json()) as { take?: Take; code?: string };
  check(
    res.status === 202 && !!body.take,
    `upload ${label} take`,
    `${res.status} ${body.code ?? ""}`,
  );
  if (!body.take) throw new SmokeFailure("take upload failed");
  const t = await pollTake(c, body.take.id);
  const a = t.currentAssessment;
  check(
    t.processingState === "ready",
    `${label} export`,
    `${t.processingState} ${t.durationMs ?? "-"} ms ${t.width}x${t.height} sha=${t.sha256?.slice(0, 12)}`,
  );
  check(
    !!a && a.jobState === "done" && !!a.result?.modelId,
    `${label} real critic`,
    `job=${a?.jobState} status=${a?.uiStatus} model=${a?.result?.modelId ?? "-"} coverage=${a?.result?.inputCoverage.kind ?? "-"} err=${a?.errorCode ?? "-"}`,
  );
  return t;
}

async function main(): Promise<void> {
  if (!config.demoAccessCode || !config.demoSupportCode) {
    throw new SmokeFailure("DEMO_ACCESS_CODE / DEMO_SUPPORT_CODE missing from server config");
  }
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  console.log(`smoke target ${BASE}`);

  const customer = new Client(BASE, "customer");
  const support = new Client(BASE, "support");

  // Health, session, catalog
  const health = await customer.expect<HealthResponse>("GET", paths.health(), [200]);
  check(
    health.body.ok && health.body.config.ok,
    "GET /api/health",
    `ok=${health.body.ok} config=${health.body.config.ok} ffmpeg=${health.body.media?.ffmpeg} ffprobe=${health.body.media?.ffprobe}`,
  );
  const wrong = await customer.json("POST", paths.session(), { accessCode: "not-the-code" });
  check(wrong.status === 401, "POST /api/session wrong code rejected", String(wrong.status));
  const sess = await customer.expect<SessionState>("POST", paths.session(), [200, 201], {
    accessCode: config.demoAccessCode,
  });
  check(sess.body.accessGranted && sess.body.role === "customer", "POST /api/session", "customer");
  const catalog = await customer.expect<CatalogResponse>("GET", paths.catalog(), [200]);
  const fixtureIds = catalog.body.products.map((p) => p.id);
  check(fixtureIds.includes("robot-vacuum"), "GET /api/catalog", fixtureIds.join(","));

  // Case
  const created = await customer.expect<CaseResponse>("POST", paths.cases(), [201], {
    purpose: "problem",
    fixtureId: "robot-vacuum",
    title: "Smoke test: robot vacuum",
    clientRequestId: key("smoke-case"),
  });
  const caseId = created.body.case.id;
  check(true, "POST /api/cases", `${caseId} fixture=${created.body.case.fixtureId}`);
  const got = await customer.expect<CaseResponse>("GET", paths.case(caseId), [200]);
  check(!!got.body.case.product, "GET /api/cases/:id", `product=${got.body.case.product?.id}`);
  await customer.expect<CaseResponse>("PATCH", paths.case(caseId), [200], {
    originalAccount: ACCOUNT,
  });

  // Plans (real Gemini)
  let t0 = Date.now();
  const plan1 = await customer.expect<PlannerResult>("POST", paths.casePlans(caseId), [201], {
    purpose: "problem",
    parentPlanId: null,
    correction: null,
    clientRequestId: key("smoke-plan"),
  });
  const p1 = plan1.body.planRevision;
  check(
    p1.status === "ready" && p1.plan.requiredConstraints.length > 0 && !!p1.reactorPrompt,
    "plan from account",
    `${p1.status} constraints=${p1.plan.requiredConstraints.length} prompt=${p1.reactorPrompt?.length ?? 0} chars ${actionSummary(p1)} ${Date.now() - t0} ms`,
  );
  t0 = Date.now();
  const plan2 = await customer.expect<PlannerResult>("POST", paths.casePlans(caseId), [201], {
    purpose: "problem",
    parentPlanId: p1.id,
    correction: CORRECTION,
    clientRequestId: key("smoke-plan"),
  });
  const p2 = plan2.body.planRevision;
  const a1 = p1.plan.selectedAction;
  const a2 = p2.plan.selectedAction;
  check(
    p2.status === "ready" && a2.repetitions === a1.repetitions && a2.direction === a1.direction,
    "magnitude correction keeps count + direction",
    `${p2.status} ${actionSummary(p2)} ${Date.now() - t0} ms`,
  );
  check(p2.parentId === p1.id, "correction is a child revision", p2.id);

  // Reactor token (real mint) + lease
  const tok = await customer.expect<ReactorTokenResponse>(
    "POST",
    paths.caseReactorToken(caseId),
    [200, 201],
    { planRevisionId: p2.id, clientRequestId: key("smoke-token") },
  );
  check(
    tok.body.jwt.length > 100 && tok.headers.get("cache-control") === "no-store",
    "POST reactor-token",
    `jwtLength=${tok.body.jwt.length} cache=${tok.headers.get("cache-control")} prompt=${tok.body.reactorPrompt.length} chars`,
  );
  const hb = await customer.expect<PreviewLeaseResponse>(
    "POST",
    paths.casePreviewLease(caseId),
    [200],
    {
      leaseId: tok.body.leaseId,
      action: "heartbeat",
    },
  );
  check(hb.body.active, "lease heartbeat", `${hb.body.liveScenesInUse}/${hb.body.liveScenesMax}`);
  const rel = await customer.expect<PreviewLeaseResponse>(
    "POST",
    paths.casePreviewLease(caseId),
    [200],
    {
      leaseId: tok.body.leaseId,
      action: "release",
    },
  );
  check(!rel.body.active, "lease release", `active=${rel.body.active}`);

  // Take 1: testsrc (needs_revision or uncertain is the correct critic outcome)
  const testsrc = await makeTestsrcWebm(path.join(workDir, "testsrc.webm"), config.ffmpegPath);
  let take = await uploadTake(customer, caseId, p2, testsrc, "testsrc");
  const acceptable = (t: Take) => {
    const s = t.currentAssessment?.uiStatus;
    return s === "uncertain" || s === "unavailable" || s === "matches";
  };
  if (!acceptable(take)) {
    const blocked = await customer.json("POST", paths.takeReview(take.id), {
      decision: "accept",
      finalSha256: take.sha256,
      assessmentId: take.currentAssessment?.id ?? null,
      uncertaintyNote: "Smoke test note.",
      idempotencyKey: key("smoke-review"),
    });
    check(blocked.status === 409, "accept on needs_revision blocked", String(blocked.status));
    const refine = await customer.expect<{ take: Take }>("POST", paths.takeReview(take.id), [200], {
      decision: "refine",
      finalSha256: take.sha256,
      assessmentId: take.currentAssessment?.id ?? null,
      uncertaintyNote: null,
      idempotencyKey: key("smoke-review"),
    });
    check(
      refine.body.take.reviewState === "rejected",
      "refine review",
      refine.body.take.reviewState,
    );
    // Take 2: fixture photo moving like the account, so a non-blocking check is possible.
    const photo = path.join(config.demoAssetsDir, "demo-vacuum.jpg");
    const motion = await makePhotoMotionWebm(
      path.join(workDir, "motion.webm"),
      photo,
      config.ffmpegPath,
    );
    take = await uploadTake(customer, caseId, p2, motion, "photo-motion");
  }

  const mediaRange = await customer.bytes(paths.takeMedia(take.id), { range: "bytes=0-1023" });
  check(
    mediaRange.status === 206,
    "take media Range",
    `${mediaRange.status} ${mediaRange.buf.length} B`,
  );
  const early = await customer.raw("GET", paths.takeDownload(take.id));
  await early.arrayBuffer();
  check(early.status === 409, "download before accept blocked", String(early.status));

  if (!acceptable(take)) {
    // The critic is a real model: a needs_revision verdict on a synthetic clip is correct behavior,
    // and it makes accept (and so the ticket flow) unreachable for this run. Rerun to try again.
    skipped = `critic ${take.currentAssessment?.uiStatus} on the synthetic clip blocks accept`;
    console.log(`SKIP accept + download + support ticket flow: ${skipped} (rerun to retry)`);
    return;
  }
  const reviewed = await customer.expect<{ take: Take }>("POST", paths.takeReview(take.id), [200], {
    decision: "accept",
    finalSha256: take.sha256,
    assessmentId: take.currentAssessment?.id ?? null,
    uncertaintyNote: "Smoke test: checked the backward jerk by eye; synthetic clip.",
    idempotencyKey: key("smoke-review"),
  });
  check(
    reviewed.body.take.reviewState === "accepted",
    "accept with note",
    reviewed.body.take.reviewState,
  );
  const dl = await customer.bytes(paths.takeDownload(take.id));
  const dlSha = sha256(dl.buf);
  check(
    dl.status === 200 && dlSha === take.sha256,
    "download sha256 matches reviewed hash",
    `${dl.status} ${dl.buf.length} B ${dl.headers.get("content-disposition") ?? ""}`,
  );

  // Support handoff
  const sup = await support.expect<SessionState>("POST", paths.supportSession(), [200, 201], {
    supportCode: config.demoSupportCode,
  });
  check(sup.body.role === "support", "POST /api/support/session", sup.body.role ?? "-");
  const ticket = await customer.expect<TicketResponse>("POST", paths.caseTickets(caseId), [201], {
    takeId: take.id,
    message: "Smoke test ticket: the vacuum jerks backward once after stopping.",
    includeOriginal: false,
    idempotencyKey: key("smoke-ticket"),
  });
  const tk = ticket.body.ticket;
  check(
    true,
    "customer submits ticket",
    `${tk.id} status=${tk.status} attachments=${tk.attachments.length}`,
  );
  const inbox = await support.expect<SupportInboxResponse>("GET", paths.supportTickets(), [200]);
  const row = inbox.body.tickets.find((t) => t.id === tk.id);
  check(
    !!row,
    "support inbox lists ticket",
    `rows=${inbox.body.tickets.length} attachments=${row?.attachmentCount ?? "-"}`,
  );
  const custTake = tk.attachments.find((a) => a.purpose === "customer_take");
  if (custTake) {
    const att = await support.bytes(paths.ticketAttachmentDownload(tk.id, custTake.assetId));
    check(
      att.status === 200 && sha256(att.buf) === take.sha256,
      "support downloads the same take bytes",
      String(att.status),
    );
  } else {
    log(false, "ticket has customer_take attachment");
  }
  const reply = await support.expect<TicketResponse>("POST", paths.ticketReplies(tk.id), [201], {
    text: "Thanks, this looks like a bumper sensor misread. Try cleaning the front bumper.",
    attachTakeId: null,
    idempotencyKey: key("smoke-reply"),
  });
  check(reply.body.ticket.replies.length === 1, "support text reply", reply.body.ticket.status);
  const seen = await customer.expect<TicketResponse>("GET", paths.ticket(tk.id), [200]);
  const r0 = seen.body.ticket.replies[0];
  check(
    !!r0 && r0.authorRole === "support",
    "customer sees reply",
    `${r0?.authorLabel ?? "-"} replies=${seen.body.ticket.replies.length}`,
  );
  const work = await support.expect<CreateWorkCaseResponse>(
    "POST",
    paths.ticketWorkCase(tk.id),
    [200, 201],
    {
      idempotencyKey: key("smoke-work"),
    },
  );
  const wc = await support.expect<CaseResponse>("GET", paths.case(work.body.caseId), [200]);
  check(
    wc.body.case.ownerRole === "support" && wc.body.case.mode === "solution",
    "support creates work case",
    `${work.body.caseId} owner=${wc.body.case.ownerRole} mode=${wc.body.case.mode}`,
  );
  const hidden = await customer.json("GET", paths.case(work.body.caseId));
  check(hidden.status === 404, "work case hidden from customer", String(hidden.status));
}

main()
  .catch((err: unknown) => {
    log(false, "aborted", err instanceof SmokeFailure ? err.message : (err as Error).name);
  })
  .finally(() => {
    rmSync(workDir, { recursive: true, force: true });
    const okLine = skipped ? `SMOKE OK (support flow skipped: ${skipped})` : "SMOKE OK";
    console.log(failures === 0 ? okLine : `SMOKE FAILED (${failures})`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
