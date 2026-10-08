import { rm } from "node:fs/promises";
import type { Request, Router } from "express";
import multer from "multer";
import {
  CreateReviewRequest,
  type CreateTakeResponse,
  CreateTakeMeta,
  type GetTakeResponse,
  LIMITS,
  ROUTES,
  RetryExportRequest,
  TAKE_UPLOAD_FIELDS,
  type TakeMessageResponse,
  type TakeResponse,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { getRow } from "../db/index.ts";
import { composeTakeMessage, takeDownloadFilename } from "../domain/explanations.ts";
import { recordReview } from "../domain/reviews.ts";
import { createTakeFromUpload } from "../domain/take-upload.ts";
import {
  assetPath,
  getAssetRow,
  loadOwnedCase,
  loadOwnedTake,
  rawRecordingRetained,
  type TakeRow,
  toTakeDto,
} from "../domain/takes.ts";
import { AppError } from "../http/errors.ts";
import { sendFileWithRange } from "../http/range.ts";
import { guard, requireCustomerAccess, requireSession } from "../http/session.ts";
import { param, parseBody, parseJsonField } from "../http/validate.ts";
import { sha256File } from "../media/export-pipeline.ts";
import { registerExportWorker, retryExport } from "../media/export-worker.ts";

/**
 * Takes (spec 11, 12): upload -> export job -> poll -> review -> download / explanation.
 * Every route is owner-only; a support role does not bypass ownership (spec 14).
 */

/** Legacy alias accepted for the recording part (contract name is TAKE_UPLOAD_FIELDS.recording). */
const RECORDING_FIELD_ALIAS = "file";

function uploadedFiles(req: Request): Express.Multer.File[] {
  const files = req.files;
  if (!files) return [];
  return Array.isArray(files) ? files : Object.values(files).flat();
}

/** Final MP4 path of a ready take, or a bounded error. */
function finalMediaPath(ctx: AppContext, take: TakeRow): string {
  if (take.capture_status !== "complete") throw new AppError("CAPTURE_INCOMPLETE");
  if (take.processing_state !== "ready" || !take.final_asset_id) {
    throw new AppError("TAKE_NOT_READY");
  }
  const file = assetPath(ctx, getAssetRow(ctx.db, take.final_asset_id));
  if (!file) throw new AppError("NOT_FOUND");
  return file;
}

export function register(router: Router, ctx: AppContext): void {
  registerExportWorker(ctx);

  const upload = multer({
    dest: ctx.paths.tmp,
    limits: {
      fileSize: LIMITS.recordingMaxBytes,
      files: 1,
      fields: 4,
      parts: 6,
      fieldSize: 64 * 1024,
    },
  }).fields([
    { name: TAKE_UPLOAD_FIELDS.recording, maxCount: 1 },
    { name: RECORDING_FIELD_ALIAS, maxCount: 1 },
  ]);

  router.post(
    ROUTES.caseTakes,
    guard.customerAccess(),
    // Reject before any bytes hit disk when the case is not the caller's active case.
    (req, _res, next) => {
      loadOwnedCase(ctx, requireCustomerAccess(req), param(req, "caseId"));
      next();
    },
    upload,
    async (req, res) => {
      const files = uploadedFiles(req);
      try {
        const session = requireCustomerAccess(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const meta = parseJsonField(CreateTakeMeta, body[TAKE_UPLOAD_FIELDS.meta]);
        const file = files[0];
        const { take } = await createTakeFromUpload(
          ctx,
          session,
          param(req, "caseId"),
          meta,
          file ? { tmpPath: file.path, sizeBytes: file.size } : null,
        );
        res.status(202).json({ take } satisfies CreateTakeResponse);
      } finally {
        // No-op when the recording was moved into private storage.
        await Promise.all(files.map((f) => rm(f.path, { force: true }).catch(() => undefined)));
      }
    },
  );

  router.get(ROUTES.take, (req, res) => {
    const { take } = loadOwnedTake(ctx, requireSession(req), param(req, "takeId"));
    res.json({ take: toTakeDto(ctx, take) } satisfies GetTakeResponse);
  });

  router.get(ROUTES.takeMedia, async (req, res) => {
    const { take } = loadOwnedTake(ctx, requireSession(req), param(req, "takeId"));
    await sendFileWithRange(res, finalMediaPath(ctx, take), "video/mp4");
  });

  router.post(ROUTES.takeRetryExport, (req, res) => {
    parseBody(RetryExportRequest, req);
    const { take } = loadOwnedTake(ctx, requireSession(req), param(req, "takeId"));
    if (take.capture_status !== "complete") throw new AppError("CAPTURE_INCOMPLETE");
    if (take.processing_state === "failed") {
      if (take.retryable !== 1 || !rawRecordingRetained(ctx, take)) {
        throw new AppError(
          "EXPORT_FAILED",
          "This recording cannot be converted again. Record a new take.",
          409,
        );
      }
      retryExport(ctx, take.id);
    }
    // ready: never reconverted; queued/converting: the existing active job stands.
    const { take: fresh } = loadOwnedTake(ctx, requireSession(req), take.id);
    res.status(202).json({ take: toTakeDto(ctx, fresh) } satisfies TakeResponse);
  });

  router.post(ROUTES.takeReview, (req, res) => {
    const body = parseBody(CreateReviewRequest, req);
    const take = recordReview(ctx, requireSession(req), param(req, "takeId"), body);
    res.json({ take } satisfies TakeResponse);
  });

  router.get(ROUTES.takeDownload, async (req, res) => {
    const { take } = loadOwnedTake(ctx, requireSession(req), param(req, "takeId"));
    const file = finalMediaPath(ctx, take);
    if (take.review_state !== "accepted") {
      throw new AppError("REVIEW_CONFLICT", "Accept this take before downloading it.");
    }
    const accepted = getRow<{ final_sha256: string }>(
      ctx.db,
      `SELECT final_sha256 FROM reviews WHERE take_id = ? AND resulting_state = 'accepted'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      take.id,
    );
    // Same bytes as reviewed (spec 12): the accepted hash, the take hash and the file agree.
    if (!accepted || accepted.final_sha256 !== take.sha256) {
      throw new AppError("REVIEW_CONFLICT");
    }
    if ((await sha256File(file)) !== take.sha256) {
      console.error(`[takes] final hash mismatch take=${take.id}`);
      throw new AppError("INTERNAL_ERROR");
    }
    await sendFileWithRange(res, file, "video/mp4", { download: takeDownloadFilename(take) });
  });

  router.get(ROUTES.takeMessage, (req, res) => {
    const { take, kase } = loadOwnedTake(ctx, requireSession(req), param(req, "takeId"));
    finalMediaPath(ctx, take);
    res.json(composeTakeMessage(ctx, take, kase) satisfies TakeMessageResponse);
  });
}
