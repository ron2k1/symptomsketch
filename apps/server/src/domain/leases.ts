// Live preview capacity (spec 8 "Live preview capacity") and per-session paid-call limits.
// A lease is held while a browser runs one Reactor session: it expires server-side unless the
// browser heartbeats, so a closed tab frees capacity within ~30 s without any client cooperation.
import { LIMITS, type PreviewLeaseResponse } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { type Db, getRow, newId, now, tx } from "../db/index.ts";
import { AppError } from "../http/errors.ts";

export interface LeaseRow {
  id: string;
  session_id: string;
  case_id: string;
  plan_revision_id: string | null;
  created_at: string;
  heartbeat_at: string;
  expires_at: string;
  released_at: string | null;
}

function isoIn(ms: number, from = Date.now()): string {
  return new Date(from + ms).toISOString();
}

/** Active = not released and not past its server-side expiry. */
export function countActiveLeases(db: Db, excludeSessionId?: string): number {
  const row = getRow<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM leases WHERE released_at IS NULL AND expires_at > ?
       AND session_id != ?`,
    now(),
    excludeSessionId ?? "",
  );
  return row?.n ?? 0;
}

function liveScenesMax(ctx: AppContext): number {
  return Math.max(1, ctx.config.maxLiveSessions);
}

/**
 * Take a preview slot for this session. A session holds at most one live scene: its previous
 * lease is superseded. Other sessions' active leases count against MAX_LIVE_SESSIONS.
 */
export function acquireLease(
  ctx: AppContext,
  input: { sessionId: string; caseId: string; planRevisionId: string },
): LeaseRow {
  return tx(ctx.db, () => {
    const ts = now();
    ctx.db
      .prepare("UPDATE leases SET released_at = ? WHERE session_id = ? AND released_at IS NULL")
      .run(ts, input.sessionId);
    if (countActiveLeases(ctx.db, input.sessionId) >= liveScenesMax(ctx)) {
      throw new AppError("CAPACITY_FULL");
    }
    const id = newId("lse");
    ctx.db
      .prepare(
        `INSERT INTO leases (id, session_id, case_id, plan_revision_id, created_at, heartbeat_at,
           expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.caseId,
        input.planRevisionId,
        ts,
        ts,
        isoIn(LIMITS.previewLeaseTtlMs),
      );
    return getRow<LeaseRow>(ctx.db, "SELECT * FROM leases WHERE id = ?", id)!;
  });
}

export function releaseLease(db: Db, leaseId: string): void {
  db.prepare("UPDATE leases SET released_at = ? WHERE id = ? AND released_at IS NULL").run(
    now(),
    leaseId,
  );
}

function ownedLease(db: Db, sessionId: string, caseId: string, leaseId: string): LeaseRow {
  const row = getRow<LeaseRow>(
    db,
    "SELECT * FROM leases WHERE id = ? AND session_id = ? AND case_id = ?",
    leaseId,
    sessionId,
    caseId,
  );
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/**
 * Heartbeat extends an active lease by the TTL, never beyond the preview cap measured from the
 * lease's creation. Expired, released or capped leases stay inactive (the browser must stop).
 */
export function updateLease(
  ctx: AppContext,
  input: { sessionId: string; caseId: string; leaseId: string; action: "heartbeat" | "release" },
): PreviewLeaseResponse {
  const lease = tx(ctx.db, () => {
    const row = ownedLease(ctx.db, input.sessionId, input.caseId, input.leaseId);
    const nowMs = Date.now();
    const active = !row.released_at && Date.parse(row.expires_at) > nowMs;
    if (input.action === "release" || !active) {
      if (!row.released_at) releaseLease(ctx.db, row.id);
      return { ...row, active: false };
    }
    const cap = Date.parse(row.created_at) + LIMITS.previewMaxMs;
    if (nowMs >= cap) {
      releaseLease(ctx.db, row.id);
      return { ...row, active: false };
    }
    const expiresAt = new Date(Math.min(nowMs + LIMITS.previewLeaseTtlMs, cap)).toISOString();
    ctx.db
      .prepare("UPDATE leases SET heartbeat_at = ?, expires_at = ? WHERE id = ?")
      .run(new Date(nowMs).toISOString(), expiresAt, row.id);
    return { ...row, expires_at: expiresAt, active: true };
  });
  return {
    leaseId: lease.id,
    active: lease.active,
    expiresAt: lease.active ? lease.expires_at : null,
    liveScenesInUse: countActiveLeases(ctx.db),
    liveScenesMax: liveScenesMax(ctx),
  };
}

// ---- per-session usage limits (in memory, sliding window) ----

export type UsageKind = "reactorToken" | "plan" | "critic";

/** Per-session caps per rolling hour. Paid calls only; failures still count (spec 8). */
export const USAGE_LIMITS: Record<UsageKind, { max: number; windowMs: number }> = {
  reactorToken: { max: 20, windowMs: 60 * 60_000 },
  plan: { max: 60, windowMs: 60 * 60_000 },
  critic: { max: 30, windowMs: 60 * 60_000 },
};

export class UsageLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Record one use, or throw RATE_LIMITED when the session is at its cap. */
  take(kind: UsageKind, sessionId: string, at = Date.now()): void {
    const { max, windowMs } = USAGE_LIMITS[kind];
    const key = `${kind}:${sessionId}`;
    const recent = (this.hits.get(key) ?? []).filter((t) => at - t < windowMs);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      throw new AppError("RATE_LIMITED");
    }
    recent.push(at);
    this.hits.set(key, recent);
  }
}

const limiters = new WeakMap<AppContext, UsageLimiter>();

export function limiterFor(ctx: AppContext): UsageLimiter {
  let l = limiters.get(ctx);
  if (!l) {
    l = new UsageLimiter();
    limiters.set(ctx, l);
  }
  return l;
}

/** Bump a sessions usage counter column (observability only). */
export function bumpSessionCounter(
  db: Db,
  sessionId: string,
  column: "plan_calls" | "critic_calls" | "token_issues",
): void {
  db.prepare(`UPDATE sessions SET ${column} = ${column} + 1 WHERE id = ?`).run(sessionId);
}
