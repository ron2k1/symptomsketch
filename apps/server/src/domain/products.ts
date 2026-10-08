import type { ProductRevision, SourceType } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { allRows, fromJson, getRow, newId, now, toJson } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import { type AssetRow, toMediaAsset } from "./assets.ts";

/**
 * Immutable product reference revisions (spec 3, 10). Selecting or uploading a reference always
 * creates a new revision and moves the case pointer; older plans and takes keep the revision they
 * were created with.
 */

export interface ProductRevisionRow {
  id: string;
  case_id: string;
  source_type: SourceType;
  fixture_id: string | null;
  original_asset_id: string;
  normalized_asset_id: string;
  model_label: string | null;
  confirmed_features_json: string;
  source_hash: string;
  created_at: string;
}

export function getProductRevisionRow(
  ctx: AppContext,
  revisionId: string,
): ProductRevisionRow | undefined {
  return getRow<ProductRevisionRow>(
    ctx.db,
    "SELECT * FROM product_revisions WHERE id = ?",
    revisionId,
  );
}

function assetMap(ctx: AppContext, caseId: string): Map<string, AssetRow> {
  const rows = allRows<AssetRow>(ctx.db, "SELECT * FROM assets WHERE case_id = ?", caseId);
  return new Map(rows.map((r) => [r.id, r]));
}

function toDto(row: ProductRevisionRow, assets: Map<string, AssetRow>): ProductRevision | null {
  const original = assets.get(row.original_asset_id);
  const normalized = assets.get(row.normalized_asset_id);
  if (!original || !normalized) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    sourceType: row.source_type,
    fixtureId: row.fixture_id,
    modelLabel: row.model_label,
    confirmedFeatures: fromJson<string[]>(row.confirmed_features_json, []),
    sourceHash: row.source_hash,
    original: toMediaAsset(original),
    normalized: toMediaAsset(normalized),
    createdAt: row.created_at,
  };
}

/** All revisions of a case, oldest first (CaseDetail.products is "newest last"). */
export function listProductRevisions(ctx: AppContext, caseId: string): ProductRevision[] {
  const rows = allRows<ProductRevisionRow>(
    ctx.db,
    "SELECT * FROM product_revisions WHERE case_id = ? ORDER BY created_at, rowid",
    caseId,
  );
  const assets = assetMap(ctx, caseId);
  return rows.map((r) => toDto(r, assets)).filter((p): p is ProductRevision => p !== null);
}

/** One revision as a DTO (must belong to `caseId`). */
export function getProductRevision(
  ctx: AppContext,
  caseId: string,
  revisionId: string,
): ProductRevision | null {
  const row = getProductRevisionRow(ctx, revisionId);
  if (!row || row.case_id !== caseId) return null;
  return toDto(row, assetMap(ctx, caseId));
}

export interface NewProductRevision {
  caseId: string;
  sourceType: SourceType;
  fixtureId: string | null;
  original: AssetRow;
  normalized: AssetRow;
  modelLabel: string | null;
  confirmedFeatures?: readonly string[];
}

/**
 * Insert a revision and make it the case's current reference (call inside a transaction).
 * source_hash = SHA-256 of the untouched original bytes.
 */
export function createProductRevision(
  ctx: AppContext,
  input: NewProductRevision,
): ProductRevisionRow {
  if (input.original.case_id !== input.caseId || input.normalized.case_id !== input.caseId) {
    throw new AppError("NOT_FOUND");
  }
  const id = newId("prod");
  const ts = now();
  ctx.db
    .prepare(
      `INSERT INTO product_revisions (id, case_id, source_type, fixture_id, original_asset_id,
         normalized_asset_id, model_label, confirmed_features_json, source_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.caseId,
      input.sourceType,
      input.fixtureId,
      input.original.id,
      input.normalized.id,
      input.modelLabel,
      toJson(input.confirmedFeatures ?? []),
      input.original.sha256,
      ts,
    );
  ctx.db
    .prepare("UPDATE cases SET product_revision_id = ?, updated_at = ? WHERE id = ?")
    .run(id, ts, input.caseId);
  const row = getProductRevisionRow(ctx, id);
  if (!row) throw new Error("product revision insert failed");
  return row;
}

/**
 * Model label change from PATCH /api/cases/:id (call inside a transaction). The current revision
 * is updated in place only while no plan or take depends on it; otherwise it stays frozen with
 * the label its plans/takes were made with, and the new label (kept on the case row) is used for
 * the next revision.
 */
export function relabelCurrentProduct(
  ctx: AppContext,
  caseId: string,
  currentRevisionId: string | null,
  modelLabel: string | null,
): void {
  if (!currentRevisionId) return;
  ctx.db
    .prepare(
      `UPDATE product_revisions SET model_label = ?
       WHERE id = ? AND case_id = ?
         AND NOT EXISTS (SELECT 1 FROM plan_revisions WHERE product_revision_id = product_revisions.id)
         AND NOT EXISTS (SELECT 1 FROM takes WHERE product_revision_id = product_revisions.id)`,
    )
    .run(modelLabel, currentRevisionId, caseId);
}
