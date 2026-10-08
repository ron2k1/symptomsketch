import { open, rename, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  type CaptureReason,
  type CreateTakeMeta,
  LIMITS,
  type Take,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { type Db, getRow, newId, now, tx } from "../db/index.ts";
import { JOB_KINDS } from "../db/jobs.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import { caseStoragePath, resolveStoragePath } from "../media/files.ts";
import { sha256File } from "../media/export-pipeline.ts";
import { exportJobKey, getTakeRow, loadOwnedCase, type TakeRow, toTakeDto } from "./takes.ts";

/**
 * POST /api/cases/:id/takes (spec 11, 12): validate ownership + frozen revision relationships,
 * store the raw recording privately, create the take, queue the export. Incomplete captures are
 * stored as incomplete takes (never exported, never acceptable).
 */

export interface UploadedRecording {
  /** multer temp file inside DATA_DIR/tmp. The caller removes it if it was not moved. */
  tmpPath: string;
  sizeBytes: number;
}

export type RecordingContainer = "webm" | "mp4";

const RECORDING_MIME: Record<RecordingContainer, string> = {
  webm: "video/webm",
  mp4: "video/mp4",
};

/** Declared MediaRecorder MIME base type must be WebM or MP4 (codecs params allowed). */
export function declaredContainer(mimeType: string): RecordingContainer | null {
  const base = mimeType.split(";")[0]?.trim().toLowerCase();
  if (base === "video/webm" || base === "video/x-matroska") return "webm";
  if (base === "video/mp4") return "mp4";
  return null;
}

/** Sniff the real container from magic bytes (EBML header or ISO BMFF `ftyp`). */
export async function sniffContainer(file: string): Promise<RecordingContainer | null> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fh.read(buf, 0, 12, 0);
    if (bytesRead >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return "webm";
    if (bytesRead >= 8 && buf.toString("latin1", 4, 8) === "ftyp") return "mp4";
    return null;
  } finally {
    await fh.close();
  }
}

interface PlanLinkRow {
  id: string;
  case_id: string;
  purpose: string;
  product_revision_id: string;
  procedure_revision_id: string | null;
  status: string;
  caption: string;
}

/**
 * Relationship checks frozen at take creation (spec 10): the URL case owns the plan, product and
 * procedure; the plan is ready, has the take's purpose, and was planned against exactly this
 * product (and procedure) revision.
 */
export function validateTakeRevisions(db: Db, caseId: string, meta: CreateTakeMeta): PlanLinkRow {
  const plan = getRow<PlanLinkRow>(
    db,
    `SELECT id, case_id, purpose, product_revision_id, procedure_revision_id, status, caption
     FROM plan_revisions WHERE id = ?`,
    meta.planRevisionId,
  );
  if (!plan || plan.case_id !== caseId) {
    throw new AppError("PLAN_CONFLICT", "The plan does not belong to this case.");
  }
  if (plan.status !== "ready") {
    throw new AppError("PLAN_CONFLICT", "The plan is not ready for recording.");
  }
  if (plan.purpose !== meta.purpose) {
    throw new AppError("PLAN_CONFLICT", "The plan was made for a different purpose.");
  }
  if (plan.product_revision_id !== meta.productRevisionId) {
    throw new AppError("PLAN_CONFLICT", "The plan was made for a different product reference.");
  }
  const product = getRow<{ case_id: string }>(
    db,
    "SELECT case_id FROM product_revisions WHERE id = ?",
    meta.productRevisionId,
  );
  if (!product || product.case_id !== caseId) {
    throw new AppError("PLAN_CONFLICT", "The product reference does not belong to this case.");
  }
  if ((meta.procedureRevisionId ?? null) !== (plan.procedure_revision_id ?? null)) {
    throw new AppError("PLAN_CONFLICT", "The procedure does not match the plan.");
  }
  if (plan.procedure_revision_id) {
    const proc = getRow<{ case_id: string; product_revision_id: string }>(
      db,
      "SELECT case_id, product_revision_id FROM procedure_revisions WHERE id = ?",
      plan.procedure_revision_id,
    );
    if (!proc || proc.case_id !== caseId || proc.product_revision_id !== meta.productRevisionId) {
      throw new AppError(
        "PLAN_CONFLICT",
        "The procedure does not apply to this product reference.",
      );
    }
  }
  return plan;
}

function findByIdempotencyKey(db: Db, caseId: string, key: string): TakeRow | undefined {
  const row = getRow<{ id: string }>(
    db,
    "SELECT id FROM takes WHERE case_id = ? AND idempotency_key = ?",
    caseId,
    key,
  );
  return row ? getTakeRow(db, row.id) : undefined;
}

export async function createTakeFromUpload(
  ctx: AppContext,
  session: SessionInfo,
  caseId: string,
  meta: CreateTakeMeta,
  upload: UploadedRecording | null,
): Promise<{ take: Take; created: boolean }> {
  const kase = loadOwnedCase(ctx, session, caseId);
  const existing = findByIdempotencyKey(ctx.db, kase.id, meta.idempotencyKey);
  if (existing) return { take: toTakeDto(ctx, existing), created: false };

  const plan = validateTakeRevisions(ctx.db, kase.id, meta);
  const complete = meta.captureStatus === "complete" && meta.firstOutputOffsetMs !== null;
  const captureReason: CaptureReason | null = complete
    ? null
    : (meta.captureReason ?? (meta.firstOutputOffsetMs === null ? "output_timeout" : null));

  // Complete captures need a real WebM/MP4 recording within the raw limits.
  let container: RecordingContainer | null = null;
  if (complete) {
    if (!upload || upload.sizeBytes === 0) {
      throw new AppError("RECORDING_UNSUPPORTED", "The recording file is missing.");
    }
    if (upload.sizeBytes > LIMITS.recordingMaxBytes) throw new AppError("PAYLOAD_TOO_LARGE");
    if (declaredContainer(meta.mimeType) === null) {
      throw new AppError("RECORDING_UNSUPPORTED", "Only WebM or MP4 recordings are supported.");
    }
    container = await sniffContainer(upload.tmpPath);
    if (container === null) {
      throw new AppError("RECORDING_UNSUPPORTED", "The recording is not a WebM or MP4 file.");
    }
    if (meta.recordedDurationMs > (LIMITS.recordingMaxSeconds + 2) * 1000) {
      throw new AppError("RECORDING_UNSUPPORTED", "The recording is longer than 35 seconds.");
    }
  }

  const takeId = newId("take");
  const ts = now();
  // Move the raw bytes into private storage before the transaction references them.
  let raw: { assetId: string; rel: string; abs: string; sha256: string } | null = null;
  if (complete && upload && container) {
    const assetId = newId("ast");
    const rel = caseStoragePath("recordings", kase.id, assetId, container);
    const abs = resolveStoragePath(ctx.paths, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await rename(upload.tmpPath, abs);
    raw = { assetId, rel, abs, sha256: await sha256File(abs) };
  }

  const caption = meta.caption.trim() !== "" ? meta.caption.trim() : plan.caption;
  let duplicate: TakeRow | null;
  try {
    duplicate = tx(ctx.db, (): TakeRow | null => {
      const dup = findByIdempotencyKey(ctx.db, kase.id, meta.idempotencyKey);
      if (dup) return dup;
      const counter = ctx.db
        .prepare(
          `UPDATE cases SET take_counter = take_counter + 1, updated_at = ?
           WHERE id = ? AND status = 'active' RETURNING take_counter`,
        )
        .get(ts, kase.id) as { take_counter: number } | undefined;
      if (!counter) throw new AppError("CASE_INACTIVE");
      if (raw && container) {
        ctx.db
          .prepare(
            `INSERT INTO assets (id, case_id, owner_session_id, kind, mime, size_bytes, sha256,
               filename, storage_path, created_at)
             VALUES (?, ?, ?, 'recording', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            raw.assetId,
            kase.id,
            kase.owner_session_id,
            RECORDING_MIME[container],
            upload?.sizeBytes ?? 0,
            raw.sha256,
            `recording.${container}`,
            raw.rel,
            ts,
          );
      }
      ctx.db
        .prepare(
          `INSERT INTO takes (id, case_id, purpose, number, plan_revision_id, product_revision_id,
             procedure_revision_id, run_id, capture_status, capture_reason, first_output_offset_ms,
             recorded_duration_ms, processing_state, review_state, raw_asset_id, caption,
             retryable, idempotency_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreviewed', ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          takeId,
          kase.id,
          meta.purpose,
          counter.take_counter,
          plan.id,
          plan.product_revision_id,
          plan.procedure_revision_id,
          meta.runId,
          complete ? "complete" : "incomplete",
          captureReason,
          meta.firstOutputOffsetMs,
          meta.recordedDurationMs,
          // Incomplete captures are never converted; "failed" keeps them off the export queue.
          complete ? "queued" : "failed",
          raw?.assetId ?? null,
          caption,
          meta.idempotencyKey,
          ts,
          ts,
        );
      if (!complete) {
        ctx.db
          .prepare("UPDATE takes SET error_code = 'CAPTURE_INCOMPLETE' WHERE id = ?")
          .run(takeId);
      } else {
        ctx.jobs.enqueueJob(JOB_KINDS.takeExport, { takeId }, exportJobKey(takeId), {
          caseId: kase.id,
        });
      }
      return null;
    });
  } catch (err) {
    if (raw) await rm(raw.abs, { force: true }).catch(() => undefined);
    throw err;
  }
  if (duplicate) {
    if (raw) await rm(raw.abs, { force: true }).catch(() => undefined);
    return { take: toTakeDto(ctx, duplicate), created: false };
  }
  const row = getTakeRow(ctx.db, takeId);
  if (!row) throw new AppError("INTERNAL_ERROR");
  return { take: toTakeDto(ctx, row), created: true };
}
