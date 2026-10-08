import type { AppContext } from "../context.ts";
import { allRows, getRow, now, tx } from "../db/index.ts";
import { JOB_KINDS, JobError } from "../db/jobs.ts";
import { removeCaseDirs, removeStoredFile } from "../media/files.ts";
import { revokeTicketsForCase } from "../support/lifecycle.ts";

/**
 * Case deletion, expiry and the retention sweep (spec 14). Deletion first marks the case and its
 * tickets inactive, revokes attachment grants, releases preview leases and tombstones queued jobs
 * (one transaction), then removes the files. Every asynchronous completion (export, critic,
 * provider call) must call isCaseActive / assertCaseActive before publishing a file or row.
 */

const SWEEP_INTERVAL_MS = 10 * 60_000;

/** True while the case exists and is neither deleted nor expired. */
export function isCaseActive(ctx: AppContext, caseId: string): boolean {
  const row = getRow<{ status: string }>(ctx.db, "SELECT status FROM cases WHERE id = ?", caseId);
  return row?.status === "active";
}

/** For job handlers: throw a non-retryable CASE_INACTIVE JobError when the case is gone. */
export function assertCaseActive(ctx: AppContext, caseId: string): void {
  if (!isCaseActive(ctx, caseId)) throw new JobError("CASE_INACTIVE");
}

/** Remove every stored file of a case (rows + per-case folders). Safe to call repeatedly. */
export async function removeCaseFiles(ctx: AppContext, caseId: string): Promise<void> {
  const rows = allRows<{ storage_path: string }>(
    ctx.db,
    "SELECT storage_path FROM assets WHERE case_id = ?",
    caseId,
  );
  for (const r of rows) await removeStoredFile(ctx.paths, r.storage_path);
  await removeCaseDirs(ctx.paths, caseId);
}

/** Mark inactive + revoke + release + tombstone, synchronously. Returns affected case ids. */
function deactivate(ctx: AppContext, caseId: string, status: "deleted" | "expired"): string[] {
  const ts = now();
  return tx(ctx.db, () => {
    const res = ctx.db
      .prepare(
        `UPDATE cases SET status = ?, deleted_at = ?, updated_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(status, ts, ts, caseId);
    if (Number(res.changes) === 0) return [];
    ctx.db
      .prepare("UPDATE leases SET released_at = ? WHERE case_id = ? AND released_at IS NULL")
      .run(ts, caseId);
    ctx.jobs.cancelJobsForCase(caseId);
    // Tickets -> revoked, attachment grants revoked, derived agent work cases (private copies of
    // this customer's submitted reference) -> deleted with their jobs/leases (server-support).
    const { workCaseIds } = revokeTicketsForCase(ctx, caseId);
    const affected = [caseId, ...workCaseIds];
    const markAssets = ctx.db.prepare(
      "UPDATE assets SET deleted_at = ? WHERE case_id = ? AND deleted_at IS NULL",
    );
    for (const id of affected) markAssets.run(ts, id);
    return affected;
  });
}

/**
 * DELETE /api/cases/:id and expiry. Idempotent: an already inactive case only gets its files
 * swept again. Returns the ids that were deactivated by this call.
 */
export async function deleteCase(
  ctx: AppContext,
  caseId: string,
  status: "deleted" | "expired" = "deleted",
): Promise<string[]> {
  const affected = deactivate(ctx, caseId, status);
  for (const id of affected.length > 0 ? affected : [caseId]) await removeCaseFiles(ctx, id);
  return affected;
}

/**
 * Expire cases past CASE_RETENTION_DAYS, and remove any file that appeared for an inactive case
 * after its deletion (a late export or provider response). Returns the number of expired cases.
 */
export async function sweepExpiredCases(ctx: AppContext): Promise<number> {
  const expired = allRows<{ id: string }>(
    ctx.db,
    "SELECT id FROM cases WHERE status = 'active' AND expires_at <= ?",
    now(),
  );
  let count = 0;
  for (const c of expired) count += (await deleteCase(ctx, c.id, "expired")).length > 0 ? 1 : 0;

  const late = allRows<{ id: string; case_id: string; storage_path: string }>(
    ctx.db,
    `SELECT a.id, a.case_id, a.storage_path FROM assets a JOIN cases c ON c.id = a.case_id
     WHERE c.status != 'active' AND a.deleted_at IS NULL`,
  );
  for (const a of late) {
    await removeStoredFile(ctx.paths, a.storage_path);
    ctx.db.prepare("UPDATE assets SET deleted_at = ? WHERE id = ?").run(now(), a.id);
  }
  return count;
}

const sweepers = new WeakMap<AppContext, NodeJS.Timeout>();

/** Run the retention sweep now and every 10 minutes (unref'd). Idempotent per context. */
export function startRetentionSweep(ctx: AppContext, intervalMs = SWEEP_INTERVAL_MS): () => void {
  const existing = sweepers.get(ctx);
  if (existing) return () => stopRetentionSweep(ctx);
  const run = () => {
    sweepExpiredCases(ctx).catch((err: unknown) => {
      console.error(`[lifecycle] retention sweep failed: ${(err as Error)?.name ?? "Error"}`);
    });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref();
  sweepers.set(ctx, timer);
  setImmediate(() => {
    if (sweepers.get(ctx) === timer) run();
  });
  return () => stopRetentionSweep(ctx);
}

export function stopRetentionSweep(ctx: AppContext): void {
  const timer = sweepers.get(ctx);
  if (timer) clearInterval(timer);
  sweepers.delete(ctx);
}

/** JOB_KINDS.caseCleanup handler: re-sweep files of an inactive case (payload { caseId }). */
export function registerCaseCleanupJob(ctx: AppContext): void {
  ctx.jobs.registerJobHandler<{ caseId: string }>(JOB_KINDS.caseCleanup, {
    concurrency: 1,
    handler: async (payload) => {
      if (typeof payload.caseId !== "string" || isCaseActive(ctx, payload.caseId)) {
        return { removed: false };
      }
      await removeCaseFiles(ctx, payload.caseId);
      ctx.db
        .prepare("UPDATE assets SET deleted_at = ? WHERE case_id = ? AND deleted_at IS NULL")
        .run(now(), payload.caseId);
      return { removed: true };
    },
  });
}
