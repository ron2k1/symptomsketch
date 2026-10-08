// Visual-check attempts (spec 9 "Separate check of the final video", spec 10 "Visual assessment").
// One row per critic attempt, bound by the server to the take's exact final bytes and frozen
// revisions. Provider or output failures become an unavailable attempt, never a favorable one.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ClipAssessment,
  ErrorCode,
  type ActionPlan,
  type AssessmentStatus,
  type AssessmentUiStatus,
  type InputCoverage,
  type TakeAssessment,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { type Db, fromJson, getRow, newId, now, toJson, tx } from "../db/index.ts";
import { JOB_KINDS, JobError, type JobQueue } from "../db/jobs.ts";
import { AppError } from "../http/errors.ts";
import { extractThumbnail } from "../media/ffmpeg.ts";
import {
  CRITIC_KEYFRAME_EDGE_S,
  CRITIC_PROMPT_VERSION,
  CriticOutputError,
  runCritic,
} from "../providers/critic.ts";
import { GeminiError } from "../providers/gemini-client.ts";
import { geminiFor } from "../providers/planner.ts";
import {
  getPlanRow,
  isCaseActive,
  loadCase,
  loadProductRevision,
  loadReferenceImage,
  readAsset,
} from "./plans.ts";
import { getProcedure } from "./procedures.ts";

type JobState = "queued" | "running" | "done" | "failed";

/**
 * First and last moments of the final MP4 as JPEG stills for the critic (see CriticRunInput).
 * Any failure returns null and the check runs on the video alone, as before.
 */
async function cutKeyframes(
  ctx: AppContext,
  bytes: Uint8Array,
  durationSeconds: number,
  signal?: AbortSignal,
): Promise<{ first: Uint8Array; last: Uint8Array } | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ss-keyframes-"));
  try {
    const src = path.join(dir, "final.mp4");
    const first = path.join(dir, "first.jpg");
    const last = path.join(dir, "last.jpg");
    await writeFile(src, bytes);
    const end = Math.max(0, durationSeconds - CRITIC_KEYFRAME_EDGE_S);
    await extractThumbnail(ctx.config.ffmpegPath, src, first, CRITIC_KEYFRAME_EDGE_S, signal);
    await extractThumbnail(ctx.config.ffmpegPath, src, last, end, signal);
    return { first: await readFile(first), last: await readFile(last) };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface AssessmentRow {
  id: string;
  take_id: string;
  final_sha256: string;
  product_revision_id: string;
  plan_revision_id: string;
  procedure_revision_id: string | null;
  model_id: string;
  critic_prompt_version: string;
  input_coverage_json: string;
  job_state: JobState;
  result_status: AssessmentStatus | null;
  summary: string | null;
  result_json: string | null;
  error_code: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

/** The subset of the takes row (server-media's table) the critic binds to. */
interface TakeBindingRow {
  id: string;
  case_id: string;
  plan_revision_id: string;
  product_revision_id: string;
  procedure_revision_id: string | null;
  capture_status: "complete" | "incomplete";
  processing_state: string;
  final_asset_id: string | null;
  sha256: string | null;
  duration_ms: number | null;
  current_assessment_id: string | null;
}

function uiStatus(row: AssessmentRow): AssessmentUiStatus {
  if (row.job_state === "queued" || row.job_state === "running") return "pending";
  if (row.job_state === "failed" || !row.result_status) return "unavailable";
  return row.result_status;
}

export function toTakeAssessment(row: AssessmentRow): TakeAssessment {
  const result = row.result_json ? ClipAssessment.safeParse(fromJson(row.result_json, null)) : null;
  const code = row.error_code ? ErrorCode.safeParse(row.error_code) : null;
  return {
    id: row.id,
    takeId: row.take_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    jobState: row.job_state,
    uiStatus: uiStatus(row),
    summary: row.summary,
    errorCode: code?.success ? code.data : null,
    result: result?.success ? result.data : null,
  };
}

function getAssessmentRow(db: Db, id: string): AssessmentRow | undefined {
  return getRow<AssessmentRow>(db, "SELECT * FROM assessments WHERE id = ?", id);
}

export function getTakeAssessment(db: Db, assessmentId: string): TakeAssessment | null {
  const row = getAssessmentRow(db, assessmentId);
  return row ? toTakeAssessment(row) : null;
}

/** The take's current attempt (takes.current_assessment_id), or null. */
export function getCurrentAssessment(db: Db, takeId: string): TakeAssessment | null {
  const row = getRow<AssessmentRow>(
    db,
    `SELECT a.* FROM takes t JOIN assessments a ON a.id = t.current_assessment_id AND a.take_id = t.id
     WHERE t.id = ?`,
    takeId,
  );
  return row ? toTakeAssessment(row) : null;
}

function getTakeBinding(db: Db, takeId: string): TakeBindingRow | undefined {
  return getRow<TakeBindingRow>(
    db,
    `SELECT id, case_id, plan_revision_id, product_revision_id, procedure_revision_id,
            capture_status, processing_state, final_asset_id, sha256, duration_ms,
            current_assessment_id
     FROM takes WHERE id = ?`,
    takeId,
  );
}

/** An attempt still applies only to the same bytes and frozen revisions (spec 9). */
function isBound(a: AssessmentRow, t: TakeBindingRow): boolean {
  return (
    a.take_id === t.id &&
    a.final_sha256 === t.sha256 &&
    a.plan_revision_id === t.plan_revision_id &&
    a.product_revision_id === t.product_revision_id &&
    (a.procedure_revision_id ?? null) === (t.procedure_revision_id ?? null)
  );
}

/** Why a take cannot be checked yet, or null when it can. */
function notCheckable(t: TakeBindingRow): "TAKE_NOT_READY" | "CAPTURE_INCOMPLETE" | null {
  if (t.capture_status !== "complete") return "CAPTURE_INCOMPLETE";
  if (t.processing_state !== "ready" || !t.sha256 || !t.final_asset_id) return "TAKE_NOT_READY";
  return null;
}

function assessmentJobKey(assessmentId: string): string {
  return `assessment:${assessmentId}`;
}

/** Insert a queued attempt bound to the take, point the take at it, and enqueue the job. */
function createAttempt(ctx: AppContext, t: TakeBindingRow, idempotencyKey: string): AssessmentRow {
  return tx(ctx.db, () => {
    const id = newId("asm");
    const ts = now();
    const coverage: InputCoverage = {
      kind: "full_video",
      requestedFps: ctx.config.criticFps,
      sampledTimestampsSeconds: [],
    };
    ctx.db
      .prepare(
        `INSERT INTO assessments (id, take_id, final_sha256, product_revision_id, plan_revision_id,
           procedure_revision_id, model_id, critic_prompt_version, input_coverage_json, job_state,
           idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      )
      .run(
        id,
        t.id,
        t.sha256!,
        t.product_revision_id,
        t.plan_revision_id,
        t.procedure_revision_id,
        ctx.config.geminiCriticModel,
        CRITIC_PROMPT_VERSION,
        toJson(coverage),
        idempotencyKey,
        ts,
        ts,
      );
    ctx.db.prepare("UPDATE takes SET current_assessment_id = ? WHERE id = ?").run(id, t.id);
    ctx.jobs.enqueueJob(JOB_KINDS.takeAssessment, { assessmentId: id }, assessmentJobKey(id), {
      caseId: t.case_id,
    });
    return getAssessmentRow(ctx.db, id)!;
  });
}

/** Current attempt when it still applies and is pending or finished (no new paid call needed). */
function reusableCurrent(db: Db, t: TakeBindingRow): AssessmentRow | null {
  const current = t.current_assessment_id
    ? getAssessmentRow(db, t.current_assessment_id)
    : undefined;
  if (current && isBound(current, t) && current.job_state !== "failed") return current;
  return null;
}

/**
 * Called by server-media once a take's final MP4 is ready. Returns the queued (or already
 * applicable) attempt, or null when the take cannot be checked (incomplete, not ready, inactive).
 */
export function enqueueAssessment(ctx: AppContext, takeId: string): TakeAssessment | null {
  const t = getTakeBinding(ctx.db, takeId);
  if (!t || notCheckable(t) || !isCaseActive(loadCase(ctx.db, t.case_id))) return null;
  const existing = reusableCurrent(ctx.db, t);
  if (existing) return toTakeAssessment(existing);
  const key = `auto:${t.id}:${t.sha256}`;
  const prior = getRow<AssessmentRow>(
    ctx.db,
    "SELECT * FROM assessments WHERE idempotency_key = ?",
    key,
  );
  if (prior) return toTakeAssessment(prior);
  return toTakeAssessment(createAttempt(ctx, t, key));
}

/**
 * POST /api/takes/:id/assessment (ownership checked by the route). Idempotent per key; reuses an
 * applicable pending/finished attempt. A failed (unavailable) attempt is returned as is unless
 * `retry` is set, which starts a new attempt. `beforeCreate` runs only when a paid call follows.
 */
export function requestAssessment(
  ctx: AppContext,
  takeId: string,
  opts: { idempotencyKey: string; retry: boolean; beforeCreate?: () => void },
): { assessment: TakeAssessment; created: boolean } {
  const t = getTakeBinding(ctx.db, takeId);
  if (!t) throw new AppError("NOT_FOUND");
  const blocked = notCheckable(t);
  if (blocked) throw new AppError(blocked);
  const key = `req:${t.id}:${opts.idempotencyKey}`;
  const prior = getRow<AssessmentRow>(
    ctx.db,
    "SELECT * FROM assessments WHERE idempotency_key = ?",
    key,
  );
  if (prior) return { assessment: toTakeAssessment(prior), created: false };
  const existing = reusableCurrent(ctx.db, t);
  if (existing) return { assessment: toTakeAssessment(existing), created: false };
  const current = t.current_assessment_id
    ? getAssessmentRow(ctx.db, t.current_assessment_id)
    : undefined;
  if (current && isBound(current, t) && !opts.retry) {
    return { assessment: toTakeAssessment(current), created: false };
  }
  opts.beforeCreate?.();
  return { assessment: toTakeAssessment(createAttempt(ctx, t, key)), created: true };
}

// ---- job ----

/** Bounded, publishable failure inside the job. */
class AssessmentStop extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.name = "AssessmentStop";
    this.code = code;
  }
}

function setState(db: Db, id: string, fields: Partial<AssessmentRow>): void {
  const entries = Object.entries({ ...fields, updated_at: now() });
  db.prepare(
    `UPDATE assessments SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
  ).run(...entries.map(([, v]) => (v ?? null) as string | number | null), id);
}

function failureCode(err: unknown): ErrorCode {
  if (err instanceof AssessmentStop) return err.code;
  if (err instanceof GeminiError) return err.code;
  return "ASSESSMENT_FAILED";
}

function reasonOf(err: unknown): string {
  if (err instanceof GeminiError || err instanceof CriticOutputError) return err.reason;
  if (err instanceof AssessmentStop) return err.code;
  return (err as Error)?.name ?? "Error";
}

/** Run one critic attempt end to end. Exported for tests; production runs it via the job queue. */
export async function runAssessmentJob(
  ctx: AppContext,
  assessmentId: string,
  signal?: AbortSignal,
): Promise<{ status: AssessmentUiStatus }> {
  const a = getAssessmentRow(ctx.db, assessmentId);
  if (!a || a.job_state === "done" || a.job_state === "failed") {
    return { status: a ? uiStatus(a) : "unavailable" };
  }
  setState(ctx.db, a.id, { job_state: "running" });
  try {
    const t = getTakeBinding(ctx.db, a.take_id);
    if (!t || !isBound(a, t) || notCheckable(t)) throw new AssessmentStop("REVIEW_CONFLICT");
    if (!isCaseActive(loadCase(ctx.db, t.case_id))) throw new AssessmentStop("CASE_INACTIVE");
    const mp4 = await readAsset(ctx, t.final_asset_id!);
    if (!mp4 || createHash("sha256").update(mp4.bytes).digest("hex") !== a.final_sha256) {
      throw new AssessmentStop("REVIEW_CONFLICT");
    }
    const planRow = getPlanRow(ctx.db, a.plan_revision_id);
    const product = loadProductRevision(ctx.db, a.product_revision_id);
    if (!planRow || !product) throw new AssessmentStop("ASSESSMENT_FAILED");
    const plan = fromJson<ActionPlan>(planRow.plan_json, {} as ActionPlan);
    const procedure = a.procedure_revision_id
      ? getProcedure(ctx.db, a.procedure_revision_id)
      : null;
    const durationSeconds = (t.duration_ms ?? 0) / 1000;
    if (!(durationSeconds > 0)) throw new AssessmentStop("ASSESSMENT_FAILED");
    const coverage = fromJson<InputCoverage>(a.input_coverage_json, {
      kind: "full_video",
      requestedFps: ctx.config.criticFps,
      sampledTimestampsSeconds: [],
    });

    const result = await runCritic(geminiFor(ctx), {
      plan,
      procedure: procedure ? { title: procedure.title, steps: procedure.steps } : null,
      durationSeconds,
      requestedFps: coverage.requestedFps ?? ctx.config.criticFps,
      model: ctx.config.geminiCriticModel,
      thinkingLevel: ctx.config.geminiThinkingLevel,
      mp4: mp4.bytes,
      reference: await loadReferenceImage(ctx, product),
      keyframes: await cutKeyframes(ctx, mp4.bytes, durationSeconds, signal),
      ...(signal ? { signal } : {}),
    });

    // Re-check lifecycle and bytes before publishing (spec 5, 9).
    if (!isCaseActive(loadCase(ctx.db, t.case_id))) throw new AssessmentStop("CASE_INACTIVE");
    const latest = getTakeBinding(ctx.db, t.id);
    if (!latest || !isBound(a, latest)) throw new AssessmentStop("REVIEW_CONFLICT");

    const clip = ClipAssessment.parse({
      schemaVersion: 1,
      takeId: t.id,
      finalSha256: a.final_sha256,
      productRevisionId: a.product_revision_id,
      planRevisionId: a.plan_revision_id,
      procedureRevisionId: a.procedure_revision_id,
      criticPromptVersion: a.critic_prompt_version,
      modelId: result.modelId,
      inputCoverage: coverage,
      status: result.status,
      checks: result.checks,
      limitations: result.limitations,
      suggestedPresentationChanges: result.suggestedPresentationChanges,
    });
    setState(ctx.db, a.id, {
      job_state: "done",
      model_id: result.modelId,
      result_status: result.status,
      summary: result.summary,
      result_json: toJson(clip),
      error_code: null,
    });
    console.log(`[critic] ${a.id} done status=${result.status} latencyMs=${result.latencyMs}`);
    return { status: result.status };
  } catch (err) {
    const code = failureCode(err);
    setState(ctx.db, a.id, { job_state: "failed", error_code: code, summary: null });
    console.warn(`[critic] ${a.id} unavailable code=${code} reason=${reasonOf(err)}`);
    throw new JobError(code, { retryable: false });
  }
}

const registered = new WeakSet<JobQueue>();

/**
 * Register the critic job handler (once per queue) and close out attempts orphaned by a restart:
 * an attempt whose job is no longer queued/running becomes unavailable (retry allowed).
 */
export function registerAssessmentJob(ctx: AppContext): void {
  if (registered.has(ctx.jobs)) return;
  registered.add(ctx.jobs);
  ctx.db
    .prepare(
      `UPDATE assessments SET job_state = 'failed', error_code = 'ASSESSMENT_FAILED', updated_at = ?
       WHERE job_state IN ('queued','running') AND NOT EXISTS (
         SELECT 1 FROM jobs j WHERE j.idempotency_key = 'assessment:' || assessments.id
           AND j.status IN ('queued','running'))`,
    )
    .run(now());
  ctx.jobs.registerJobHandler<{ assessmentId: string }>(JOB_KINDS.takeAssessment, {
    concurrency: 1,
    timeoutMs: 240_000,
    timeoutCode: "ASSESSMENT_FAILED",
    handler: async (payload, _job, signal) => runAssessmentJob(ctx, payload.assessmentId, signal),
  });
}
