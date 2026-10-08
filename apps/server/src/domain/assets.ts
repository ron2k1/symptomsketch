import { paths as apiPaths, type AssetKind, type MediaAsset } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { getRow, newId, now, toJson } from "../db/index.ts";
import {
  caseStoragePath,
  removeStoredFile,
  sanitizeFilename,
  sha256Hex,
  writeFileAtomic,
} from "../media/files.ts";
import { IMAGE_EXT, processProductImage } from "../media/image.ts";

/** Row of the `assets` table (every stored file; storage_path is relative to DATA_DIR). */
export interface AssetRow {
  id: string;
  case_id: string;
  owner_session_id: string;
  kind: AssetKind;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sha256: string;
  filename: string | null;
  storage_path: string;
  source_asset_id: string | null;
  lineage_json: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** Kinds GET /api/assets/:id/media may stream. Take videos go through the take routes. */
export const INLINE_ASSET_KINDS: ReadonlySet<AssetKind> = new Set([
  "original",
  "normalized",
  "thumbnail",
  "take_thumbnail",
]);

/** Kinds GET /api/assets/:id/download may serve (owned reference photos only). */
export const DOWNLOAD_ASSET_KINDS: ReadonlySet<AssetKind> = new Set(["original", "normalized"]);

/** DTO with authorized URLs by opaque id (never a filesystem path). */
export function toMediaAsset(row: AssetRow): MediaAsset {
  return {
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    filename: row.filename,
    mediaUrl: apiPaths.assetMedia(row.id),
    downloadUrl: DOWNLOAD_ASSET_KINDS.has(row.kind) ? apiPaths.assetDownload(row.id) : null,
    createdAt: row.created_at,
  };
}

export interface NewAsset {
  id?: string;
  caseId: string;
  ownerSessionId: string;
  kind: AssetKind;
  mime: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  sha256: string;
  filename?: string | null;
  storagePath: string;
  sourceAssetId?: string | null;
  lineage?: unknown;
}

/** Insert an asset row (call inside the caller's transaction). Returns the stored row. */
export function insertAsset(ctx: AppContext, a: NewAsset): AssetRow {
  const id = a.id ?? newId("ast");
  ctx.db
    .prepare(
      `INSERT INTO assets (id, case_id, owner_session_id, kind, mime, size_bytes, width, height,
         duration_ms, sha256, filename, storage_path, source_asset_id, lineage_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      a.caseId,
      a.ownerSessionId,
      a.kind,
      a.mime,
      a.sizeBytes,
      a.width ?? null,
      a.height ?? null,
      a.durationMs ?? null,
      a.sha256,
      a.filename ?? null,
      a.storagePath,
      a.sourceAssetId ?? null,
      a.lineage === undefined ? null : toJson(a.lineage),
      now(),
    );
  const row = getAssetRow(ctx, id);
  if (!row) throw new Error("asset insert failed");
  return row;
}

export function getAssetRow(ctx: AppContext, assetId: string): AssetRow | undefined {
  return getRow<AssetRow>(ctx.db, "SELECT * FROM assets WHERE id = ?", assetId);
}

/**
 * Asset owned by `sessionId` in an active case, or undefined (callers answer NOT_FOUND so foreign
 * ids are indistinguishable from missing ones). Support sessions get no bypass.
 */
export function getOwnedActiveAsset(
  ctx: AppContext,
  sessionId: string,
  assetId: string,
): AssetRow | undefined {
  return getRow<AssetRow>(
    ctx.db,
    `SELECT a.* FROM assets a JOIN cases c ON c.id = a.case_id
     WHERE a.id = ? AND a.owner_session_id = ? AND c.owner_session_id = ?
       AND a.deleted_at IS NULL AND c.status = 'active'`,
    assetId,
    sessionId,
    sessionId,
  );
}

/** Files written for one validated photo; DB rows are inserted later by commitImageAssets. */
export interface StagedImage {
  caseId: string;
  ownerSessionId: string;
  filename: string;
  original: {
    id: string;
    rel: string;
    mime: string;
    size: number;
    sha256: string;
    w: number;
    h: number;
  };
  normalized: { id: string; rel: string; size: number; sha256: string; w: number; h: number };
  lineage: Record<string, unknown>;
}

/**
 * Validate + normalize a photo and write both files atomically under DATA_DIR. Nothing is in the
 * database yet; on any later failure call discardStagedImage. Throws ImageRejectedError.
 */
export async function stageImage(
  ctx: AppContext,
  input: {
    caseId: string;
    ownerSessionId: string;
    bytes: Buffer;
    filename: string | null | undefined;
    lineage: Record<string, unknown>;
  },
): Promise<StagedImage> {
  const processed = await processProductImage(input.bytes);
  const originalId = newId("ast");
  const normalizedId = newId("ast");
  const ext = IMAGE_EXT[processed.mime];
  const staged: StagedImage = {
    caseId: input.caseId,
    ownerSessionId: input.ownerSessionId,
    filename: sanitizeFilename(input.filename, `product-photo.${ext}`),
    original: {
      id: originalId,
      rel: caseStoragePath("originals", input.caseId, originalId, ext),
      mime: processed.mime,
      size: input.bytes.length,
      sha256: sha256Hex(input.bytes),
      w: processed.width,
      h: processed.height,
    },
    normalized: {
      id: normalizedId,
      rel: caseStoragePath("normalized", input.caseId, normalizedId, "jpg"),
      size: processed.normalized.data.length,
      sha256: sha256Hex(processed.normalized.data),
      w: processed.normalized.width,
      h: processed.normalized.height,
    },
    lineage: input.lineage,
  };
  try {
    await writeFileAtomic(ctx.paths, staged.original.rel, input.bytes);
    await writeFileAtomic(ctx.paths, staged.normalized.rel, processed.normalized.data);
  } catch (err) {
    await discardStagedImage(ctx, staged);
    throw err;
  }
  return staged;
}

export async function discardStagedImage(ctx: AppContext, staged: StagedImage): Promise<void> {
  await removeStoredFile(ctx.paths, staged.original.rel);
  await removeStoredFile(ctx.paths, staged.normalized.rel);
}

/** Insert the original + normalized rows for a staged image (call inside a transaction). */
export function commitImageAssets(
  ctx: AppContext,
  staged: StagedImage,
): { original: AssetRow; normalized: AssetRow } {
  const original = insertAsset(ctx, {
    id: staged.original.id,
    caseId: staged.caseId,
    ownerSessionId: staged.ownerSessionId,
    kind: "original",
    mime: staged.original.mime,
    sizeBytes: staged.original.size,
    width: staged.original.w,
    height: staged.original.h,
    sha256: staged.original.sha256,
    filename: staged.filename,
    storagePath: staged.original.rel,
    lineage: staged.lineage,
  });
  const base = staged.filename.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const normalized = insertAsset(ctx, {
    id: staged.normalized.id,
    caseId: staged.caseId,
    ownerSessionId: staged.ownerSessionId,
    kind: "normalized",
    mime: "image/jpeg",
    sizeBytes: staged.normalized.size,
    width: staged.normalized.w,
    height: staged.normalized.h,
    sha256: staged.normalized.sha256,
    filename: `${base}-reference.jpg`,
    storagePath: staged.normalized.rel,
    sourceAssetId: original.id,
    lineage: { derivedFrom: original.id, op: "auto-orient, long edge <= 1280, metadata stripped" },
  });
  return { original, normalized };
}
