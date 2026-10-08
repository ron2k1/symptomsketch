import { z } from "zod";
import { Role, Timestamp } from "./common.ts";
import { LIMITS } from "./limits.ts";

/** POST /api/session: customer demo access code -> HttpOnly `ss_session` cookie. */
export const CreateSessionRequest = z.object({
  accessCode: z.string().min(1).max(LIMITS.accessCodeMaxChars),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

/** POST /api/support/session: support code -> server-assigned support role. */
export const CreateSupportSessionRequest = z.object({
  supportCode: z.string().min(1).max(LIMITS.accessCodeMaxChars),
});
export type CreateSupportSessionRequest = z.infer<typeof CreateSupportSessionRequest>;

/**
 * Session state as the browser may see it (the cookie itself is HttpOnly).
 * Returned by POST /api/session, POST /api/support/session and GET /api/session.
 */
export const SessionState = z.object({
  authenticated: z.boolean(),
  role: Role.nullable(),
  /** True when this session may call paid routes (customer with access code, or support). */
  accessGranted: z.boolean(),
  expiresAt: Timestamp.nullable(),
});
export type SessionState = z.infer<typeof SessionState>;

/** GET /api/health (no secrets: presence booleans only). */
export const HealthResponse = z.object({
  ok: z.boolean(),
  contractsVersion: z.number(),
  db: z.boolean(),
  config: z.object({
    ok: z.boolean(),
    present: z.record(z.string(), z.boolean()),
    missing: z.array(z.string()),
  }),
  media: z
    .object({
      ffmpeg: z.boolean().nullable(),
      ffprobe: z.boolean().nullable(),
    })
    .optional(),
  extendedInputs: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
