import {
  type CreateReviewRequest,
  REVIEW_DECISION_STATE,
  type Take,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { getRow, newId, now, tx } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import {
  type CheckState,
  checkState,
  currentAssessmentBinding,
  getCaseRow,
  getTakeRow,
  isCaseActive,
  type TakeRow,
  toTakeDto,
} from "./takes.ts";

/**
 * Human review of an exact final MP4 (spec 9 "Correction and review behavior", spec 11, 12).
 * Every check runs inside one transaction against the current rows:
 *   - owner + active case; complete capture; ready final MP4 whose hash equals finalSha256
 *   - assessmentId equals the assessment currently bound to these exact bytes + revisions
 *   - accept: never while the check is still running; never on needs_revision;
 *     problem (customer reenactment): uncertain / unavailable only with a review note;
 *     solution (instruction): only when every required constraint appears consistent (matches)
 *   - an accepted take already attached to a ticket cannot be un-accepted
 * A favorable assessment alone never accepts a take: only this route does.
 */

export function reviewConflict(message: string): AppError {
  return new AppError("REVIEW_CONFLICT", message);
}

/** Purpose-specific acceptance rule. Throws when `accept` is not permitted. */
export function assertAcceptable(take: TakeRow, check: CheckState, note: string | null): void {
  if (check === "pending") {
    throw reviewConflict("The visual check is still running. Wait for it before accepting.");
  }
  if (check === "needs_revision") {
    throw reviewConflict("This clip needs revision and cannot be accepted. Keep refining.");
  }
  if (take.purpose === "solution") {
    if (check !== "matches") {
      throw reviewConflict(
        "An instructional clip can be accepted only when every required step detail appears consistent.",
      );
    }
    return;
  }
  if ((check === "uncertain" || check === "unavailable") && !note) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Add a note about what you checked before accepting a clip that could not be verified.",
    );
  }
}

function attachedToTicket(ctx: AppContext, takeId: string): boolean {
  const row = getRow<{ n: number }>(
    ctx.db,
    `SELECT (SELECT COUNT(*) FROM tickets WHERE take_id = ? AND status != 'revoked')
          + (SELECT COUNT(*) FROM ticket_replies WHERE take_id = ?) AS n`,
    takeId,
    takeId,
  );
  return (row?.n ?? 0) > 0;
}

export function recordReview(
  ctx: AppContext,
  session: SessionInfo,
  takeId: string,
  req: CreateReviewRequest,
): Take {
  const note = req.uncertaintyNote?.trim() ? req.uncertaintyNote.trim() : null;
  const take = tx(ctx.db, (): TakeRow => {
    const t = getTakeRow(ctx.db, takeId);
    const kase = t ? getCaseRow(ctx.db, t.case_id) : undefined;
    if (!t || !kase || kase.owner_session_id !== session.id) throw new AppError("NOT_FOUND");
    if (!isCaseActive(kase)) throw new AppError("CASE_INACTIVE");

    const replay = getRow<{ id: string }>(
      ctx.db,
      "SELECT id FROM reviews WHERE take_id = ? AND idempotency_key = ?",
      t.id,
      req.idempotencyKey,
    );
    if (replay) return t;

    if (t.capture_status !== "complete") throw new AppError("CAPTURE_INCOMPLETE");
    if (t.processing_state !== "ready" || !t.sha256) throw new AppError("TAKE_NOT_READY");
    if (req.finalSha256 !== t.sha256) {
      throw reviewConflict("The reviewed file is not the current MP4 for this take.");
    }
    const binding = currentAssessmentBinding(ctx.db, t);
    if ((binding?.id ?? null) !== (req.assessmentId ?? null)) {
      throw reviewConflict("The visual check for this clip changed. Review it again.");
    }
    const check = checkState(binding);
    if (req.decision === "accept") assertAcceptable(t, check, note);
    if (req.decision !== "accept" && t.review_state === "accepted" && attachedToTicket(ctx, t.id)) {
      throw new AppError("TICKET_CONFLICT", "This clip was already sent to support.");
    }

    const ts = now();
    const resulting = REVIEW_DECISION_STATE[req.decision];
    ctx.db
      .prepare(
        `INSERT INTO reviews (id, take_id, final_sha256, assessment_id, decision, resulting_state,
           uncertainty_note, reviewer_session_id, reviewer_role, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId("rev"),
        t.id,
        t.sha256,
        binding?.id ?? null,
        req.decision,
        resulting,
        note,
        session.id,
        session.role,
        req.idempotencyKey,
        ts,
      );
    ctx.db
      .prepare("UPDATE takes SET review_state = ?, updated_at = ? WHERE id = ?")
      .run(resulting, ts, t.id);
    return getTakeRow(ctx.db, t.id) ?? t;
  });
  return toTakeDto(ctx, take);
}
