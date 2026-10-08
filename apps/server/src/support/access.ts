import type { AppContext } from "../context.ts";
import { getRow } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import { ensureTicketCaseLive } from "./lifecycle.ts";
import type { TicketRow } from "./rows.ts";

/**
 * Ticket membership (spec 5, 14): the owning customer session or a server-assigned support
 * session. Anything else, a revoked ticket, or a ticket whose source case was deleted/expired is
 * a plain 404 so ids cannot be probed.
 */
export function loadTicketForViewer(
  ctx: AppContext,
  session: SessionInfo,
  ticketId: string,
): TicketRow {
  const row = getRow<TicketRow>(ctx.db, "SELECT * FROM tickets WHERE id = ?", ticketId);
  if (!row || row.status === "revoked") throw new AppError("NOT_FOUND");
  const isOwner = session.role === "customer" && row.owner_session_id === session.id;
  if (!isOwner && session.role !== "support") throw new AppError("NOT_FOUND");
  if (!ensureTicketCaseLive(ctx, row.case_id)) throw new AppError("NOT_FOUND");
  return row;
}

/** Support-only variant (replies, work cases). Customers get SUPPORT_FORBIDDEN, not a 404. */
export function loadTicketForSupport(
  ctx: AppContext,
  session: SessionInfo,
  ticketId: string,
): TicketRow {
  if (session.role !== "support") throw new AppError("SUPPORT_FORBIDDEN");
  return loadTicketForViewer(ctx, session, ticketId);
}
