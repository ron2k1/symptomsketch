import {
  SUPPORT_QUEUE_LABEL,
  type CreateTicketRequest,
  type StoryBeatsUpload,
  type Ticket,
  type TicketSnapshot,
  type TicketSummary,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { fromJson, getRow, newId, now, toJson, tx } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import { getTake, requireAcceptedTake } from "./accepted-take.ts";
import { listTicketSummariesForCase, parseSnapshot, ticketDto } from "./dto.ts";
import { caseIsLive } from "./lifecycle.ts";
import type { CaseRow, TicketRow } from "./rows.ts";
import { buildSnapshot, buildStorySnapshot, type PlannedAttachment } from "./snapshot.ts";

/** Customer ticket submission + reads (spec 5, 11, 13). */

const NOT_ACCEPTED =
  "Only an accepted take with its current reviewed MP4 can be sent to Demo Support.";

/** The session's own live case, or a bounded error (404 for foreign ids, 410 when inactive). */
export function loadOwnedCase(ctx: AppContext, session: SessionInfo, caseId: string): CaseRow {
  const row = getRow<CaseRow>(
    ctx.db,
    "SELECT * FROM cases WHERE id = ? AND owner_session_id = ?",
    caseId,
    session.id,
  );
  if (!row) throw new AppError("NOT_FOUND");
  if (!caseIsLive(row)) throw new AppError("CASE_INACTIVE");
  return row;
}

function viewerOf(session: SessionInfo) {
  return { supportSessionId: session.role === "support" ? session.id : null };
}

/** Same key + same payload -> same ticket; same key + different payload -> TICKET_CONFLICT. */
function replayOrConflict(
  ctx: AppContext,
  existing: TicketRow,
  caseId: string,
  body: CreateTicketRequest,
): TicketRow {
  const snap = parseSnapshot(existing);
  const takeGrant = getRow<{ lineage_json: string | null }>(
    ctx.db,
    "SELECT lineage_json FROM ticket_attachments WHERE ticket_id = ? AND purpose = 'customer_take'",
    existing.id,
  );
  const includedOriginal =
    fromJson<{ includeOriginal?: boolean }>(takeGrant?.lineage_json, {}).includeOriginal === true;
  const same =
    existing.case_id === caseId &&
    snap.takeId === body.takeId &&
    snap.message === body.message &&
    includedOriginal === body.includeOriginal;
  if (!same) {
    throw new AppError(
      "TICKET_CONFLICT",
      "This request key was already used for a different submission. Refresh and try again.",
    );
  }
  if (existing.status === "revoked") throw new AppError("CASE_INACTIVE");
  return existing;
}

/**
 * POST /api/cases/:caseId/tickets. Synchronous end to end (node:sqlite), so the idempotency check
 * and the insert cannot interleave with another request in this process.
 */
export function createTicket(
  ctx: AppContext,
  session: SessionInfo,
  caseId: string,
  body: CreateTicketRequest,
): { ticket: Ticket; created: boolean } {
  if (session.role !== "customer") {
    throw new AppError("FORBIDDEN", "Tickets are sent from a customer's own case.");
  }
  if (body.message.trim() === "") throw new AppError("VALIDATION_FAILED", "Write a message first.");
  const caseRow = loadOwnedCase(ctx, session, caseId);

  const existing = getRow<TicketRow>(
    ctx.db,
    "SELECT * FROM tickets WHERE owner_session_id = ? AND idempotency_key = ?",
    session.id,
    body.idempotencyKey,
  );
  if (existing) {
    const row = replayOrConflict(ctx, existing, caseId, body);
    return { ticket: ticketDto(ctx.db, row, viewerOf(session)), created: false };
  }

  const take = getTake(ctx.db, body.takeId);
  if (!take || take.case_id !== caseRow.id) throw new AppError("NOT_FOUND", "Take not found.");
  const accepted = requireAcceptedTake(ctx.db, take, NOT_ACCEPTED);
  const submittedAt = now();
  const { snapshot, attachments } = buildSnapshot({
    ctx,
    caseRow,
    accepted,
    message: body.message,
    includeOriginal: body.includeOriginal,
    submittedAt,
  });

  const ticketId = newId("tkt");
  tx(ctx.db, () => {
    insertTicket(ctx, {
      ticketId,
      caseId: caseRow.id,
      sessionId: session.id,
      takeId: take.id,
      snapshot,
      attachments,
      idempotencyKey: body.idempotencyKey,
      submittedAt,
    });
  });
  const row = getRow<TicketRow>(ctx.db, "SELECT * FROM tickets WHERE id = ?", ticketId)!;
  return { ticket: ticketDto(ctx.db, row, viewerOf(session)), created: true };
}

export interface TicketInsert {
  ticketId: string;
  caseId: string;
  sessionId: string;
  /** Null for a ticket a sent story opened (no X2 take). */
  takeId: string | null;
  snapshot: TicketSnapshot;
  attachments: PlannedAttachment[];
  idempotencyKey: string;
  submittedAt: string;
}

/** The one ticket write: the ticket row + its attachment grants. Callers hold the transaction. */
export function insertTicket(ctx: AppContext, t: TicketInsert): void {
  ctx.db
    .prepare(
      `INSERT INTO tickets (id, case_id, owner_session_id, take_id, queue, status, snapshot_json,
         idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
    )
    .run(
      t.ticketId,
      t.caseId,
      t.sessionId,
      t.takeId,
      SUPPORT_QUEUE_LABEL,
      toJson(t.snapshot),
      t.idempotencyKey,
      t.submittedAt,
      t.submittedAt,
    );
  const insert = ctx.db.prepare(
    `INSERT INTO ticket_attachments (id, ticket_id, asset_id, sha256, purpose, filename,
       lineage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const a of t.attachments) {
    insert.run(
      newId("att"),
      t.ticketId,
      a.asset.id,
      a.asset.sha256,
      a.purpose,
      a.filename,
      toJson(a.lineage),
      t.submittedAt,
    );
  }
}

/**
 * A sent story on a case with no live ticket opens one through the same ticket write. The caller
 * runs this inside the transaction that stores the story, so a double click or a retry sees the
 * first request's ticket and attaches to it instead. Returns null when the case has no live
 * product reference (the story is then stored without a ticket, as before).
 */
export function openStoryTicket(
  ctx: AppContext,
  session: SessionInfo,
  caseRow: CaseRow,
  storyId: string,
  beats: StoryBeatsUpload,
  submittedAt: string,
): string | null {
  if (session.role !== "customer") {
    throw new AppError("FORBIDDEN", "Tickets are sent from a customer's own case.");
  }
  const built = buildStorySnapshot({ ctx, caseRow, storyId, beats, submittedAt });
  if (!built) return null;
  const ticketId = newId("tkt");
  insertTicket(ctx, {
    ticketId,
    caseId: caseRow.id,
    sessionId: session.id,
    takeId: null,
    snapshot: built.snapshot,
    attachments: built.attachments,
    idempotencyKey: `story:${storyId}`,
    submittedAt,
  });
  return ticketId;
}

/** GET /api/tickets/:ticketId body for an already-authorized viewer. */
export function ticketForViewer(ctx: AppContext, session: SessionInfo, row: TicketRow): Ticket {
  return ticketDto(ctx.db, row, viewerOf(session));
}

/** GET /api/cases/:caseId/tickets (case owner only). */
export function listCaseTickets(
  ctx: AppContext,
  session: SessionInfo,
  caseId: string,
): TicketSummary[] {
  const caseRow = loadOwnedCase(ctx, session, caseId);
  return listTicketSummariesForCase(ctx.db, caseRow.id);
}
