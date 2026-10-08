// server-ai route tests: Reactor token + preview lease, take assessment (stub Gemini/Reactor).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type {
  PlannerResult,
  PreviewLeaseResponse,
  ReactorTokenResponse,
  TakeResponse,
} from "@symptomsketch/contracts";
import { newId, now } from "../db/index.ts";
import { getCurrentAssessment, getTakeAssessment } from "../domain/assessments.ts";
import { type AiHarness, plan, plannerOut, readyCase, reqId, startAiServer } from "./ai-harness.ts";
import { type Browser, errorCode, sha256 } from "./core-harness.ts";

let h: AiHarness;
before(async () => {
  h = await startAiServer();
});
after(() => h.srv.stop());

function token(b: Browser, caseId: string, planId: string): Promise<Response> {
  return b.json(`/api/cases/${caseId}/reactor-token`, "POST", {
    planRevisionId: planId,
    clientRequestId: reqId(),
  });
}

test("reactor token: lease capacity, per-session supersede, heartbeat, release, mint failure", async () => {
  const a = await readyCase(h);
  const b2 = await readyCase(h);
  const c = await readyCase(h);
  const ta = await token(a.b, a.caseId, a.planId);
  assert.equal(ta.status, 200);
  assert.equal(ta.headers.get("cache-control"), "no-store");
  const tb = (await ta.json()) as ReactorTokenResponse;
  assert.equal(tb.jwt, "stub.jwt.value");
  assert.match(tb.reactorPrompt, /backward/);
  assert.equal((await token(b2.b, b2.caseId, b2.planId)).status, 200);
  const full = await token(c.b, c.caseId, c.planId);
  assert.equal(full.status, 429);
  assert.equal(await errorCode(full), "CAPACITY_FULL");
  // Same session again supersedes its own lease instead of taking a third slot.
  const ta2 = (await (await token(a.b, a.caseId, a.planId)).json()) as ReactorTokenResponse;
  const hb = await a.b.json(`/api/cases/${a.caseId}/preview-lease`, "POST", {
    leaseId: ta2.leaseId,
    action: "heartbeat",
  });
  const hbBody = (await hb.json()) as PreviewLeaseResponse;
  assert.equal(hbBody.active, true);
  assert.equal(hbBody.liveScenesInUse, 2);
  const old = (await (
    await a.b.json(`/api/cases/${a.caseId}/preview-lease`, "POST", {
      leaseId: tb.leaseId,
      action: "heartbeat",
    })
  ).json()) as PreviewLeaseResponse;
  assert.equal(old.active, false);
  const rel = (await (
    await a.b.json(`/api/cases/${a.caseId}/preview-lease`, "POST", {
      leaseId: ta2.leaseId,
      action: "release",
    })
  ).json()) as PreviewLeaseResponse;
  assert.equal(rel.active, false);
  h.mintFails = true;
  const failed = await token(c.b, c.caseId, c.planId);
  assert.equal(failed.status, 503);
  assert.equal(await errorCode(failed), "REACTOR_UNAVAILABLE");
  h.mintFails = false;
  assert.equal((await token(c.b, c.caseId, c.planId)).status, 200);
  // Someone else's lease is not found.
  const foreign = await c.b.json(`/api/cases/${c.caseId}/preview-lease`, "POST", {
    leaseId: ta2.leaseId,
    action: "heartbeat",
  });
  assert.equal(foreign.status, 404);
});

/** Frees every live slot (earlier tests leave leases inside their 30 s TTL). */
function releaseAllLeases(): void {
  h.srv.ctx.db.prepare("UPDATE leases SET released_at = ? WHERE released_at IS NULL").run(now());
}

test("reactor token: a pending clarification keeps the last ready plan previewable", async () => {
  releaseAllLeases();
  const a = await readyCase(h);
  const asked = await plan(
    h,
    a.b,
    a.caseId,
    { parentPlanId: a.planId, correction: "It goes somewhere after it stops." },
    plannerOut({ clarificationQuestion: "Which way does it move", clarificationBlocking: true }),
  );
  assert.equal(asked.status, 201);
  const pending = ((await asked.json()) as PlannerResult).planRevision;
  assert.equal(pending.status, "needs_clarification");
  // The running preview rotates and reconnects with the last ready plan while the question waits.
  assert.equal((await token(a.b, a.caseId, a.planId)).status, 200);
  // The unanswered revision itself still cannot start a preview.
  assert.equal((await token(a.b, a.caseId, pending.id)).status, 409);

  const answered = await plan(h, a.b, a.caseId, {
    parentPlanId: pending.id,
    correction: "Backward.",
    isClarificationAnswer: true,
  });
  assert.equal(answered.status, 201);
  const ready = ((await answered.json()) as PlannerResult).planRevision;
  assert.equal(ready.status, "ready");
  // A newer ready plan supersedes the old one.
  const stale = await token(a.b, a.caseId, a.planId);
  assert.equal(stale.status, 409);
  assert.equal(await errorCode(stale), "PLAN_CONFLICT");
  assert.equal((await token(a.b, a.caseId, ready.id)).status, 200);
});

/** Insert a ready take whose final MP4 file exists on disk (labeled test bytes, not a video). */
function seedTake(caseId: string, planId: string): { takeId: string } {
  const db = h.srv.ctx.db;
  const kase = db.prepare("SELECT * FROM cases WHERE id = ?").get(caseId) as {
    owner_session_id: string;
    product_revision_id: string;
  };
  const bytes = Buffer.from("TEST FIXTURE: not a real mp4");
  const assetId = newId("ast");
  const rel = `media/finals/${caseId}/${assetId}.mp4`;
  mkdirSync(path.join(h.srv.dir, path.dirname(rel)), { recursive: true });
  writeFileSync(path.join(h.srv.dir, rel), bytes);
  const ts = now();
  const sha = sha256(bytes);
  db.prepare(
    `INSERT INTO assets (id, case_id, owner_session_id, kind, mime, size_bytes, sha256, storage_path,
       created_at) VALUES (?, ?, ?, 'final_mp4', 'video/mp4', ?, ?, ?, ?)`,
  ).run(assetId, caseId, kase.owner_session_id, bytes.length, sha, rel, ts);
  const takeId = newId("take");
  db.prepare(
    `INSERT INTO takes (id, case_id, purpose, number, plan_revision_id, product_revision_id,
       run_id, capture_status, processing_state, final_asset_id, duration_ms, size_bytes, sha256,
       created_at, updated_at)
     VALUES (?, ?, 'problem', 1, ?, ?, ?, 'complete', 'ready', ?, 6000, ?, ?, ?, ?)`,
  ).run(
    takeId,
    caseId,
    planId,
    kase.product_revision_id,
    reqId(),
    assetId,
    bytes.length,
    sha,
    ts,
    ts,
  );
  return { takeId };
}

async function waitDone(takeId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const a = getCurrentAssessment(h.srv.ctx.db, takeId);
    if (a && (a.jobState === "done" || a.jobState === "failed")) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("assessment did not finish");
}

function criticReply(result: "supported" | "contradicted", ids: string[]): string {
  return JSON.stringify({
    summary: "The vacuum stops and moves backward once.",
    checks: ids.map((id) => ({
      constraintId: id,
      result,
      observation: `observed ${id}`,
      timeRangeSeconds: [1, 2],
    })),
    limitations: [],
    suggestedPresentationChanges: [],
  });
}

test("assessment: bound to exact bytes + revisions, server status, idempotent, retry when unavailable", async () => {
  const { b, caseId, planId } = await readyCase(h);
  const { takeId } = seedTake(caseId, planId);
  const ids = ["direction", "count", "product"];
  h.replies.push(criticReply("supported", ids));
  const res = await b.json(`/api/takes/${takeId}/assessment`, "POST", {
    idempotencyKey: "req_assess_00001",
  });
  assert.equal(res.status, 202);
  assert.equal(((await res.json()) as TakeResponse).take.id, takeId);
  await waitDone(takeId);
  const a = getCurrentAssessment(h.srv.ctx.db, takeId)!;
  assert.equal(a.uiStatus, "matches");
  assert.equal(
    a.result?.finalSha256,
    (
      h.srv.ctx.db.prepare("SELECT sha256 FROM takes WHERE id = ?").get(takeId) as {
        sha256: string;
      }
    ).sha256,
  );
  assert.equal(a.result?.planRevisionId, planId);
  assert.equal(a.result?.criticPromptVersion, "critic-v2");
  assert.equal(a.result?.modelId, "stub-model");
  assert.deepEqual(a.result?.inputCoverage, {
    kind: "full_video",
    requestedFps: 8,
    sampledTimestampsSeconds: [],
  });
  const take = ((await (await b.req(`/api/takes/${takeId}`)).json()) as TakeResponse).take;
  assert.equal(take.currentAssessment?.id, a.id);

  // Repeat: no new paid call, same attempt.
  const before = h.calls;
  await b.json(`/api/takes/${takeId}/assessment`, "POST", { idempotencyKey: "req_assess_00002" });
  assert.equal(h.calls, before);
  assert.equal(getCurrentAssessment(h.srv.ctx.db, takeId)!.id, a.id);

  // Provider failure on a fresh take -> unavailable / ASSESSMENT_FAILED; retry runs a new attempt.
  h.srv.ctx.db.prepare("UPDATE takes SET current_assessment_id = NULL WHERE id = ?").run(takeId);
  h.replies.push(new Error("boom"));
  await b.json(`/api/takes/${takeId}/assessment`, "POST", { idempotencyKey: "req_assess_00003" });
  await waitDone(takeId);
  const failed = getCurrentAssessment(h.srv.ctx.db, takeId)!;
  assert.equal(failed.uiStatus, "unavailable");
  assert.equal(failed.errorCode, "ASSESSMENT_FAILED");
  h.replies.push(criticReply("contradicted", ids));
  await b.json(`/api/takes/${takeId}/assessment`, "POST", {
    idempotencyKey: "req_assess_00004",
    retry: true,
  });
  await waitDone(takeId);
  const retried = getCurrentAssessment(h.srv.ctx.db, takeId)!;
  assert.notEqual(retried.id, failed.id);
  assert.equal(retried.uiStatus, "needs_revision");
  assert.equal(getTakeAssessment(h.srv.ctx.db, failed.id)?.uiStatus, "unavailable");
});
