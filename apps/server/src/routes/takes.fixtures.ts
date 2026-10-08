import { randomBytes } from "node:crypto";
import type { ActionPlan, CreateTakeMeta, Purpose, Take } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { fromNow, newId, now, toJson } from "../db/index.ts";
import { hashToken, SESSION_COOKIE } from "../http/session.ts";

/**
 * TEST FIXTURES ONLY (imported by takes.test.ts, never by the live app). Seeds owned rows directly:
 * the planner (Gemini) and the critic are live providers and are not faked here; a test that needs
 * a bound check result inserts a clearly labeled `test-model` assessment row.
 */

export interface SeededCase {
  caseId: string;
  productId: string;
  planId: string;
  procedureId: string | null;
}

export type CheckResult = "matches" | "needs_revision" | "uncertain" | null;

function planJson(purpose: Purpose, productId: string, procedureId: string | null): ActionPlan {
  const problem = purpose === "problem";
  return {
    schemaVersion: 1,
    purpose,
    productRevisionId: productId,
    procedureRevisionId: procedureId,
    selectedAction: {
      subject: "robot vacuum",
      startingState: "moving, then comes to a stop",
      action: problem ? "jerks backward" : "lifts the dust bin straight up",
      direction: problem ? "backward" : "up",
      repetitions: 1,
      timing: problem ? "immediately after stopping" : null,
      magnitude: "small",
      endingState: "stationary",
    },
    context: {
      reportedFrequency: problem ? "intermittent" : null,
      actionsTried: problem ? ["Restarted it", "Cleaned the wheels"] : [],
      unresolved: problem ? ["cause unknown"] : [],
    },
    prerequisites: problem ? [] : ["Turn the vacuum off"],
    invariants: ["same selected product"],
    requiredConstraints: [
      {
        id: "direction",
        expected: problem ? "backward" : "up",
        critical: true,
        source: { kind: problem ? "account" : "procedure", quote: null },
      },
    ],
    understanding: "Show one small movement.",
    preservedDetails: ["one movement"],
    caption: problem ? "One backward jerk after stopping" : "Lift the dust bin up",
    sourceReferences: [],
    clarificationQuestion: null,
  };
}

/** Upload `meta` for a seeded case (complete capture at offset 1500 ms unless overridden). */
export function takeMeta(
  c: SeededCase,
  purpose: Purpose,
  over: Partial<CreateTakeMeta> = {},
): CreateTakeMeta {
  return {
    purpose,
    planRevisionId: c.planId,
    productRevisionId: c.productId,
    procedureRevisionId: c.procedureId,
    runId: `run-${randomBytes(4).toString("hex")}`,
    captureStatus: "complete",
    captureReason: null,
    firstOutputOffsetMs: 1500,
    recordedDurationMs: 6500,
    mimeType: "video/webm;codecs=vp8",
    caption: "",
    idempotencyKey: `idem-${randomBytes(6).toString("hex")}`,
    ...over,
  };
}

export function createTakeFixtures(ctx: AppContext, secret: string) {
  const db = ctx.db;

  /** A granted session; returns its cookie header value. */
  function seedSession(role: "customer" | "support" = "customer"): string {
    const token = randomBytes(24).toString("base64url");
    const ts = now();
    db.prepare(
      `INSERT INTO sessions (id, token_hash, role, access_granted, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).run(newId("ses"), hashToken(secret, token), role, ts, ts, fromNow(86_400_000));
    return `${SESSION_COOKIE}=${token}`;
  }

  function sessionIdOf(cookie: string): string {
    const token = cookie.slice(cookie.indexOf("=") + 1);
    const row = db
      .prepare("SELECT id FROM sessions WHERE token_hash = ?")
      .get(hashToken(secret, token)) as { id: string };
    return row.id;
  }

  /** Active case + product revision (+ procedure for solution) + a plan revision. */
  function seedCase(
    cookie: string,
    purpose: Purpose = "problem",
    planStatus = "ready",
  ): SeededCase {
    const sessionId = sessionIdOf(cookie);
    const caseId = newId("case");
    const ts = now();
    db.prepare(
      `INSERT INTO cases (id, owner_session_id, owner_role, title, mode, status, original_account,
         actions_tried, fixture_id, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, 'Vacuum', ?, 'active', 'It jerks backward once when it stops.',
         'Restarted it', 'robot-vacuum', ?, ?, ?)`,
    ).run(
      caseId,
      sessionId,
      purpose === "solution" ? "support" : "customer",
      purpose,
      ts,
      ts,
      fromNow(86_400_000),
    );
    const asset = (kind: string) => {
      const id = newId("ast");
      db.prepare(
        `INSERT INTO assets (id, case_id, owner_session_id, kind, mime, size_bytes, sha256,
           storage_path, created_at) VALUES (?, ?, ?, ?, 'image/jpeg', 1, ?, ?, ?)`,
      ).run(id, caseId, sessionId, kind, "0".repeat(64), `media/originals/${caseId}/${id}.jpg`, ts);
      return id;
    };
    const productId = newId("prod");
    db.prepare(
      `INSERT INTO product_revisions (id, case_id, source_type, fixture_id, original_asset_id,
         normalized_asset_id, model_label, source_hash, created_at)
       VALUES (?, ?, 'demo_photo', 'robot-vacuum', ?, ?, 'RV-200', ?, ?)`,
    ).run(productId, caseId, asset("original"), asset("normalized"), "1".repeat(64), ts);
    let procedureId: string | null = null;
    if (purpose === "solution") {
      procedureId = newId("proc");
      db.prepare(
        `INSERT INTO procedure_revisions (id, case_id, product_revision_id, title, procedure_code,
           approved_text, source_description, model_applicability_confirmed, created_at)
         VALUES (?, ?, ?, 'Empty the dust bin', 'SS-DEMO-RV-01', 'Lift the bin up.',
           'Authored demo procedure', 1, ?)`,
      ).run(procedureId, caseId, productId, ts);
    }
    const planId = newId("plan");
    const plan = planJson(purpose, productId, procedureId);
    db.prepare(
      `INSERT INTO plan_revisions (id, case_id, purpose, product_revision_id, procedure_revision_id,
         status, plan_json, reactor_prompt, caption, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'prompt', ?, ?)`,
    ).run(
      planId,
      caseId,
      purpose,
      productId,
      procedureId,
      planStatus,
      toJson(plan),
      plan.caption,
      ts,
    );
    return { caseId, productId, planId, procedureId };
  }

  /**
   * Bind a labeled `test-model` check attempt as the take's current assessment (null = the check
   * failed, i.e. unavailable). `sha` binds it to other bytes to simulate a stale result.
   */
  function setAssessment(takeId: string, status: CheckResult, opts: { sha?: string } = {}): string {
    const t = db
      .prepare(
        `SELECT sha256, plan_revision_id, product_revision_id, procedure_revision_id
         FROM takes WHERE id = ?`,
      )
      .get(takeId) as {
      sha256: string;
      plan_revision_id: string;
      product_revision_id: string;
      procedure_revision_id: string | null;
    };
    const id = newId("asm");
    const ts = now();
    db.prepare(
      `INSERT INTO assessments (id, take_id, final_sha256, product_revision_id, plan_revision_id,
         procedure_revision_id, model_id, critic_prompt_version, input_coverage_json, job_state,
         result_status, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'test-model', 'test', '{}', ?, ?, 'test summary', ?, ?)`,
    ).run(
      id,
      takeId,
      opts.sha ?? t.sha256,
      t.product_revision_id,
      t.plan_revision_id,
      t.procedure_revision_id,
      status === null ? "failed" : "done",
      status,
      ts,
      ts,
    );
    db.prepare("UPDATE takes SET current_assessment_id = ? WHERE id = ?").run(id, takeId);
    return id;
  }

  return { seedSession, seedCase, setAssessment };
}

export type TakeFixtures = ReturnType<typeof createTakeFixtures>;

/** Cookie-authenticated JSON client for the running test server. */
export function createTakeClient(base: string) {
  async function getJson<T>(cookie: string, p: string): Promise<{ status: number; body: T }> {
    const res = await fetch(base + p, { headers: { cookie } });
    return { status: res.status, body: (await res.json()) as T };
  }

  async function postJson<T>(cookie: string, p: string, body: unknown) {
    const res = await fetch(base + p, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  /** Poll GET /api/takes/:id until `done` (the export job runs in the background). */
  async function waitForTake(
    cookie: string,
    takeId: string,
    done: (t: Take) => boolean,
    timeoutMs = 60_000,
  ): Promise<Take> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const { body } = await getJson<{ take: Take }>(cookie, `/api/takes/${takeId}`);
      if (done(body.take)) return body.take;
      if (Date.now() > end) throw new Error(`take ${takeId} stuck: ${body.take.processingState}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return { getJson, postJson, waitForTake };
}

export type TakeClient = ReturnType<typeof createTakeClient>;
