import { z } from "zod";
import {
  CaptureReason,
  CaptureStatus,
  ClientRequestId,
  ErrorCode,
  Id,
  ProcessingState,
  Purpose,
  ReviewState,
  Sha256,
  Timestamp,
} from "./common.ts";
import { TakeAssessment } from "./assessments.ts";
import { Review } from "./reviews.ts";

/** Saved take DTO. Media URLs are authorized API routes, null until the MP4 is ready. */
export const Take = z.object({
  id: Id,
  caseId: Id,
  purpose: Purpose,
  /** 1-based per case, used in filenames: symptomsketch-case-<n>-take-<NN>.mp4 */
  number: z.number().int().positive(),
  planRevisionId: Id,
  productRevisionId: Id,
  procedureRevisionId: Id.nullable(),
  runId: z.string(),
  captureStatus: CaptureStatus,
  captureReason: CaptureReason.nullable(),
  firstOutputOffsetMs: z.number().nonnegative().nullable(),
  processingState: ProcessingState,
  reviewState: ReviewState,
  durationMs: z.number().nonnegative().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sha256: Sha256.nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  thumbnailUrl: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  /** Present only when the take is accepted (download route enforces this too). */
  downloadUrl: z.string().nullable(),
  caption: z.string(),
  /** Bounded export error (e.g. EXPORT_FAILED) when processingState is failed. */
  errorCode: ErrorCode.nullable(),
  /** True when a failed export can be retried from the retained raw recording. */
  retryable: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  currentAssessment: TakeAssessment.nullable(),
  latestReview: Review.nullable(),
});
export type Take = z.infer<typeof Take>;

/** Multipart field names for POST /api/cases/:id/takes. */
export const TAKE_UPLOAD_FIELDS = {
  /** The recorded canvas blob (webm/mp4 from MediaRecorder). */
  recording: "recording",
  /** JSON string matching CreateTakeMeta. */
  meta: "meta",
} as const;

/** JSON `meta` part of the take upload. */
export const CreateTakeMeta = z.object({
  purpose: Purpose,
  planRevisionId: Id,
  productRevisionId: Id,
  procedureRevisionId: Id.nullable(),
  runId: z.string().min(1).max(100),
  captureStatus: CaptureStatus,
  captureReason: CaptureReason.nullable(),
  /** ms from recorder start to first fresh decoded Reactor frame; null if none arrived. */
  firstOutputOffsetMs: z.number().nonnegative().nullable(),
  /** Recorder-reported duration in ms (server re-validates with ffprobe). */
  recordedDurationMs: z.number().nonnegative(),
  mimeType: z.string().min(1).max(100),
  caption: z.string().max(200),
  idempotencyKey: ClientRequestId,
});
export type CreateTakeMeta = z.infer<typeof CreateTakeMeta>;

/** 202 response of POST /api/cases/:id/takes (same take on idempotent retry). */
export const CreateTakeResponse = z.object({ take: Take });
export type CreateTakeResponse = z.infer<typeof CreateTakeResponse>;

/** GET /api/takes/:id */
export const GetTakeResponse = z.object({ take: Take });
export type GetTakeResponse = z.infer<typeof GetTakeResponse>;

/** POST /api/takes/:id/retry-export */
export const RetryExportRequest = z.object({ idempotencyKey: ClientRequestId });
export type RetryExportRequest = z.infer<typeof RetryExportRequest>;

/** Shared response for assessment request, retry-export and review: the refreshed take. */
export const TakeResponse = z.object({ take: Take });
export type TakeResponse = z.infer<typeof TakeResponse>;

/** GET /api/takes/:id/message: explanation for an external email (spec 13). */
export const TakeMessageResponse = z.object({
  takeId: Id,
  subject: z.string(),
  body: z.string(),
  /** Filename the download route uses, for the copy text. */
  attachmentFilename: z.string(),
});
export type TakeMessageResponse = z.infer<typeof TakeMessageResponse>;

/** symptomsketch-case-<caseNumber or short id>-take-03.mp4 */
export function takeFilename(caseLabel: string | number, takeNumber: number): string {
  return `symptomsketch-case-${caseLabel}-take-${String(takeNumber).padStart(2, "0")}.mp4`;
}
