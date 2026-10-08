import { z } from "zod";
import {
  ClientRequestId,
  Id,
  ReviewDecision,
  ReviewState,
  Role,
  Sha256,
  Timestamp,
} from "./common.ts";
import { LIMITS } from "./limits.ts";

/** Human review bound to exact final MP4 bytes + the assessment it saw (spec 10, 12). */
export const Review = z.object({
  id: Id,
  takeId: Id,
  finalSha256: Sha256,
  assessmentId: Id.nullable(),
  decision: ReviewDecision,
  resultingState: ReviewState,
  uncertaintyNote: z.string().nullable(),
  reviewerRole: Role,
  createdAt: Timestamp,
});
export type Review = z.infer<typeof Review>;

/**
 * POST /api/takes/:id/review. Server transactionally checks: current hash, current assessment
 * binding, purpose-specific rules (needs_revision cannot be accepted; customer accepting an
 * uncertain/unavailable check requires uncertaintyNote; solution accept requires matches),
 * complete capture, and active case. Mismatch -> 409 REVIEW_CONFLICT.
 */
export const CreateReviewRequest = z.object({
  decision: ReviewDecision,
  finalSha256: Sha256,
  assessmentId: Id.nullable(),
  uncertaintyNote: z.string().min(1).max(LIMITS.reviewNoteMaxChars).nullable(),
  idempotencyKey: ClientRequestId,
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequest>;
