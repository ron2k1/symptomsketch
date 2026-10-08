import { z } from "zod";

/** Opaque server-generated identifier: `<prefix>_<random base64url>`. Never parse it client-side. */
export const Id = z.string().min(1).max(128);
export type Id = z.infer<typeof Id>;

/** Prefixes the server uses when minting ids (see apps/server/src/db/index.ts newId). */
export const ID_PREFIX = {
  session: "ses",
  case: "case",
  productRevision: "prod",
  asset: "ast",
  procedureRevision: "proc",
  message: "msg",
  planRevision: "plan",
  take: "take",
  assessment: "asm",
  review: "rev",
  ticket: "tkt",
  ticketAttachment: "att",
  ticketReply: "rpl",
  job: "job",
  lease: "lse",
  supportCallTranscript: "sct",
} as const;
export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

/** ISO-8601 UTC timestamp string produced by the server (`new Date().toISOString()`). */
export const Timestamp = z.string().min(10).max(40);
export type Timestamp = z.infer<typeof Timestamp>;

/** Client-generated request id (crypto.randomUUID) used for idempotency of paid/duplicate-prone calls. */
export const ClientRequestId = z.string().min(8).max(100);
export type ClientRequestId = z.infer<typeof ClientRequestId>;

/** Lowercase hex SHA-256. */
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export type Sha256 = z.infer<typeof Sha256>;

export const Purpose = z.enum(["problem", "solution"]);
export type Purpose = z.infer<typeof Purpose>;

export const Role = z.enum(["customer", "support"]);
export type Role = z.infer<typeof Role>;

export const SourceType = z.enum(["demo_photo", "uploaded_photo"]);
export type SourceType = z.infer<typeof SourceType>;

export const ProcessingState = z.enum(["uploading", "queued", "converting", "ready", "failed"]);
export type ProcessingState = z.infer<typeof ProcessingState>;

export const ReviewState = z.enum(["unreviewed", "uncertain", "rejected", "accepted"]);
export type ReviewState = z.infer<typeof ReviewState>;

/**
 * Human review decision on an exact final MP4.
 * accept -> accepted ("Matches my description" / "I checked this against the supplied instructions")
 * refine -> rejected ("Keep refining")
 * unsure -> uncertain ("I'm not sure")
 */
export const ReviewDecision = z.enum(["accept", "refine", "unsure"]);
export type ReviewDecision = z.infer<typeof ReviewDecision>;

export const CaptureStatus = z.enum(["complete", "incomplete"]);
export type CaptureStatus = z.infer<typeof CaptureStatus>;

export const CaptureReason = z.enum([
  "output_timeout",
  "output_stalled",
  "disconnected",
  "user_cancelled",
]);
export type CaptureReason = z.infer<typeof CaptureReason>;

/** Server-derived critic status (spec 9). */
export const AssessmentStatus = z.enum(["matches", "needs_revision", "uncertain"]);
export type AssessmentStatus = z.infer<typeof AssessmentStatus>;

/**
 * What the UI shows for a take's visual check: the stored status, plus
 * `pending` (queued/running) and `unavailable` (critic failed or malformed; never favorable).
 */
export const AssessmentUiStatus = z.enum([
  "pending",
  "matches",
  "needs_revision",
  "uncertain",
  "unavailable",
]);
export type AssessmentUiStatus = z.infer<typeof AssessmentUiStatus>;

export const CheckResult = z.enum(["supported", "contradicted", "not_observable"]);
export type CheckResult = z.infer<typeof CheckResult>;

export const ErrorCode = z.enum([
  "SUPPORT_FORBIDDEN",
  "TICKET_CONFLICT",
  "ASSESSMENT_FAILED",
  "FEATURE_DISABLED",
  "CONFIG_MISSING",
  "SOURCE_INVALID",
  "PROVIDER_BLOCKED",
  "PLAN_CONFLICT",
  "REACTOR_UNAVAILABLE",
  "RECORDING_UNSUPPORTED",
  "EXPORT_FAILED",
  "SESSION_EXPIRED",
  "NOT_FOUND",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "CAPACITY_FULL",
  "ACCESS_REQUIRED",
  "PROVIDER_FAILED",
  "PROVIDER_TIMEOUT",
  "REVIEW_CONFLICT",
  "TAKE_NOT_READY",
  "CAPTURE_INCOMPLETE",
  "CASE_INACTIVE",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Default HTTP status per error code. AppError uses this unless a status is given explicitly. */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  SUPPORT_FORBIDDEN: 403,
  TICKET_CONFLICT: 409,
  ASSESSMENT_FAILED: 502,
  FEATURE_DISABLED: 404,
  CONFIG_MISSING: 503,
  SOURCE_INVALID: 422,
  PROVIDER_BLOCKED: 422,
  PLAN_CONFLICT: 409,
  REACTOR_UNAVAILABLE: 503,
  RECORDING_UNSUPPORTED: 422,
  EXPORT_FAILED: 500,
  SESSION_EXPIRED: 401,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  CAPACITY_FULL: 429,
  ACCESS_REQUIRED: 401,
  PROVIDER_FAILED: 502,
  PROVIDER_TIMEOUT: 504,
  REVIEW_CONFLICT: 409,
  TAKE_NOT_READY: 409,
  CAPTURE_INCOMPLETE: 409,
  CASE_INACTIVE: 410,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};

/** Every non-2xx API response body. Never contains raw provider bodies, paths, or secrets. */
export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;

/** Generic `{ ok: true }` acknowledgement (e.g. DELETE). */
export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;
