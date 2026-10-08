import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { LIMITS, type Role, type SessionState } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { fromNow, newId, now } from "../db/index.ts";
import { AppError } from "./errors.ts";

export const SESSION_COOKIE = "ss_session";
const SESSION_TTL_MS = LIMITS.sessionTtlDays * 24 * 60 * 60 * 1000;

/** Attached to every request by sessionMiddleware (null when no valid cookie). */
export interface SessionInfo {
  id: string;
  role: Role;
  accessGranted: boolean;
  expiresAt: string;
}

declare global {
  namespace Express {
    interface Request {
      session: SessionInfo | null;
      /** True when a cookie was presented but the session is unknown or expired. */
      sessionExpired?: boolean;
    }
  }
}

interface SessionRow {
  id: string;
  role: Role;
  access_granted: number;
  expires_at: string;
}

/** HMAC-SHA256(SESSION_SECRET, token) hex. The DB never stores the raw cookie token. */
export function hashToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

/** Constant-time compare for access codes (avoids timing leaks; lengths are hashed first). */
export function codesMatch(provided: string, expected: string | null): boolean {
  if (expected === null) return false;
  const a = createHmac("sha256", "ss-code").update(provided).digest();
  const b = createHmac("sha256", "ss-code").update(expected).digest();
  return timingSafeEqual(a, b);
}

function cookieOptions(ctx: AppContext) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: ctx.config.isProduction,
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

/**
 * Create a session row, set the HttpOnly cookie, and return it. Any prior session cookie on this
 * response is replaced (its row is left to expire).
 */
export function issueSession(
  ctx: AppContext,
  res: Response,
  opts: { role: Role; accessGranted: boolean },
): SessionInfo {
  const token = randomBytes(32).toString("base64url");
  const id = newId("ses");
  const ts = now();
  const expiresAt = fromNow(SESSION_TTL_MS);
  ctx.db
    .prepare(
      `INSERT INTO sessions (id, token_hash, role, access_granted, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      hashToken(ctx.config.sessionSecret, token),
      opts.role,
      opts.accessGranted ? 1 : 0,
      ts,
      ts,
      expiresAt,
    );
  res.cookie(SESSION_COOKIE, token, cookieOptions(ctx));
  return { id, role: opts.role, accessGranted: opts.accessGranted, expiresAt };
}

export function clearSessionCookie(ctx: AppContext, res: Response): void {
  const { maxAge: _maxAge, ...opts } = cookieOptions(ctx);
  res.clearCookie(SESSION_COOKIE, opts);
}

/** Public view of the current session for the browser. */
export function sessionState(session: SessionInfo | null): SessionState {
  return session
    ? {
        authenticated: true,
        role: session.role,
        accessGranted: session.accessGranted,
        expiresAt: session.expiresAt,
      }
    : { authenticated: false, role: null, accessGranted: false, expiresAt: null };
}

/** Resolve `ss_session` -> req.session (or null). Never trusts client-supplied role flags. */
export function sessionMiddleware(ctx: AppContext): RequestHandler {
  const lookup = ctx.db.prepare(
    "SELECT id, role, access_granted, expires_at FROM sessions WHERE token_hash = ?",
  );
  const touch = ctx.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?");
  return (req, _res, next) => {
    req.session = null;
    const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
    const token = cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token.length > 0 && token.length < 200) {
      const row = lookup.get(hashToken(ctx.config.sessionSecret, token)) as SessionRow | undefined;
      if (row && row.expires_at > now()) {
        req.session = {
          id: row.id,
          role: row.role,
          accessGranted: row.access_granted === 1,
          expiresAt: row.expires_at,
        };
        touch.run(now(), row.id);
      } else {
        req.sessionExpired = true;
      }
    }
    next();
  };
}

/** Any valid session. 401 SESSION_EXPIRED if a stale cookie was sent, else 401 ACCESS_REQUIRED. */
export function requireSession(req: Request): SessionInfo {
  if (req.session) return req.session;
  throw new AppError(req.sessionExpired ? "SESSION_EXPIRED" : "ACCESS_REQUIRED");
}

/** Paid/customer routes: customer with DEMO_ACCESS_CODE, or a support session (spec 8). */
export function requireCustomerAccess(req: Request): SessionInfo {
  const s = requireSession(req);
  if (s.role === "support" || s.accessGranted) return s;
  throw new AppError("ACCESS_REQUIRED", undefined, 403);
}

/** Support-only routes. */
export function requireSupport(req: Request): SessionInfo {
  const s = requireSession(req);
  if (s.role === "support") return s;
  throw new AppError("SUPPORT_FORBIDDEN");
}

/** Middleware forms of the guards above. */
export const guard = {
  session: (): RequestHandler => (req, _res, next) => {
    requireSession(req);
    next();
  },
  customerAccess: (): RequestHandler => (req, _res, next) => {
    requireCustomerAccess(req);
    next();
  },
  support: (): RequestHandler => (req, _res, next) => {
    requireSupport(req);
    next();
  },
};
