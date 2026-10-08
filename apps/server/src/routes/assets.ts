import type { Router } from "express";
import multer from "multer";
import {
  ASSET_UPLOAD_FIELD,
  CreateProductRevisionRequest,
  LIMITS,
  ROUTES,
  type CreateProductRevisionResponse,
  type SourceType,
  type UploadAssetResult,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { getRow, tx } from "../db/index.ts";
import {
  type AssetRow,
  DOWNLOAD_ASSET_KINDS,
  INLINE_ASSET_KINDS,
  commitImageAssets,
  discardStagedImage,
  getOwnedActiveAsset,
  stageImage,
  type StagedImage,
  toMediaAsset,
} from "../domain/assets.ts";
import { getOwnedCase, requireOwnedCase } from "../domain/cases.ts";
import { createProductRevision, getProductRevision } from "../domain/products.ts";
import { AppError } from "../http/errors.ts";
import { sendFileWithRange } from "../http/range.ts";
import { requireSession } from "../http/session.ts";
import { param, parseBody } from "../http/validate.ts";
import { resolveStoragePath } from "../media/files.ts";
import { ImageRejectedError } from "../media/image.ts";

/**
 * POST /api/cases/:id/assets             multipart `file` -> UploadAssetResult (new current reference)
 * POST /api/cases/:id/product-revisions  CreateProductRevisionRequest -> CreateProductRevisionResponse
 * GET  /api/assets/:id/media             owned reference/thumbnail bytes inline (Range)
 * GET  /api/assets/:id/download          owned reference photo as an attachment
 * Media is owner-only: foreign, deleted or unknown ids all answer 404 NOT_FOUND.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.uploadMaxBytes, files: 1, fields: 4, parts: 5 },
});

function productResponse(ctx: AppContext, caseId: string, revisionId: string) {
  const product = getProductRevision(ctx, caseId, revisionId);
  if (!product) throw new AppError("INTERNAL_ERROR");
  return product;
}

export function register(router: Router, ctx: AppContext): void {
  router.post(
    ROUTES.caseAssets,
    // Ownership before buffering up to 10 MiB.
    (req, _res, next) => {
      requireOwnedCase(ctx, req, param(req, "caseId"), { paid: true });
      next();
    },
    upload.single(ASSET_UPLOAD_FIELD),
    async (req, res) => {
      const { session, caseRow } = requireOwnedCase(ctx, req, param(req, "caseId"), {
        paid: true,
      });
      const file = req.file;
      if (!file || file.buffer.length === 0) {
        throw new AppError("VALIDATION_FAILED", "Choose a JPEG, PNG or WebP photo to upload.");
      }
      let staged: StagedImage;
      try {
        staged = await stageImage(ctx, {
          caseId: caseRow.id,
          ownerSessionId: session.id,
          bytes: file.buffer,
          filename: file.originalname,
          lineage: { source: "upload" },
        });
      } catch (err) {
        if (err instanceof ImageRejectedError) {
          throw new AppError("SOURCE_INVALID", "Use a JPEG, PNG or WebP photo up to 10 MB.");
        }
        throw err;
      }
      let result: UploadAssetResult;
      try {
        result = tx(ctx.db, () => {
          // The case may have been deleted while the image was processing.
          const current = getOwnedCase(ctx, session, caseRow.id);
          const { original, normalized } = commitImageAssets(ctx, staged);
          const revision = createProductRevision(ctx, {
            caseId: current.id,
            sourceType: "uploaded_photo",
            fixtureId: null,
            original,
            normalized,
            modelLabel: current.model_label,
          });
          return {
            original: toMediaAsset(original),
            normalized: toMediaAsset(normalized),
            product: productResponse(ctx, current.id, revision.id),
          };
        });
      } catch (err) {
        await discardStagedImage(ctx, staged);
        throw err;
      }
      res.status(201).json(result);
    },
  );

  router.post(ROUTES.caseProductRevisions, (req, res) => {
    const { session, caseRow } = requireOwnedCase(ctx, req, param(req, "caseId"), { paid: true });
    const input = parseBody(CreateProductRevisionRequest, req);
    const original = getOwnedActiveAsset(ctx, session.id, input.originalAssetId);
    if (!original || original.case_id !== caseRow.id || original.kind !== "original") {
      throw new AppError("NOT_FOUND");
    }
    const normalized = getRow<AssetRow>(
      ctx.db,
      `SELECT * FROM assets WHERE source_asset_id = ? AND case_id = ? AND kind = 'normalized'
         AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      original.id,
      caseRow.id,
    );
    if (!normalized) throw new AppError("SOURCE_INVALID");
    // Keep the provenance of the photo: a copied demo fixture stays a Demo reference.
    const prior = getRow<{ source_type: SourceType; fixture_id: string | null }>(
      ctx.db,
      "SELECT source_type, fixture_id FROM product_revisions WHERE original_asset_id = ? LIMIT 1",
      original.id,
    );
    const label =
      input.modelLabel === undefined ? caseRow.model_label : input.modelLabel?.trim() || null;
    const features = (input.confirmedFeatures ?? []).map((f) => f.trim()).filter(Boolean);
    const body: CreateProductRevisionResponse = tx(ctx.db, () => {
      const revision = createProductRevision(ctx, {
        caseId: caseRow.id,
        sourceType: prior?.source_type ?? "uploaded_photo",
        fixtureId: prior?.fixture_id ?? null,
        original,
        normalized,
        modelLabel: label,
        confirmedFeatures: features,
      });
      if (input.modelLabel !== undefined && label !== caseRow.model_label) {
        ctx.db.prepare("UPDATE cases SET model_label = ? WHERE id = ?").run(label, caseRow.id);
      }
      return { product: productResponse(ctx, caseRow.id, revision.id) };
    });
    res.status(201).json(body);
  });

  router.get(ROUTES.assetMedia, async (req, res) => {
    const session = requireSession(req);
    const asset = getOwnedActiveAsset(ctx, session.id, param(req, "assetId"));
    if (!asset || !INLINE_ASSET_KINDS.has(asset.kind)) throw new AppError("NOT_FOUND");
    await sendFileWithRange(res, resolveStoragePath(ctx.paths, asset.storage_path), asset.mime);
  });

  router.get(ROUTES.assetDownload, async (req, res) => {
    const session = requireSession(req);
    const asset = getOwnedActiveAsset(ctx, session.id, param(req, "assetId"));
    if (!asset || !DOWNLOAD_ASSET_KINDS.has(asset.kind)) throw new AppError("NOT_FOUND");
    await sendFileWithRange(res, resolveStoragePath(ctx.paths, asset.storage_path), asset.mime, {
      download: asset.filename ?? `product-photo-${asset.id}`,
    });
  });
}
