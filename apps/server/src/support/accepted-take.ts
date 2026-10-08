import type { Db } from "../db/index.ts";
import { getRow } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { AssetRow, ReviewRow, TakeRow } from "./rows.ts";

/**
 * A take may leave its case (customer ticket or support reply) only as the exact reviewed bytes:
 * complete capture, ready MP4, review state accepted, and the latest review an `accept` bound to
 * the take's current final hash, which must equal the stored final asset's hash (spec 5, 12).
 */
export interface AcceptedTake {
  take: TakeRow;
  finalAsset: AssetRow;
  review: ReviewRow;
}

const TAKE_COLUMNS = `id, case_id, purpose, number, plan_revision_id, product_revision_id,
  capture_status, processing_state, review_state, final_asset_id, duration_ms, sha256, caption,
  current_assessment_id`;

export function getTake(db: Db, takeId: string): TakeRow | undefined {
  return getRow<TakeRow>(db, `SELECT ${TAKE_COLUMNS} FROM takes WHERE id = ?`, takeId);
}

export function getLatestReview(db: Db, takeId: string): ReviewRow | undefined {
  return getRow<ReviewRow>(
    db,
    `SELECT id, take_id, final_sha256, decision, resulting_state, uncertainty_note, created_at,
            reviewer_role, override_check_status, override_reason
     FROM reviews WHERE take_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    takeId,
  );
}

export function getLiveAsset(db: Db, assetId: string): AssetRow | undefined {
  return getRow<AssetRow>(db, "SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL", assetId);
}

/** Throws a bounded AppError unless `take` is an accepted take with current hash bindings. */
export function requireAcceptedTake(
  db: Db,
  take: TakeRow,
  notAcceptedMessage: string,
): AcceptedTake {
  if (take.capture_status !== "complete") throw new AppError("CAPTURE_INCOMPLETE");
  if (take.processing_state !== "ready" || !take.final_asset_id || !take.sha256) {
    throw new AppError("TAKE_NOT_READY");
  }
  const review = getLatestReview(db, take.id);
  if (
    take.review_state !== "accepted" ||
    !review ||
    review.decision !== "accept" ||
    review.resulting_state !== "accepted" ||
    review.final_sha256 !== take.sha256
  ) {
    throw new AppError("REVIEW_CONFLICT", notAcceptedMessage);
  }
  const finalAsset = getLiveAsset(db, take.final_asset_id);
  if (!finalAsset || finalAsset.case_id !== take.case_id || finalAsset.sha256 !== take.sha256) {
    throw new AppError("REVIEW_CONFLICT", notAcceptedMessage);
  }
  return { take, finalAsset, review };
}
