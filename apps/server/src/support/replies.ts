import { takeFilename, type CreateReplyRequest } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { getRow, newId, now, toJson, tx } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import { getTake, requireAcceptedTake } from "./accepted-take.ts";
import { caseIsLive } from "./lifecycle.ts";
import type { AttachmentRow, CaseRow, ReplyRow, TicketRow } from "./rows.ts";
import { caseLabel } from "./snapshot.ts";

/**
 * POST /api/tickets/:ticketId/replies (support only, spec 5 steps 2 and 8). A reply is an actual
 * persisted message from the authenticated support session. An optional take grants the customer
 * the exact reviewed bytes of an accepted solution take from this ticket's own work case.
 */

const NOT_ACCEPTED =
  "Only an accepted solution take with its current reviewed MP4 can be attached.";
const FOREIGN_TAKE = "Attach a take from this ticket's own work case.";

/** Validate the attachable take and return (or reuse) its ticket attachment id. Runs inside tx. */
function grantReplyTake(
  ctx: AppContext,
  session: SessionInfo,
  ticket: TicketRow,
  takeId: string,
  ts: string,
): string {
  const take = getTake(ctx.db, takeId);
  if (!take) throw new AppError("SUPPORT_FORBIDDEN", FOREIGN_TAKE);
  const workCase = getRow<CaseRow>(ctx.db, "SELECT * FROM cases WHERE id = ?", take.case_id);
  if (
    !workCase ||
    workCase.owner_role !== "support" ||
    workCase.owner_session_id !== session.id ||
    workCase.source_ticket_id !== ticket.id
  ) {
    throw new AppError("SUPPORT_FORBIDDEN", FOREIGN_TAKE);
  }
  if (!caseIsLive(workCase)) throw new AppError("CASE_INACTIVE");
  if (take.purpose !== "solution") throw new AppError("REVIEW_CONFLICT", NOT_ACCEPTED);
  const { finalAsset } = requireAcceptedTake(ctx.db, take, NOT_ACCEPTED);

  const prior = getRow<AttachmentRow>(
    ctx.db,
    "SELECT * FROM ticket_attachments WHERE ticket_id = ? AND asset_id = ?",
    ticket.id,
    finalAsset.id,
  );
  if (prior) {
    if (prior.revoked_at !== null || prior.sha256 !== take.sha256) {
      throw new AppError("REVIEW_CONFLICT", NOT_ACCEPTED);
    }
    return prior.id;
  }
  const id = newId("att");
  ctx.db
    .prepare(
      `INSERT INTO ticket_attachments (id, ticket_id, asset_id, sha256, purpose, filename,
         lineage_json, created_at) VALUES (?, ?, ?, ?, 'support_reply_take', ?, ?, ?)`,
    )
    .run(
      id,
      ticket.id,
      finalAsset.id,
      finalAsset.sha256,
      takeFilename(caseLabel(workCase.id), take.number),
      toJson({ workCaseId: workCase.id, takeId: take.id, ticketId: ticket.id }),
      ts,
    );
  return id;
}

/** Returns true when a new reply row was written, false for an idempotent replay. */
export function createReply(
  ctx: AppContext,
  session: SessionInfo,
  ticket: TicketRow,
  body: CreateReplyRequest,
): boolean {
  if (body.text.trim() === "") throw new AppError("VALIDATION_FAILED", "Write a reply first.");
  return tx(ctx.db, () => {
    const existing = getRow<ReplyRow>(
      ctx.db,
      "SELECT * FROM ticket_replies WHERE ticket_id = ? AND idempotency_key = ?",
      ticket.id,
      body.idempotencyKey,
    );
    if (existing) {
      if (existing.text !== body.text || existing.take_id !== (body.attachTakeId ?? null)) {
        throw new AppError(
          "TICKET_CONFLICT",
          "This request key was already used for a different reply. Refresh and try again.",
        );
      }
      return false;
    }
    const ts = now();
    const attachmentId = body.attachTakeId
      ? grantReplyTake(ctx, session, ticket, body.attachTakeId, ts)
      : null;
    ctx.db
      .prepare(
        `INSERT INTO ticket_replies (id, ticket_id, author_session_id, text, attachment_id, take_id,
           idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId("rpl"),
        ticket.id,
        session.id,
        body.text,
        attachmentId,
        body.attachTakeId ?? null,
        body.idempotencyKey,
        ts,
      );
    ctx.db
      .prepare(
        "UPDATE tickets SET status = 'replied', updated_at = ? WHERE id = ? AND status != 'revoked'",
      )
      .run(ts, ticket.id);
    return true;
  });
}
