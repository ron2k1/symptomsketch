import { JOB_KINDS } from "../db/jobs.ts";
import { allRows, getRow, now, tx } from "../db/index.ts";
import type { AppContext } from "../context.ts";
import type { CaseRow } from "./rows.ts";

/**
 * Ticket side of case deletion / expiry (spec 5 "Thread attachment permissions", spec 14).
 * server-core's lifecycle calls revokeTicketsForCase inside its delete/expire path; every support
 * read path also rechecks the source case and calls it lazily, so a missed call still fails closed.
 */

export interface RevokeResult {
  /** Tickets submitted from the case (now status revoked). */
  ticketIds: string[];
  /** Agent work cases derived from those tickets (now status deleted, cleanup job queued). */
  workCaseIds: string[];
  /** Ticket attachment grants revoked by this call. */
  attachmentsRevoked: number;
}

/** A case can back a ticket only while it is active and not past its retention expiry. */
export function caseIsLive(
  row: Pick<CaseRow, "status" | "expires_at"> | undefined,
  at: string = now(),
): boolean {
  return row !== undefined && row.status === "active" && row.expires_at > at;
}

/** Read a case's lifecycle fields (undefined when the row is gone). */
export function getCaseLifecycle(
  ctx: AppContext,
  caseId: string,
): Pick<CaseRow, "id" | "status" | "expires_at"> | undefined {
  return getRow(ctx.db, "SELECT id, status, expires_at FROM cases WHERE id = ?", caseId);
}

/**
 * Revoke every ticket grant tied to `caseId`:
 * - tickets submitted from the case -> status revoked;
 * - their attachments, plus any attachment whose asset lives in the case (a deleted work case's
 *   reply take) -> revoked_at set;
 * - agent work cases derived from those tickets -> status deleted, jobs tombstoned, preview leases
 *   released, a case_cleanup job queued (server-core's handler removes the private copies).
 * Idempotent; safe to call inside an outer tx (nested savepoint).
 */
export function revokeTicketsForCase(ctx: AppContext, caseId: string): RevokeResult {
  const ts = now();
  return tx(ctx.db, () => {
    const ticketIds = allRows<{ id: string }>(
      ctx.db,
      "SELECT id FROM tickets WHERE case_id = ?",
      caseId,
    ).map((r) => r.id);
    ctx.db
      .prepare(
        "UPDATE tickets SET status = 'revoked', updated_at = ? WHERE case_id = ? AND status != 'revoked'",
      )
      .run(ts, caseId);
    const revoked = ctx.db
      .prepare(
        `UPDATE ticket_attachments SET revoked_at = ?
         WHERE revoked_at IS NULL
           AND (ticket_id IN (SELECT id FROM tickets WHERE case_id = ?)
                OR asset_id IN (SELECT id FROM assets WHERE case_id = ?))`,
      )
      .run(ts, caseId, caseId);
    const workCaseIds = allRows<{ id: string }>(
      ctx.db,
      `SELECT id FROM cases
       WHERE source_ticket_id IN (SELECT id FROM tickets WHERE case_id = ?) AND status = 'active'`,
      caseId,
    ).map((r) => r.id);
    for (const workCaseId of workCaseIds) {
      ctx.db
        .prepare("UPDATE cases SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?")
        .run(ts, ts, workCaseId);
      ctx.db
        .prepare(
          `UPDATE ticket_attachments SET revoked_at = ?
           WHERE revoked_at IS NULL AND asset_id IN (SELECT id FROM assets WHERE case_id = ?)`,
        )
        .run(ts, workCaseId);
      ctx.db
        .prepare("UPDATE leases SET released_at = ? WHERE case_id = ? AND released_at IS NULL")
        .run(ts, workCaseId);
      ctx.jobs.cancelJobsForCase(workCaseId);
      ctx.jobs.enqueueJob(
        JOB_KINDS.caseCleanup,
        { caseId: workCaseId },
        `${JOB_KINDS.caseCleanup}:${workCaseId}`,
        { caseId: workCaseId },
      );
    }
    return { ticketIds, workCaseIds, attachmentsRevoked: Number(revoked.changes) };
  });
}

/**
 * Lazy enforcement for read paths: when the ticket's source case is no longer live, revoke and
 * report false. Cheap when the case is live (one indexed read).
 */
export function ensureTicketCaseLive(ctx: AppContext, caseId: string): boolean {
  if (caseIsLive(getCaseLifecycle(ctx, caseId))) return true;
  revokeTicketsForCase(ctx, caseId);
  return false;
}
