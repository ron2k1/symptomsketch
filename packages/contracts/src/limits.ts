/** Numeric limits from the spec (sections 3, 6, 8, 9, 12, 14). Single source of truth for both apps. */

export const MiB = 1024 * 1024;

export const LIMITS = {
  // Product photo intake (spec 3)
  uploadMaxBytes: 10 * MiB,
  uploadMimeTypes: ["image/jpeg", "image/png", "image/webp"] as readonly string[],
  referenceMaxLongEdge: 1280,
  /** Stable 16:9 source canvas published to Reactor X2. */
  sourceCanvasWidth: 1280,
  sourceCanvasHeight: 720,

  // Capture (spec 12)
  recordingMaxBytes: 25 * MiB,
  recordingMaxSeconds: 35,
  finalClipMinSeconds: 4,
  finalClipMaxSeconds: 12,
  defaultCaptureSeconds: 8,
  earlyStopSeconds: 4,
  maxCaptureSeconds: 12,
  outputStartDeadlineMs: 20_000,
  outputStallMs: 2_000,

  // Export (spec 12)
  finalMp4MaxBytes: 8 * MiB,
  finalMaxWidth: 1280,
  finalMaxHeight: 720,
  finalFps: 24,
  exportJobTimeoutMs: 90_000,

  // Preview + leases (spec 8)
  previewIdleMs: 90_000,
  previewMaxMs: 5 * 60_000,
  previewLeaseTtlMs: 30_000,
  previewHeartbeatMs: 10_000,
  maxLiveScenesPerSession: 1,
  maxLiveScenesGlobal: 2,

  // Polling (spec 5)
  pollIntervalMs: 3_000,
  pollMaxBackoffMs: 30_000,

  // Text sizes
  reactorPromptMaxChars: 1_000,
  captionMaxChars: 90,
  composerMaxChars: 500,
  accountMaxChars: 2_000,
  actionsTriedMaxChars: 2_000,
  titleMaxChars: 120,
  modelLabelMaxChars: 120,
  procedureTextMaxChars: 6_000,
  procedureTitleMaxChars: 200,
  sourceDescriptionMaxChars: 500,
  reviewNoteMaxChars: 500,
  ticketMessageMaxChars: 4_000,
  replyTextMaxChars: 2_000,
  accessCodeMaxChars: 200,
  maxHighlightsPerMessage: 3,

  // Critic (spec 9)
  criticInlineMaxBytes: 20_000_000,
  criticDefaultFps: 8,

  // Live AI support agent call (Reactor Vidu S2 Avatar)
  /** JWT lifetime for the avatar session (seconds). */
  supportCallTokenExpiresSeconds: 600,
  /** Provider-side hard stop per avatar session (seconds). */
  supportCallSessionMaxSeconds: 300,
  /** Client-side cap on one call; billing runs from session ready, so stay short. */
  supportCallClientMaxMs: 4 * 60_000,
  supportCallPersonaMaxChars: 6_000,
  supportCallGreetingMaxChars: 200,
  /** say() accepts 1-2000 chars; the typed box stays shorter. */
  supportCallSayMaxChars: 500,
  supportCallLineMaxChars: 2_000,
  supportCallTranscriptMaxLines: 400,
  /** How long a call waits for the Nano Banana composite before PROVIDER_TIMEOUT (Retry reuses it). */
  supportCallPortraitTimeoutMs: 25_000,
  /** Budget for one composite generation; it keeps running after a call stops waiting. */
  supportCallPortraitGenerateTimeoutMs: 90_000,

  // Persistence (spec 14)
  caseRetentionDays: 7,
  sessionTtlDays: 7,
  jsonBodyMaxBytes: 256 * 1024,
} as const;

export type Limits = typeof LIMITS;
