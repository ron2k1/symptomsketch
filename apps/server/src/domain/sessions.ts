import type { Request, Response } from "express";
import type { SessionState } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { AppError } from "../http/errors.ts";
import { codesMatch, issueSession, sessionState } from "../http/session.ts";

/**
 * Customer demo-access gate (spec 4 step 3, spec 14). The access code is compared in constant time
 * and never stored, logged or echoed. Repeated wrong codes from one client are rate limited.
 */

const FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_FAILURES_PER_WINDOW = 10;

interface FailureBucket {
  count: number;
  resetAt: number;
}

const failures = new Map<string, FailureBucket>();

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function checkNotLimited(key: string): void {
  const bucket = failures.get(key);
  if (!bucket) return;
  if (bucket.resetAt <= Date.now()) {
    failures.delete(key);
    return;
  }
  if (bucket.count >= MAX_FAILURES_PER_WINDOW) throw new AppError("RATE_LIMITED");
}

function recordFailure(key: string): void {
  const ts = Date.now();
  const bucket = failures.get(key);
  if (!bucket || bucket.resetAt <= ts) {
    failures.set(key, { count: 1, resetAt: ts + FAILURE_WINDOW_MS });
  } else {
    bucket.count += 1;
  }
  if (failures.size > 5_000) {
    for (const [k, b] of failures) if (b.resetAt <= ts) failures.delete(k);
  }
}

/** Test hook: forget rate-limit state. */
export function resetAccessFailures(): void {
  failures.clear();
}

/**
 * POST /api/session. A matching DEMO_ACCESS_CODE grants access: an existing customer session is
 * upgraded in place (its cases stay owned); otherwise a new customer session cookie is issued
 * (a support session in this browser is replaced by a customer one).
 */
export function grantCustomerAccess(
  ctx: AppContext,
  req: Request,
  res: Response,
  accessCode: string,
): SessionState {
  if (ctx.config.demoAccessCode === null) throw new AppError("CONFIG_MISSING");
  const key = clientKey(req);
  checkNotLimited(key);
  if (!codesMatch(accessCode, ctx.config.demoAccessCode)) {
    recordFailure(key);
    throw new AppError("ACCESS_REQUIRED", "That access code was not accepted.");
  }
  failures.delete(key);

  const current = req.session;
  if (current && current.role === "customer") {
    if (!current.accessGranted) {
      ctx.db.prepare("UPDATE sessions SET access_granted = 1 WHERE id = ?").run(current.id);
    }
    return sessionState({ ...current, accessGranted: true });
  }
  return sessionState(issueSession(ctx, res, { role: "customer", accessGranted: true }));
}
