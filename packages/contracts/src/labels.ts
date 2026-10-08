import type {
  AssessmentUiStatus,
  CaptureReason,
  CheckResult,
  ErrorCode,
  ProcessingState,
  Purpose,
  ReviewDecision,
  ReviewState,
  SourceType,
} from "./common.ts";

/** Internal queue every Quick Demo submission routes to (spec 5). */
export const SUPPORT_QUEUE_LABEL = "SymptomSketch Demo Support";

/** Permanent purpose label burned into recorded pixels and every export message (spec 1, 12). */
export const PURPOSE_LABELS: Record<Purpose, string> = {
  problem: "AI-generated reenactment",
  solution: "AI-generated instructional illustration",
};

/** Secondary purpose control inside Recreate (spec 6). */
export const PURPOSE_MODE_LABELS: Record<Purpose, string> = {
  problem: "Show the problem",
  solution: "Show the solution",
};

export const CASE_TABS = ["issue", "recreate", "support"] as const;
export type CaseTab = (typeof CASE_TABS)[number];
export const CASE_TAB_LABELS: Record<CaseTab, string> = {
  issue: "Issue",
  recreate: "Recreate",
  support: "Support",
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  demo_photo: "Demo reference",
  uploaded_photo: "Uploaded photo",
};

/** Review buttons per mode (spec 1, 6). Neither produces a generic "verified" badge. */
export const REVIEW_ACTION_LABELS: Record<Purpose, Record<ReviewDecision, string>> = {
  problem: {
    accept: "Matches my description",
    refine: "Keep refining",
    unsure: "I'm not sure",
  },
  solution: {
    accept: "I checked this against the supplied instructions",
    refine: "Keep refining",
    unsure: "I'm not sure",
  },
};

/** Review state a decision produces. */
export const REVIEW_DECISION_STATE: Record<ReviewDecision, ReviewState> = {
  accept: "accepted",
  refine: "rejected",
  unsure: "uncertain",
};

/** Critic chip labels (spec 9). No numeric score, no "verified". */
export const ASSESSMENT_LABELS: Record<AssessmentUiStatus, string> = {
  pending: "Checking the clip against your description",
  matches: "Appears consistent",
  needs_revision: "Needs revision",
  uncertain: "Unable to verify",
  unavailable: "Check unavailable",
};

export const CHECK_RESULT_LABELS: Record<CheckResult, string> = {
  supported: "Supported",
  contradicted: "Contradicted",
  not_observable: "Not observable",
};

export const PROCESSING_LABELS: Record<ProcessingState, string> = {
  uploading: "Uploading",
  queued: "Queued",
  converting: "Preparing your MP4",
  ready: "Ready",
  failed: "Export failed",
};

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  unreviewed: "Review",
  uncertain: "Unsure",
  rejected: "Rejected",
  accepted: "Matched",
};

export const CAPTURE_REASON_LABELS: Record<CaptureReason, string> = {
  output_timeout: "No generated output arrived in time",
  output_stalled: "Generated output stalled",
  disconnected: "The Reactor X2 session disconnected",
  user_cancelled: "Recording cancelled",
};

/** One honest shelf label for a take (spec 6 take shelf). */
export type TakeShelfLabel =
  | "Uploading"
  | "Processing"
  | "Export failed"
  | "Incomplete"
  | "Review"
  | "Unsure"
  | "Matched"
  | "Rejected";

export function takeShelfLabel(take: {
  captureStatus: "complete" | "incomplete";
  processingState: ProcessingState;
  reviewState: ReviewState;
}): TakeShelfLabel {
  if (take.captureStatus === "incomplete") return "Incomplete";
  if (take.processingState === "uploading") return "Uploading";
  if (take.processingState === "failed") return "Export failed";
  if (take.processingState !== "ready") return "Processing";
  return REVIEW_STATE_LABELS[take.reviewState] as TakeShelfLabel;
}

/** Highlight field chips paired with tints (spec 6). */
export const HIGHLIGHT_FIELD_LABELS = {
  movement: "Movement",
  count: "Count",
  timing: "Timing",
  magnitude: "Magnitude",
  start: "Start",
  end: "End",
  other: "Detail",
} as const;

/** UI states of the sandbox (spec 6 "Copy and interaction states"). */
export const UI_STATES = [
  "empty",
  "product_generation",
  "planning",
  "connecting",
  "waiting_frames",
  "live",
  "updating",
  "armed",
  "recording",
  "uploading",
  "checking",
  "review",
  "accepted",
  "provider_failure",
] as const;
export type UiState = (typeof UI_STATES)[number];

export const UI_STATE_COPY: Record<UiState, { copy: string; actions: string }> = {
  empty: { copy: "Make the movement easier to explain", actions: "Start demo or upload a photo" },
  product_generation: { copy: "Creating your product reference", actions: "Cancel" },
  planning: { copy: "Understanding the action", actions: "Preserve editable input" },
  connecting: { copy: "Connecting to Reactor X2", actions: "Cancel" },
  waiting_frames: { copy: "Preparing your preview", actions: "Stop preview" },
  live: { copy: "Live preview", actions: "Refine, Record next take, Stop" },
  updating: {
    copy: "Updating the movement",
    actions: "Stop; recording disabled until the current plan is ready",
  },
  armed: {
    copy: "Preparing the next take",
    actions: "Cancel; recording begins before the action request",
  },
  recording: { copy: "Recording", actions: "Stop and review" },
  uploading: { copy: "Preparing your MP4", actions: "Keep the case available" },
  checking: {
    copy: "Checking the clip against your description",
    actions: "View saved clip; keep work preserved",
  },
  review: { copy: "Review this saved clip", actions: "Confirm, Refine, Unsure" },
  accepted: { copy: "Ready to attach to your message", actions: "Download, Copy explanation" },
  provider_failure: {
    copy: "The preview could not be created",
    actions: "Retry with the existing work preserved",
  },
};

/** Live stage status (web-preview LiveStage). Subset of UI states plus idle/error. */
export const PREVIEW_STATUSES = [
  "idle",
  "connecting",
  "waiting_frames",
  "live",
  "updating",
  "armed",
  "recording",
  "uploading",
  "error",
] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export const PREVIEW_STATUS_COPY: Record<PreviewStatus, string> = {
  idle: "Preview stopped",
  connecting: UI_STATE_COPY.connecting.copy,
  waiting_frames: UI_STATE_COPY.waiting_frames.copy,
  live: UI_STATE_COPY.live.copy,
  updating: UI_STATE_COPY.updating.copy,
  armed: UI_STATE_COPY.armed.copy,
  recording: UI_STATE_COPY.recording.copy,
  uploading: UI_STATE_COPY.uploading.copy,
  error: UI_STATE_COPY.provider_failure.copy,
};

/** Default user-facing copy per error code. Server may send a more specific message. */
export const ERROR_COPY: Record<ErrorCode, string> = {
  SUPPORT_FORBIDDEN: "This action is only available to Demo Support.",
  TICKET_CONFLICT: "This ticket changed. Refresh and try again.",
  ASSESSMENT_FAILED: "Check unavailable. You can retry the check.",
  FEATURE_DISABLED: "This feature is not available in the demo.",
  CONFIG_MISSING: "The server is missing required configuration.",
  SOURCE_INVALID: "That file could not be used as a product photo.",
  PROVIDER_BLOCKED: "The provider declined this request. Try rephrasing.",
  PLAN_CONFLICT: "The plan changed. Refresh and try again.",
  REACTOR_UNAVAILABLE: "Reactor X2 is unavailable right now.",
  RECORDING_UNSUPPORTED: "This browser cannot record the preview.",
  EXPORT_FAILED: "The MP4 could not be prepared. Retry export.",
  SESSION_EXPIRED: "Your session expired. Enter the access code again.",
  NOT_FOUND: "Not found.",
  FORBIDDEN: "You do not have access to this.",
  VALIDATION_FAILED: "Some fields are missing or invalid.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  CAPACITY_FULL: "The demo is at capacity. Try again shortly.",
  ACCESS_REQUIRED: "Enter the demo access code to continue.",
  PROVIDER_FAILED: "The provider request failed. Your work is preserved.",
  PROVIDER_TIMEOUT: "The provider timed out. Retry deliberately; your work is preserved.",
  REVIEW_CONFLICT: "This take or its check changed. Review it again.",
  TAKE_NOT_READY: "This take is not ready yet.",
  CAPTURE_INCOMPLETE: "This take is incomplete and cannot be accepted.",
  CASE_INACTIVE: "This case was deleted or expired.",
  PAYLOAD_TOO_LARGE: "That file is too large.",
  INTERNAL_ERROR: "Something went wrong. Your work is preserved.",
};
