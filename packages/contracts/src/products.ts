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

/** One box_2d coordinate: Gemini normalizes to 0..1000 of the image (docs/providers/gemini.md). */
const BoxCoord = z.number().min(0).max(1000);

/**
 * Gemini object-detection box for the product in the case's reference image:
 * [ymin, xmin, ymax, xmax] normalized to 0..1000. A degenerate (empty) box is rejected.
 */
export const Box2d = z
  .tuple([BoxCoord, BoxCoord, BoxCoord, BoxCoord])
  .refine(([ymin, xmin, ymax, xmax]) => ymax > ymin && xmax > xmin, {
    message: "box_2d must have ymax > ymin and xmax > xmin",
  });
export type Box2d = z.infer<typeof Box2d>;

/** Which way the product's front points in the photo (screen space). */
export const ProductFacing = z.enum(["left", "right"]);
export type ProductFacing = z.infer<typeof ProductFacing>;

/** Raw structured output of the product-box Gemini call (validated before anything is cached). */
export const GeminiProductBox = z.discriminatedUnion("found", [
  z.object({ found: z.literal(true), box_2d: Box2d, facing: ProductFacing }),
  z.object({ found: z.literal(false) }).passthrough(),
]);
export type GeminiProductBox = z.infer<typeof GeminiProductBox>;

/** GET /api/cases/:id/product-box: where the product sits in the current reference image. */
export const ProductBoxResponse = z.object({
  /** Normalized reference asset the box was measured on (the cache key). */
  assetId: Id,
  box2d: Box2d,
  facing: ProductFacing,
});
export type ProductBoxResponse = z.infer<typeof ProductBoxResponse>;
