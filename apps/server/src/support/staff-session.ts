import type { Request, Response } from "express";
import { CreateSupportSessionRequest, type SessionState } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { AppError } from "../http/errors.ts";
import { codesMatch, issueSession, sessionState } from "../http/session.ts";
import { parseBody } from "../http/validate.ts";

/**
 * POST /api/support/session (spec 5, 14). The only way to obtain the support role: a constant-time
 * match against DEMO_SUPPORT_CODE. Body fields other than supportCode (e.g. a `role` flag), query
 * strings and headers are ignored; the server assigns the role.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request): string {
  return req.ip ?? "unknown";
}

function checkThrottle(key: string, at: number): void {
  const entry = failures.get(key);
  if (entry && entry.resetAt > at && entry.count >= MAX_FAILURES) {
    throw new AppError("RATE_LIMITED");
  }
}

function recordFailure(key: string, at: number): void {
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= at) failures.set(key, { count: 1, resetAt: at + WINDOW_MS });
  else entry.count += 1;
  if (failures.size > 1000) {
    for (const [k, v] of failures) if (v.resetAt <= at) failures.delete(k);
  }
}

export function createSupportSession(ctx: AppContext, req: Request, res: Response): SessionState {
  const body = parseBody(CreateSupportSessionRequest, req);
  if (ctx.config.demoSupportCode === null) throw new AppError("CONFIG_MISSING");
  const key = clientKey(req);
  const at = Date.now();
  checkThrottle(key, at);
  if (!codesMatch(body.supportCode, ctx.config.demoSupportCode)) {
    recordFailure(key, at);
    throw new AppError("SUPPORT_FORBIDDEN", "That support code was not accepted.");
  }
  failures.delete(key);
  return sessionState(issueSession(ctx, res, { role: "support", accessGranted: true }));
}
