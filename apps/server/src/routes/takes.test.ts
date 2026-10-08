import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type {
  ApiError,
  CreateTakeMeta,
  Purpose,
  Take,
  TakeMessageResponse,
} from "@symptomsketch/contracts";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import { type AppContext, createContext } from "../context.ts";
import { stopRetentionSweep } from "../domain/lifecycle.ts";
import { exportJobKey } from "../domain/takes.ts";
import { makeSyntheticRecording } from "../media/testing.ts";
import {
  createTakeClient,
  createTakeFixtures,
  type TakeClient,
  type SeededCase,
  type TakeFixtures,
  takeMeta,
} from "./takes.fixtures.ts";

const SECRET = "test-session-secret";
let dir: string;
let ctx: AppContext;
let fx: TakeFixtures;
let http: TakeClient;
let base: string;
let close: () => Promise<void>;
let rawBytes: Uint8Array<ArrayBuffer>;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ss-takes-"));
  const config = loadConfig({
    NODE_ENV: "test",
    DATA_DIR: dir,
    SESSION_SECRET: SECRET,
    DEMO_ACCESS_CODE: "test-access-code",
    DEMO_SUPPORT_CODE: "test-support-code",
  });
  ctx = createContext(config);
  const app = createApp(ctx, { serveWeb: false });
  ctx.jobs.start();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fx = createTakeFixtures(ctx, SECRET);
  http = createTakeClient(base);
  close = () =>
    new Promise<void>((r) => {
      server.closeAllConnections();
      server.close(() => r());
    });
  // Synthetic MediaRecorder-like WebM (test fixture): 1.5 s red lead-in, then 5 s of motion.
  const raw = await makeSyntheticRecording({ dir, leadInSeconds: 1.5, generatedSeconds: 5 });
  rawBytes = new Uint8Array(readFileSync(raw));
});

after(async () => {
  await close();
  stopRetentionSweep(ctx);
  await ctx.jobs.stop();
  ctx.db.close();
  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------ HTTP helpers ------------------------------------------ */

async function upload(
  cookie: string,
  caseId: string,
  m: CreateTakeMeta,
  bytes: Uint8Array<ArrayBuffer> | null = rawBytes,
): Promise<Response> {
  const form = new FormData();
  form.append("meta", JSON.stringify(m));
  if (bytes) form.append("recording", new Blob([bytes], { type: "video/webm" }), "recording.webm");
  return fetch(`${base}/api/cases/${caseId}/takes`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
}

async function readyTake(cookie: string, c: SeededCase, purpose: Purpose = "problem") {
  const res = await upload(cookie, c.caseId, takeMeta(c, purpose));
  assert.equal(res.status, 202);
  const { take } = (await res.json()) as { take: Take };
  return http.waitForTake(cookie, take.id, (t) => t.processingState === "ready");
}

const review = (cookie: string, takeId: string, body: Record<string, unknown>) =>
  http.postJson<{ take: Take } & ApiError>(cookie, `/api/takes/${takeId}/review`, {
    idempotencyKey: `rev-${randomBytes(6).toString("hex")}`,
    uncertaintyNote: null,
    ...body,
  });

/* ---------------------------------------------- tests ---------------------------------------------- */

test("upload -> 202 queued take -> export -> ready H.264 MP4; upload retry is idempotent", async () => {
  const cookie = fx.seedSession();
  const c = fx.seedCase(cookie);
  const m = takeMeta(c, "problem");
  const res = await upload(cookie, c.caseId, m);
  assert.equal(res.status, 202);
  const { take } = (await res.json()) as { take: Take };
  assert.equal(take.number, 1);
  assert.equal(take.captureStatus, "complete");
  assert.ok(["queued", "converting"].includes(take.processingState));
  assert.equal(take.caption, "One backward jerk after stopping");

  const again = await upload(cookie, c.caseId, m);
  assert.equal(again.status, 202);
  assert.equal(((await again.json()) as { take: Take }).take.id, take.id);

  const ready = await http.waitForTake(cookie, take.id, (t) => t.processingState === "ready");
  assert.match(ready.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.ok(ready.durationMs! >= 4000 && ready.durationMs! <= 12000);
  assert.ok(ready.sizeBytes! > 0 && ready.sizeBytes! < 8 * 1024 * 1024);
  assert.equal(ready.mediaUrl, `/api/takes/${take.id}/media`);
  assert.match(ready.thumbnailUrl ?? "", /^\/api\/assets\/ast_/);
  assert.equal(ready.downloadUrl, null);
  const n = ctx.db.prepare("SELECT COUNT(*) AS n FROM takes WHERE case_id = ?").get(c.caseId) as {
    n: number;
  };
  assert.equal(n.n, 1);

  // Media: owner playback with byte ranges; the bytes hash to the take's sha256.
  const full = await fetch(`${base}/api/takes/${take.id}/media`, { headers: { cookie } });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  const bytes = Buffer.from(await full.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), ready.sha256);
  const part = await fetch(`${base}/api/takes/${take.id}/media`, {
    headers: { cookie, range: "bytes=0-99" },
  });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 100);

  // Another session cannot see it.
  const other = fx.seedSession();
  assert.equal((await http.getJson(other, `/api/takes/${take.id}`)).status, 404);
  const otherMedia = await fetch(`${base}/api/takes/${take.id}/media`, {
    headers: { cookie: other },
  });
  assert.equal(otherMedia.status, 404);
  await otherMedia.arrayBuffer();
});

test("relationships are frozen and checked: wrong product, foreign plan, non-ready plan -> 409", async () => {
  const cookie = fx.seedSession();
  const c = fx.seedCase(cookie);
  const foreign = fx.seedCase(cookie);
  const notReady = fx.seedCase(cookie, "problem", "needs_clarification");
  const cases: [string, CreateTakeMeta][] = [
    [c.caseId, takeMeta(c, "problem", { productRevisionId: foreign.productId })],
    [c.caseId, takeMeta(c, "problem", { planRevisionId: foreign.planId })],
    [notReady.caseId, takeMeta(notReady, "problem")],
    [c.caseId, takeMeta(c, "solution")],
  ];
  for (const [caseId, m] of cases) {
    const res = await upload(cookie, caseId, m);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as ApiError).code, "PLAN_CONFLICT");
  }
  // Not the owner: 404 before any bytes are stored.
  const res = await upload(fx.seedSession(), c.caseId, takeMeta(c, "problem"));
  assert.equal(res.status, 404);
  await res.arrayBuffer();
  // Not a recording.
  const bad = await upload(
    cookie,
    c.caseId,
    takeMeta(c, "problem"),
    new Uint8Array(Buffer.from("hi")),
  );
  assert.equal(bad.status, 422);
  assert.equal(((await bad.json()) as ApiError).code, "RECORDING_UNSUPPORTED");
});

test("review: hash + assessment binding, needs_revision, uncertain needs a note, then download", async () => {
  const cookie = fx.seedSession();
  const c = fx.seedCase(cookie);
  const take = await readyTake(cookie, c);
  const sha = take.sha256!;

  // Download before acceptance is refused.
  const early = await fetch(`${base}/api/takes/${take.id}/download`, { headers: { cookie } });
  assert.equal(early.status, 409);
  await early.arrayBuffer();

  const revision = fx.setAssessment(take.id, "needs_revision");
  let r = await review(cookie, take.id, {
    decision: "accept",
    finalSha256: "f".repeat(64),
    assessmentId: revision,
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "REVIEW_CONFLICT");
  r = await review(cookie, take.id, {
    decision: "accept",
    finalSha256: sha,
    assessmentId: revision,
  });
  assert.equal(r.status, 409, "needs_revision cannot be accepted");
  r = await review(cookie, take.id, { decision: "accept", finalSha256: sha, assessmentId: null });
  assert.equal(r.status, 409, "stale/absent assessment id is a conflict");

  // A favorable result bound to other bytes never applies (treated as no check).
  const stale = fx.setAssessment(take.id, "matches", { sha: "e".repeat(64) });
  r = await review(cookie, take.id, { decision: "accept", finalSha256: sha, assessmentId: stale });
  assert.equal(r.status, 409);
  const view = await http.getJson<{ take: Take }>(cookie, `/api/takes/${take.id}`);
  assert.equal(view.body.take.currentAssessment, null);

  const uncertain = fx.setAssessment(take.id, "uncertain");
  r = await review(cookie, take.id, {
    decision: "accept",
    finalSha256: sha,
    assessmentId: uncertain,
  });
  assert.equal(r.status, 400, "uncertain acceptance requires a note");
  r = await review(cookie, take.id, {
    decision: "unsure",
    finalSha256: sha,
    assessmentId: uncertain,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.take.reviewState, "uncertain");
  assert.equal(r.body.take.downloadUrl, null);
  r = await review(cookie, take.id, {
    decision: "accept",
    finalSha256: sha,
    assessmentId: uncertain,
    uncertaintyNote: "Watched it twice; the jerk looks right but is brief.",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.take.reviewState, "accepted");
  assert.equal(r.body.take.latestReview?.finalSha256, sha);
  assert.equal(r.body.take.latestReview?.assessmentId, uncertain);
  assert.equal(r.body.take.downloadUrl, `/api/takes/${take.id}/download`);

  // Download: exact reviewed bytes as an attachment with the case/take filename.
  const dl = await fetch(`${base}/api/takes/${take.id}/download`, { headers: { cookie } });
  assert.equal(dl.status, 200);
  assert.match(
    dl.headers.get("content-disposition") ?? "",
    /^attachment; filename="symptomsketch-case-[a-z0-9]{1,6}-take-01\.mp4"/,
  );
  const got = createHash("sha256")
    .update(Buffer.from(await dl.arrayBuffer()))
    .digest("hex");
  assert.equal(got, sha);
  assert.equal(got, r.body.take.latestReview?.finalSha256);

  // Explanation message: frozen plan, purpose disclosure, check status, review note.
  const msg = await http.getJson<TakeMessageResponse>(cookie, `/api/takes/${take.id}/message`);
  assert.equal(msg.status, 200);
  assert.match(msg.body.subject, /RV-200/);
  assert.match(msg.body.body, /AI-generated reenactment/);
  assert.match(msg.body.body, /not a recording of my product/);
  assert.match(msg.body.body, /Unable to verify/);
  assert.match(msg.body.body, /Watched it twice/);
  assert.match(msg.body.body, /Restarted it; Cleaned the wheels/);
  assert.match(msg.body.body, /cause unknown/);
  assert.ok(msg.body.body.includes(msg.body.attachmentFilename));
  assert.doesNotMatch(msg.body.body, /diagnos|defect|is caused by/i);
});

test("incomplete capture: stored without export, never acceptable, retry refused", async () => {
  const cookie = fx.seedSession();
  const c = fx.seedCase(cookie);
  const m = takeMeta(c, "problem", {
    captureStatus: "incomplete",
    captureReason: null,
    firstOutputOffsetMs: null,
  });
  const res = await upload(cookie, c.caseId, m, null);
  assert.equal(res.status, 202);
  const { take } = (await res.json()) as { take: Take };
  assert.equal(take.captureStatus, "incomplete");
  assert.equal(take.captureReason, "output_timeout");
  assert.equal(take.processingState, "failed");
  assert.equal(take.mediaUrl, null);
  assert.equal(ctx.jobs.findByKey(exportJobKey(take.id)), null);
  const r = await review(cookie, take.id, {
    decision: "accept",
    finalSha256: "a".repeat(64),
    assessmentId: null,
    uncertaintyNote: "x",
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "CAPTURE_INCOMPLETE");
  const retry = await http.postJson<ApiError>(cookie, `/api/takes/${take.id}/retry-export`, {
    idempotencyKey: "retry-incomplete",
  });
  assert.equal(retry.body.code, "CAPTURE_INCOMPLETE");
});

test("retry export: ready take is not reconverted; a failed take re-runs from the kept raw", async () => {
  const cookie = fx.seedSession();
  const c = fx.seedCase(cookie);
  const take = await readyTake(cookie, c);
  const finals = () =>
    (
      ctx.db
        .prepare("SELECT COUNT(*) AS n FROM assets WHERE kind = 'final_mp4' AND case_id = ?")
        .get(c.caseId) as { n: number }
    ).n;
  assert.equal(finals(), 1);
  let r = await http.postJson<{ take: Take }>(cookie, `/api/takes/${take.id}/retry-export`, {
    idempotencyKey: "retry-ready-1",
  });
  assert.equal(r.status, 202);
  assert.equal(r.body.take.sha256, take.sha256);
  assert.equal(finals(), 1);

  // Simulate an interrupted conversion on a second take (crash -> job retryable).
  const res = await upload(cookie, c.caseId, takeMeta(c, "problem"));
  const second = ((await res.json()) as { take: Take }).take;
  await http.waitForTake(cookie, second.id, (t) => t.processingState === "ready");
  ctx.db
    .prepare(
      `UPDATE takes SET processing_state = 'converting', final_asset_id = NULL, sha256 = NULL
       WHERE id = ?`,
    )
    .run(second.id);
  ctx.db
    .prepare(
      "UPDATE jobs SET status = 'retryable', error_code = 'INTERNAL_ERROR' WHERE idempotency_key = ?",
    )
    .run(exportJobKey(second.id));
  const failed = await http.getJson<{ take: Take }>(cookie, `/api/takes/${second.id}`);
  assert.equal(failed.body.take.processingState, "failed");
  assert.equal(failed.body.take.retryable, true);
  r = await http.postJson<{ take: Take }>(cookie, `/api/takes/${second.id}/retry-export`, {
    idempotencyKey: "retry-second-1",
  });
  assert.equal(r.status, 202);
  const redone = await http.waitForTake(cookie, second.id, (t) => t.processingState === "ready");
  assert.match(redone.sha256 ?? "", /^[a-f0-9]{64}$/);
  const rawKept = ctx.db
    .prepare(
      "SELECT a.storage_path FROM takes t JOIN assets a ON a.id = t.raw_asset_id WHERE t.id = ?",
    )
    .get(second.id) as { storage_path: string };
  assert.ok(existsSync(path.join(dir, rawKept.storage_path)));
});

test("instructional take: accepted only when the check matches; deleted case is gone", async () => {
  const cookie = fx.seedSession("support");
  const c = fx.seedCase(cookie, "solution");
  const take = await readyTake(cookie, c, "solution");
  const uncertain = fx.setAssessment(take.id, "uncertain");
  let r = await review(cookie, take.id, {
    decision: "accept",
    finalSha256: take.sha256,
    assessmentId: uncertain,
    uncertaintyNote: "looks fine",
  });
  assert.equal(r.status, 409);
  const unavailable = fx.setAssessment(take.id, null);
  r = await review(cookie, take.id, {
    decision: "accept",
    finalSha256: take.sha256,
    assessmentId: unavailable,
    uncertaintyNote: "looks fine",
  });
  assert.equal(r.status, 409);
  const matches = fx.setAssessment(take.id, "matches");
  r = await review(cookie, take.id, {
    decision: "accept",
    finalSha256: take.sha256,
    assessmentId: matches,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.take.reviewState, "accepted");
  assert.equal(r.body.take.latestReview?.reviewerRole, "support");

  const msg = await http.getJson<TakeMessageResponse>(cookie, `/api/takes/${take.id}/message`);
  assert.match(msg.body.body, /AI-generated instructional illustration/);
  assert.match(msg.body.body, /not a manufacturer video/);
  assert.match(msg.body.body, /Empty the dust bin \(SS-DEMO-RV-01\)/);
  assert.match(msg.body.body, /Turn the vacuum off/);
  assert.match(msg.body.body, /Appears consistent/);

  ctx.db.prepare("UPDATE cases SET status = 'deleted' WHERE id = ?").run(c.caseId);
  assert.equal((await http.getJson(cookie, `/api/takes/${take.id}`)).status, 410);
});
