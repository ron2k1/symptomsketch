// Reactor X2 scoped-token adapter (spec 8). Exchanges the long-lived REACTOR_API_KEY for a
// short-lived JWT the browser uses to open exactly one X2 session. Verified live 2026-10-08
// against POST https://api.reactor.inc/tokens (see docs/providers/reactor-x2.md).
//
// Secret hygiene: this module never logs. Errors carry only a bounded code, a bounded reason, and
// the upstream HTTP status; never the key, the JWT, or a provider response body.
import type { ErrorCode } from "@symptomsketch/contracts";
import { z } from "zod";

export const REACTOR_API_URL = "https://api.reactor.inc";
export const X2_MODEL_RESOURCE = "xmax/x2";

/** Provider ceilings from docs.reactor.inc/authentication. */
const MAX_SESSIONS_RANGE = { min: 1, max: 500 } as const;
const EXPIRES_AFTER_RANGE = { min: 1, max: 6 * 60 * 60 } as const;
const SESSION_DURATION_RANGE = { min: 1, max: 24 * 60 * 60 } as const;

/**
 * Defaults sized to the spec's five-minute preview target. The JWT must outlive the whole session
 * because the SDK re-sends it on uploads, ICE refresh and SDP renegotiation, and a token cannot be
 * topped up mid-session. max_session_duration_seconds is the provider-side hard stop (spec 8 cost
 * controls) in case a browser keeps a session open past the app's own idle timers.
 */
export const DEFAULT_EXPIRES_AFTER_SECONDS = 15 * 60;
export const DEFAULT_MAX_SESSION_DURATION_SECONDS = 10 * 60;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Subset of the shared contract ErrorCode, so routes can pass `err.code` straight to AppError. */
export type ReactorTokenErrorCode = Extract<
  ErrorCode,
  "REACTOR_UNAVAILABLE" | "CONFIG_MISSING" | "RATE_LIMITED"
>;
export type ReactorTokenErrorReason =
  | "missing_api_key"
  | "rejected_api_key"
  | "rate_limited"
  | "http_error"
  | "network"
  | "timeout"
  | "aborted"
  | "bad_response";

export class ReactorTokenError extends Error {
  readonly code: ReactorTokenErrorCode;
  readonly reason: ReactorTokenErrorReason;
  /** Upstream HTTP status when the failure came from one. Safe to log. */
  readonly status: number | undefined;
  /** Parsed Retry-After for RATE_LIMITED, in milliseconds. */
  readonly retryAfterMs: number | undefined;

  constructor(
    code: ReactorTokenErrorCode,
    reason: ReactorTokenErrorReason,
    extra: { status?: number; retryAfterMs?: number } = {},
  ) {
    const statusPart = extra.status === undefined ? "" : ` (http ${extra.status})`;
    super(`Reactor token request failed: ${reason}${statusPart}`);
    this.name = "ReactorTokenError";
    this.code = code;
    this.reason = reason;
    this.status = extra.status;
    this.retryAfterMs = extra.retryAfterMs;
  }
}

export interface MintX2TokenOptions {
  /** REACTOR_API_KEY from apps/server/src/config.ts. Missing or blank yields CONFIG_MISSING. */
  apiKey: string | undefined;
  /** Sessions this token may ever create (closed ones still count). Default 1. */
  maxSessions?: number;
  /** Requested JWT lifetime; the provider clamps at 6 h. Default 900 s. */
  expiresAfterSeconds?: number;
  /** Provider-side cap on each session's length. Default 600 s. */
  maxSessionDurationSeconds?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Test seam only. */
  fetchImpl?: typeof fetch;
  apiUrl?: string;
}

export interface X2Token {
  /** Short-lived session JWT. Hand it to the browser once; never log or persist it. */
  jwt: string;
  /** Expiry granted by the provider (from expires_at), ISO-8601. Always read this, not the request. */
  expiresAt: string;
  /** max_sessions the provider actually resolved, when echoed back. */
  maxSessions: number;
}

const tokenResponseSchema = z.object({
  jwt: z.string().min(1),
  expires_at: z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]),
  authorization_details: z
    .array(z.object({ constraints: z.object({ max_sessions: z.number() }).partial().optional() }))
    .optional(),
});

function checkRange(name: string, value: number, range: { min: number; max: number }): number {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new RangeError(`${name} must be an integer in [${range.min}, ${range.max}]`);
  }
  return value;
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** expires_at is documented as a Unix epoch timestamp (seconds); tolerate milliseconds too. */
function epochToIso(raw: number | string): string {
  const n = typeof raw === "number" ? raw : Number(raw);
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toISOString();
}

function errorFromStatus(status: number, retryAfter: string | null): ReactorTokenError {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(retryAfter);
    return new ReactorTokenError("RATE_LIMITED", "rate_limited", {
      status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  // A rejected key is an operator problem, not a transient outage: surface it as config.
  if (status === 401 || status === 403) {
    return new ReactorTokenError("CONFIG_MISSING", "rejected_api_key", { status });
  }
  return new ReactorTokenError("REACTOR_UNAVAILABLE", "http_error", { status });
}

/**
 * Mint a JWT scoped to xmax/x2 sessions only. With the default maxSessions=1 the browser can open
 * exactly one session: X2 reset() keeps that session, but disconnect() ends it, so a fresh
 * connection needs a freshly minted token.
 */
export async function mintX2Token(options: MintX2TokenOptions): Promise<X2Token> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) throw new ReactorTokenError("CONFIG_MISSING", "missing_api_key");

  const maxSessions = checkRange("maxSessions", options.maxSessions ?? 1, MAX_SESSIONS_RANGE);
  const expiresAfter = checkRange(
    "expiresAfterSeconds",
    options.expiresAfterSeconds ?? DEFAULT_EXPIRES_AFTER_SECONDS,
    EXPIRES_AFTER_RANGE,
  );
  const sessionDuration = checkRange(
    "maxSessionDurationSeconds",
    options.maxSessionDurationSeconds ?? DEFAULT_MAX_SESSION_DURATION_SECONDS,
    SESSION_DURATION_RANGE,
  );

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const doFetch = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${options.apiUrl ?? REACTOR_API_URL}/tokens`, {
      method: "POST",
      headers: { "Reactor-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: expiresAfter,
        authorization_details: [
          {
            type: "session",
            resources: { models: { match: [X2_MODEL_RESOURCE] } },
            constraints: {
              max_sessions: maxSessions,
              max_session_duration_seconds: sessionDuration,
            },
          },
        ],
      }),
      signal,
    });
  } catch {
    if (options.signal?.aborted) throw new ReactorTokenError("REACTOR_UNAVAILABLE", "aborted");
    if (timeoutSignal.aborted) throw new ReactorTokenError("REACTOR_UNAVAILABLE", "timeout");
    throw new ReactorTokenError("REACTOR_UNAVAILABLE", "network");
  }

  if (!res.ok) {
    // Drain without reading the body into anything that could be logged.
    await res.body?.cancel().catch(() => undefined);
    throw errorFromStatus(res.status, res.headers.get("retry-after"));
  }

  let parsed: z.infer<typeof tokenResponseSchema>;
  try {
    parsed = tokenResponseSchema.parse(await res.json());
  } catch {
    throw new ReactorTokenError("REACTOR_UNAVAILABLE", "bad_response", { status: res.status });
  }

  const echoed = parsed.authorization_details?.[0]?.constraints?.max_sessions;
  return {
    jwt: parsed.jwt,
    expiresAt: epochToIso(parsed.expires_at),
    maxSessions: echoed ?? maxSessions,
  };
}
