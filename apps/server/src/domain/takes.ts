import { existsSync } from "node:fs";
import {
  CaptureReason,
  ErrorCode,
  paths as urls,
  type Purpose,
  type Review,
  type ReviewDecision,
  type ReviewState,
  type Role,
  type Take,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { type Db, allRows, getRow, now } from "../db/index.ts";
import { JOB_KINDS, type JobRecord } from "../db/jobs.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import { resolveStoragePath } from "../media/files.ts";
import { getCurrentAssessment } from "./assessments.ts";

/** Row shapes read by server-media (schema owned by architect: db/schema.ts). */
export interface TakeRow {
  id: string;
  case_id: string;
  purpose: Purpose;
  number: number;
  plan_revision_id: string;
  product_revision_id: string;
  procedure_revision_id: string | null;
  run_id: string;
  capture_status: "complete" | "incomplete";
  capture_reason: string | null;
  first_output_offset_ms: number | null;
  recorded_duration_ms: number | null;
  processing_state: Take["processingState"];
  review_state: ReviewState;
  raw_asset_id: string | null;
  final_asset_id: string | null;
  thumbnail_asset_id: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  caption: string;
  error_code: string | null;
  retryable: number;
  current_assessment_id: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseRow {
  id: string;
  owner_session_id: string;
  owner_role: Role;
  title: string;
  mode: Purpose;
  status: "active" | "deleted" | "expired";
  original_account: string;
  actions_tried: string;
  model_label: string | null;
  fixture_id: string | null;
  product_revision_id: string | null;
  expires_at: string;
}

export interface AssetRow {
  id: string;
  case_id: string;
  kind: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  deleted_at: string | null;
}

interface ReviewRow {
  id: string;
  take_id: string;
  final_sha256: string;
  assessment_id: string | null;
  decision: ReviewDecision;
  resulting_state: ReviewState;
  uncertainty_note: string | null;
  reviewer_role: Role;
  created_at: string;
}

/** Idempotency key of the single export job of a take (retry re-queues the same job). */
export function exportJobKey(takeId: string): string {
  return `${JOB_KINDS.takeExport}:${takeId}`;
}

export function getTakeRow(db: Db, takeId: string): TakeRow | undefined {
  return getRow<TakeRow>(db, "SELECT * FROM takes WHERE id = ?", takeId);
}

export function getCaseRow(db: Db, caseId: string): CaseRow | undefined {
  return getRow<CaseRow>(
    db,
    `SELECT id, owner_session_id, owner_role, title, mode, status, original_account, actions_tried,
            model_label, fixture_id, product_revision_id, expires_at
     FROM cases WHERE id = ?`,
    caseId,
  );
}

export function getAssetRow(db: Db, assetId: string): AssetRow | undefined {
  return getRow<AssetRow>(
    db,
    `SELECT id, case_id, kind, mime, size_bytes, sha256, storage_path, deleted_at
     FROM assets WHERE id = ?`,
    assetId,
  );
}

/** Deleted/expired cases never publish output or serve media (spec 14, test 26). */
export function isCaseActive(c: CaseRow | undefined): c is CaseRow {
  return !!c && c.status === "active" && c.expires_at > now();
}

/** Absolute path of a stored, non-deleted asset, or null. */
export function assetPath(ctx: AppContext, asset: AssetRow | undefined): string | null {
  if (!asset || asset.deleted_at) return null;
  try {
    return resolveStoragePath(ctx.paths, asset.storage_path);
  } catch {
    return null;
  }
}

/** True when the raw recording of a take is still on disk (required for export retry). */
export function rawRecordingRetained(ctx: AppContext, take: TakeRow): boolean {
  if (!take.raw_asset_id) return false;
  const p = assetPath(ctx, getAssetRow(ctx.db, take.raw_asset_id));
  return p !== null && existsSync(p);
}

/**
 * Owner-only access (spec 11, 14): a support role does not bypass ownership. Unknown and
 * not-owned takes are indistinguishable (404). Owned takes of an inactive case -> 410.
 */
export function loadOwnedTake(
  ctx: AppContext,
  session: SessionInfo,
  takeId: string,
): { take: TakeRow; kase: CaseRow } {
  const take = getTakeRow(ctx.db, takeId);
  const kase = take ? getCaseRow(ctx.db, take.case_id) : undefined;
  if (!take || !kase || kase.owner_session_id !== session.id) throw new AppError("NOT_FOUND");
  if (!isCaseActive(kase)) throw new AppError("CASE_INACTIVE");
  return { take: reconcileExportState(ctx, take), kase };
}

/** Owned, active case or 404/410. */
export function loadOwnedCase(ctx: AppContext, session: SessionInfo, caseId: string): CaseRow {
  const kase = getCaseRow(ctx.db, caseId);
  if (!kase || kase.owner_session_id !== session.id) throw new AppError("NOT_FOUND");
  if (!isCaseActive(kase)) throw new AppError("CASE_INACTIVE");
  return kase;
}

/**
 * Bring a queued/converting take in line with its job after a crash recovery (running ->
 * retryable) or a case cancellation, so polling never shows "Processing" forever.
 */
export function reconcileExportState(ctx: AppContext, take: TakeRow): TakeRow {
  if (take.processing_state !== "queued" && take.processing_state !== "converting") return take;
  const job: JobRecord | null = ctx.jobs.findByKey(exportJobKey(take.id));
  if (!job || (job.status !== "failed" && job.status !== "retryable")) return take;
  const retryable = job.status === "retryable" && rawRecordingRetained(ctx, take);
  ctx.db
    .prepare(
      `UPDATE takes SET processing_state = 'failed', error_code = ?, retryable = ?, updated_at = ?
       WHERE id = ? AND processing_state IN ('queued','converting')`,
    )
    .run(job.errorCode ?? "EXPORT_FAILED", retryable ? 1 : 0, now(), take.id);
  return getTakeRow(ctx.db, take.id) ?? take;
}

interface AssessmentBindingRow {
  id: string;
  final_sha256: string;
  plan_revision_id: string;
  product_revision_id: string;
  procedure_revision_id: string | null;
  job_state: "queued" | "running" | "done" | "failed";
  result_status: "matches" | "needs_revision" | "uncertain" | null;
}

/**
 * The assessment that currently applies to the take's exact final bytes and frozen revisions,
 * or null. A stale or mismatched binding never applies (spec 9, test 17).
 */
export function currentAssessmentBinding(db: Db, take: TakeRow): AssessmentBindingRow | null {
  if (!take.sha256) return null;
  const row = take.current_assessment_id
    ? getRow<AssessmentBindingRow>(
        db,
        `SELECT id, final_sha256, plan_revision_id, product_revision_id, procedure_revision_id,
                job_state, result_status
         FROM assessments WHERE id = ? AND take_id = ?`,
        take.current_assessment_id,
        take.id,
      )
    : undefined;
  if (!row) return null;
  const bound =
    row.final_sha256 === take.sha256 &&
    row.plan_revision_id === take.plan_revision_id &&
    row.product_revision_id === take.product_revision_id &&
    (row.procedure_revision_id ?? null) === (take.procedure_revision_id ?? null);
  return bound ? row : null;
}

/** What the visual check means for review: stored status, or pending / unavailable. */
export type CheckState = "pending" | "matches" | "needs_revision" | "uncertain" | "unavailable";

export function checkState(binding: AssessmentBindingRow | null): CheckState {
  if (!binding) return "unavailable";
  if (binding.job_state === "queued" || binding.job_state === "running") return "pending";
  if (binding.job_state === "failed" || !binding.result_status) return "unavailable";
  return binding.result_status;
}

function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    takeId: row.take_id,
    finalSha256: row.final_sha256,
    assessmentId: row.assessment_id,
    decision: row.decision,
    resultingState: row.resulting_state,
    uncertaintyNote: row.uncertainty_note,
    reviewerRole: row.reviewer_role,
    createdAt: row.created_at,
  };
}

export function latestReview(db: Db, takeId: string): Review | null {
  const row = getRow<ReviewRow>(
    db,
    `SELECT id, take_id, final_sha256, assessment_id, decision, resulting_state, uncertainty_note,
            reviewer_role, created_at
     FROM reviews WHERE take_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    takeId,
  );
  return row ? toReview(row) : null;
}

/** Build the Take DTO (spec 10/11). Media URLs are authorized API routes by opaque id. */
export function toTakeDto(ctx: AppContext, row: TakeRow): Take {
  const ready = row.processing_state === "ready" && row.sha256 !== null;
  const binding = currentAssessmentBinding(ctx.db, row);
  const errorCode = row.error_code ? ErrorCode.safeParse(row.error_code) : null;
  const reason = row.capture_reason ? CaptureReason.safeParse(row.capture_reason) : null;
  return {
    id: row.id,
    caseId: row.case_id,
    purpose: row.purpose,
    number: row.number,
    planRevisionId: row.plan_revision_id,
    productRevisionId: row.product_revision_id,
    procedureRevisionId: row.procedure_revision_id,
    runId: row.run_id,
    captureStatus: row.capture_status,
    captureReason: reason?.success ? reason.data : null,
    firstOutputOffsetMs: row.first_output_offset_ms,
    processingState: row.processing_state,
    reviewState: row.review_state,
    durationMs: row.duration_ms,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    thumbnailUrl: ready && row.thumbnail_asset_id ? urls.assetMedia(row.thumbnail_asset_id) : null,
    mediaUrl: ready ? urls.takeMedia(row.id) : null,
    downloadUrl: ready && row.review_state === "accepted" ? urls.takeDownload(row.id) : null,
    caption: row.caption,
    errorCode: errorCode?.success ? errorCode.data : null,
    retryable: row.retryable === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentAssessment: binding ? getCurrentAssessment(ctx.db, row.id) : null,
    latestReview: latestReview(ctx.db, row.id),
  };
}

/** Take DTO by id (no ownership check: callers enforce access). Null when missing. */
export function getTakeDto(ctx: AppContext, takeId: string): Take | null {
  const row = getTakeRow(ctx.db, takeId);
  return row ? toTakeDto(ctx, reconcileExportState(ctx, row)) : null;
}

/** All takes of a case in take-number order (for CaseDetail). No ownership check. */
export function listCaseTakes(ctx: AppContext, caseId: string): Take[] {
  return allRows<TakeRow>(ctx.db, "SELECT * FROM takes WHERE case_id = ? ORDER BY number", caseId)
    .map((r) => reconcileExportState(ctx, r))
    .map((r) => toTakeDto(ctx, r));
}
