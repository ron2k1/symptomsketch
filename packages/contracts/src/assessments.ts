import { z } from "zod";
import {
  AssessmentStatus,
  AssessmentUiStatus,
  CheckResult,
  ClientRequestId,
  ErrorCode,
  Id,
  Sha256,
  Timestamp,
} from "./common.ts";

export const CriticCheck = z.object({
  constraintId: z.string().min(1),
  result: CheckResult,
  observation: z.string().min(1),
  timeRangeSeconds: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).nullable(),
});
export type CriticCheck = z.infer<typeof CriticCheck>;

export const InputCoverage = z.object({
  kind: z.enum(["full_video", "sampled_frames"]),
  requestedFps: z.number().positive().nullable(),
  /** Empty for full_video unless the application itself supplied the frames. */
  sampledTimestampsSeconds: z.array(z.number().nonnegative()),
});
export type InputCoverage = z.infer<typeof InputCoverage>;

/**
 * Critic result contract (CLI prompt appendix "Critic result contract"). The application supplies
 * and verifies every binding field; the model only contributes checks/limitations/suggestions.
 * `status` is derived server-side from validated checks (see deriveAssessmentStatus).
 */
export const ClipAssessment = z.object({
  schemaVersion: z.literal(1),
  takeId: Id,
  finalSha256: Sha256,
  productRevisionId: Id,
  planRevisionId: Id,
  procedureRevisionId: Id.nullable(),
  criticPromptVersion: z.string().min(1),
  modelId: z.string().min(1),
  inputCoverage: InputCoverage,
  status: AssessmentStatus,
  checks: z.array(CriticCheck),
  limitations: z.array(z.string()),
  suggestedPresentationChanges: z.array(z.string()),
});
export type ClipAssessment = z.infer<typeof ClipAssessment>;

/** What the critic model itself returns (validated with zod, then bound by the server). */
export const CriticModelOutput = z.object({
  summary: z.string(),
  checks: z.array(CriticCheck),
  limitations: z.array(z.string()),
  suggestedPresentationChanges: z.array(z.string()),
});
export type CriticModelOutput = z.infer<typeof CriticModelOutput>;

export const AssessmentJobState = z.enum(["queued", "running", "done", "failed"]);
export type AssessmentJobState = z.infer<typeof AssessmentJobState>;

/** Stored assessment attempt for a take (one per critic attempt). */
export const TakeAssessment = z.object({
  id: Id,
  takeId: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  jobState: AssessmentJobState,
  /** pending while queued/running, unavailable on failure, else result.status. */
  uiStatus: AssessmentUiStatus,
  summary: z.string().nullable(),
  errorCode: ErrorCode.nullable(),
  result: ClipAssessment.nullable(),
});
export type TakeAssessment = z.infer<typeof TakeAssessment>;

/** POST /api/takes/:id/assessment (idempotent; `retry` re-runs after a failed attempt). */
export const RequestAssessmentRequest = z.object({
  idempotencyKey: ClientRequestId,
  retry: z.boolean().optional(),
});
export type RequestAssessmentRequest = z.infer<typeof RequestAssessmentRequest>;

/**
 * Server-side status derivation (spec 9): any contradiction -> needs_revision; else any
 * not_observable -> uncertain; only a nonempty all-supported set -> matches.
 * Coverage (exact constraint id set) must be validated before calling this.
 */
export function deriveAssessmentStatus(
  checks: readonly { result: z.infer<typeof CheckResult> }[],
): z.infer<typeof AssessmentStatus> {
  if (checks.length === 0) return "uncertain";
  if (checks.some((c) => c.result === "contradicted")) return "needs_revision";
  if (checks.some((c) => c.result === "not_observable")) return "uncertain";
  return "matches";
}
