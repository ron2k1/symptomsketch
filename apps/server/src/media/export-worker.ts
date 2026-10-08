import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { type ErrorCode, LIMITS } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { newId, now, tx } from "../db/index.ts";
import { JOB_KINDS, JobError, type JobQueue } from "../db/jobs.ts";
import { enqueueAssessment } from "../domain/assessments.ts";
import {
  assetPath,
  exportJobKey,
  getAssetRow,
  getCaseRow,
  getTakeRow,
  isCaseActive,
  rawRecordingRetained,
} from "../domain/takes.ts";
import { type ExportedMedia, exportRecording } from "./export-pipeline.ts";
import { caseStoragePath, resolveStoragePath } from "./files.ts";

/**
 * Export job (spec 12): runs the export pipeline for a take, publishes the final MP4 +
 * thumbnail immutably (atomic rename, then one transaction that re-checks the case lifecycle),
 * then queues the separate visual check against those exact bytes.
 */

function markFailed(ctx: AppContext, takeId: string, code: ErrorCode, retryable: boolean): void {
  ctx.db
    .prepare(
      `UPDATE takes SET processing_state = 'failed', error_code = ?, retryable = ?, updated_at = ?
       WHERE id = ? AND processing_state != 'ready'`,
    )
    .run(code, retryable ? 1 : 0, now(), takeId);
}

export interface ExportJobResult {
  takeId: string;
  sha256: string;
}

/**
 * Run one export for a take. Idempotent: a ready take is never reconverted (spec 11). Re-checks
 * the case lifecycle before publishing; deleted/expired cases never get private output.
 */
export async function runExportJob(
  ctx: AppContext,
  takeId: string,
  signal?: AbortSignal,
): Promise<ExportJobResult> {
  const started = Date.now();
  const take = getTakeRow(ctx.db, takeId);
  if (!take) throw new JobError("NOT_FOUND");
  if (take.processing_state === "ready" && take.sha256) return { takeId, sha256: take.sha256 };
  if (take.capture_status !== "complete" || take.first_output_offset_ms === null) {
    markFailed(ctx, takeId, "CAPTURE_INCOMPLETE", false);
    throw new JobError("CAPTURE_INCOMPLETE");
  }
  if (!isCaseActive(getCaseRow(ctx.db, take.case_id))) {
    markFailed(ctx, takeId, "CASE_INACTIVE", false);
    throw new JobError("CASE_INACTIVE");
  }
  const rawAsset = take.raw_asset_id ? getAssetRow(ctx.db, take.raw_asset_id) : undefined;
  const rawPath = assetPath(ctx, rawAsset);
  if (!rawPath || !existsSync(rawPath)) {
    markFailed(ctx, takeId, "EXPORT_FAILED", false);
    throw new JobError("EXPORT_FAILED");
  }
  ctx.db
    .prepare(
      `UPDATE takes SET processing_state = 'converting', error_code = NULL, retryable = 0,
         updated_at = ? WHERE id = ?`,
    )
    .run(now(), takeId);

  let media: ExportedMedia;
  try {
    media = await exportRecording(
      { ffmpegPath: ctx.config.ffmpegPath, ffprobePath: ctx.config.ffprobePath },
      {
        rawPath,
        firstOutputOffsetMs: take.first_output_offset_ms,
        workDir: ctx.paths.tmp,
        signal,
      },
    );
  } catch (err) {
    const code = err instanceof JobError ? err.code : "EXPORT_FAILED";
    const retryable = (err instanceof JobError ? err.retryable : true) && !!rawAsset;
    markFailed(ctx, takeId, code, retryable && rawRecordingRetained(ctx, take));
    throw err instanceof JobError ? err : new JobError(code, { retryable });
  }

  // Immutable final files, named by fresh asset ids (never overwrite an earlier output).
  const finalId = newId("ast");
  const thumbId = newId("ast");
  const finalRel = caseStoragePath("finals", take.case_id, finalId, "mp4");
  const thumbRel = caseStoragePath("thumbnails", take.case_id, thumbId, "jpg");
  const finalAbs = resolveStoragePath(ctx.paths, finalRel);
  const thumbAbs = resolveStoragePath(ctx.paths, thumbRel);
  const discard = async () => {
    for (const f of [media.mp4Path, media.thumbnailPath, finalAbs, thumbAbs]) {
      await rm(f, { force: true }).catch(() => undefined);
    }
  };
  let published = false;
  try {
    await mkdir(path.dirname(finalAbs), { recursive: true });
    await mkdir(path.dirname(thumbAbs), { recursive: true });
    await rename(media.mp4Path, finalAbs);
    await rename(media.thumbnailPath, thumbAbs);
    published = tx(ctx.db, () => {
      const kase = getCaseRow(ctx.db, take.case_id);
      const current = getTakeRow(ctx.db, takeId);
      if (!isCaseActive(kase) || !current || current.processing_state === "ready") return false;
      const ts = now();
      const insert = ctx.db.prepare(
        `INSERT INTO assets (id, case_id, owner_session_id, kind, mime, size_bytes, width, height,
           duration_ms, sha256, filename, storage_path, source_asset_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        finalId,
        kase.id,
        kase.owner_session_id,
        "final_mp4",
        "video/mp4",
        media.sizeBytes,
        media.width,
        media.height,
        media.durationMs,
        media.sha256,
        null,
        finalRel,
        take.raw_asset_id,
        ts,
      );
      insert.run(
        thumbId,
        kase.id,
        kase.owner_session_id,
        "take_thumbnail",
        "image/jpeg",
        media.thumbnailSizeBytes,
        null,
        null,
        null,
        media.thumbnailSha256,
        null,
        thumbRel,
        finalId,
        ts,
      );
      ctx.db
        .prepare(
          `UPDATE takes SET processing_state = 'ready', final_asset_id = ?, thumbnail_asset_id = ?,
             duration_ms = ?, size_bytes = ?, sha256 = ?, width = ?, height = ?, error_code = NULL,
             retryable = 0, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          finalId,
          thumbId,
          media.durationMs,
          media.sizeBytes,
          media.sha256,
          media.width,
          media.height,
          ts,
          takeId,
        );
      return true;
    });
  } catch (err) {
    await discard();
    markFailed(ctx, takeId, "EXPORT_FAILED", rawRecordingRetained(ctx, take));
    throw err instanceof JobError ? err : new JobError("EXPORT_FAILED", { retryable: true });
  }
  if (!published) {
    await discard();
    const after = getTakeRow(ctx.db, takeId);
    if (after?.processing_state === "ready" && after.sha256) {
      return { takeId, sha256: after.sha256 };
    }
    markFailed(ctx, takeId, "CASE_INACTIVE", false);
    throw new JobError("CASE_INACTIVE");
  }

  console.log(`[export] ${takeId} final ready ms=${Date.now() - started}`);
  queueAssessment(ctx, takeId);
  return { takeId, sha256: media.sha256 };
}

/** Queue the separate visual check against the exact final bytes (server-ai owns the job). */
function queueAssessment(ctx: AppContext, takeId: string): void {
  try {
    void Promise.resolve(enqueueAssessment(ctx, takeId)).catch((err: unknown) => {
      console.error(`[export] assessment enqueue failed: ${(err as Error)?.name ?? "Error"}`);
    });
  } catch (err) {
    console.error(`[export] assessment enqueue failed: ${(err as Error)?.name ?? "Error"}`);
  }
}

const registered = new WeakSet<JobQueue>();

/**
 * Register the export job handler (once per queue) and resume exports interrupted by a restart
 * (recoverJobs marked them retryable). Spec 27: restart recovers interrupted jobs.
 */
export function registerExportWorker(ctx: AppContext): void {
  if (registered.has(ctx.jobs)) return;
  registered.add(ctx.jobs);
  ctx.jobs.registerJobHandler<{ takeId: string }>(JOB_KINDS.takeExport, {
    concurrency: ctx.config.maxExportJobs,
    timeoutMs: LIMITS.exportJobTimeoutMs,
    timeoutCode: "EXPORT_FAILED",
    handler: async (payload, _job, signal) => runExportJob(ctx, payload.takeId, signal),
  });
  resumeInterruptedExports(ctx);
}

/** Interrupted (not failed) exports go back on the queue at startup, at most twice per take. */
export function resumeInterruptedExports(ctx: AppContext): number {
  const rows = ctx.db
    .prepare(
      `SELECT t.id AS take_id, j.id AS job_id FROM takes t
       JOIN jobs j ON j.idempotency_key = ? || ':' || t.id
       WHERE t.processing_state IN ('queued','converting') AND j.status = 'retryable'
         AND j.error_code = 'INTERNAL_ERROR' AND j.attempts < 3`,
    )
    .all(JOB_KINDS.takeExport) as { take_id: string; job_id: string }[];
  let resumed = 0;
  for (const r of rows) {
    const take = getTakeRow(ctx.db, r.take_id);
    if (!take || !isCaseActive(getCaseRow(ctx.db, take.case_id))) continue;
    if (!rawRecordingRetained(ctx, take)) continue;
    ctx.db
      .prepare("UPDATE takes SET processing_state = 'queued', updated_at = ? WHERE id = ?")
      .run(now(), take.id);
    ctx.jobs.requeueJob(r.job_id);
    resumed += 1;
  }
  return resumed;
}

/** Explicit retry (spec 11): only failed + retryable takes with the raw recording retained. */
export function retryExport(ctx: AppContext, takeId: string): void {
  const take = getTakeRow(ctx.db, takeId);
  if (!take) return;
  const job = ctx.jobs.findByKey(exportJobKey(takeId));
  if (!job) return;
  tx(ctx.db, () => {
    ctx.db
      .prepare(
        `UPDATE takes SET processing_state = 'queued', error_code = NULL, retryable = 0,
           updated_at = ? WHERE id = ? AND processing_state = 'failed'`,
      )
      .run(now(), takeId);
    ctx.jobs.requeueJob(job.id);
  });
}
