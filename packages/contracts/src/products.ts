import { z } from "zod";
import { Id, Sha256, SourceType, Timestamp } from "./common.ts";
import { LIMITS } from "./limits.ts";

export const AssetKind = z.enum([
  "original",
  "normalized",
  "thumbnail",
  "recording",
  "final_mp4",
  "take_thumbnail",
]);
export type AssetKind = z.infer<typeof AssetKind>;

/**
 * A stored media file, addressed only by opaque id + authorized URLs (never filesystem paths).
 * `mediaUrl` = inline playback (byte ranges); `downloadUrl` = Content-Disposition attachment.
 */
export const MediaAsset = z.object({
  id: Id,
  kind: AssetKind,
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sha256: Sha256,
  filename: z.string().nullable(),
  mediaUrl: z.string(),
  downloadUrl: z.string().nullable(),
  createdAt: Timestamp,
});
export type MediaAsset = z.infer<typeof MediaAsset>;

/** Multipart field name for POST /api/cases/:id/assets. */
export const ASSET_UPLOAD_FIELD = "file";

/** POST /api/cases/:id/assets (multipart, field `file`) -> validated original + normalized copy. */
export const UploadAssetResponse = z.object({
  original: MediaAsset,
  normalized: MediaAsset,
});
export type UploadAssetResponse = z.infer<typeof UploadAssetResponse>;

/** Canonical, immutable product reference revision (spec 10). */
export const ProductRevision = z.object({
  id: Id,
  caseId: Id,
  sourceType: SourceType,
  fixtureId: z.string().nullable(),
  modelLabel: z.string().nullable(),
  confirmedFeatures: z.array(z.string()),
  sourceHash: Sha256,
  original: MediaAsset,
  normalized: MediaAsset,
  createdAt: Timestamp,
});
export type ProductRevision = z.infer<typeof ProductRevision>;

/** POST /api/cases/:id/product-revisions: select an uploaded original as the canonical reference. */
export const CreateProductRevisionRequest = z.object({
  originalAssetId: Id,
  modelLabel: z.string().max(LIMITS.modelLabelMaxChars).nullable().optional(),
  confirmedFeatures: z.array(z.string().max(200)).max(12).optional(),
});
export type CreateProductRevisionRequest = z.infer<typeof CreateProductRevisionRequest>;

export const CreateProductRevisionResponse = z.object({ product: ProductRevision });
export type CreateProductRevisionResponse = z.infer<typeof CreateProductRevisionResponse>;

/**
 * What POST /api/cases/:id/assets actually returns: UploadAssetResponse plus the new current
 * product revision the upload created (an upload always becomes the case's reference; spec 3).
 */
export const UploadAssetResult = UploadAssetResponse.extend({ product: ProductRevision });
export type UploadAssetResult = z.infer<typeof UploadAssetResult>;
