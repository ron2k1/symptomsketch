import { CAPTURE_REASON_LABELS, ERROR_COPY, PREVIEW_STATUS_COPY } from "@symptomsketch/contracts";
import { isApiClientError } from "@/lib/api";
import { PreviewFailure } from "./x2-preview";

/** What the stage shows for a failure. `detail` is app copy, never a raw provider message. */
export interface StageError {
  title: string;
  detail: string;
}

const TITLE = PREVIEW_STATUS_COPY.error; // "The preview could not be created"

/** Provider codes (docs/providers/reactor-x2.md section 6) mapped to user-facing copy. */
function reactorDetail(code: string): string {
  switch (code) {
    case "RATE_LIMITED":
      return ERROR_COPY.RATE_LIMITED;
    case "invalid_image":
      return "Reactor X2 could not use this product photo. Try a clearer photo.";
    case "invalid_command":
      return "Reactor X2 did not accept this movement description. Refine it and retry.";
    case "DISCONNECTED":
    case "TRANSPORT_ERROR":
    case "SESSION_TERMINAL":
      return CAPTURE_REASON_LABELS.disconnected;
    default:
      return ERROR_COPY.REACTOR_UNAVAILABLE;
  }
}

export function stageErrorFrom(err: unknown): StageError {
  if (isApiClientError(err)) return { title: TITLE, detail: err.message };
  if (err instanceof PreviewFailure) return { title: TITLE, detail: reactorDetail(err.code) };
  return { title: TITLE, detail: ERROR_COPY.REACTOR_UNAVAILABLE };
}

export const STAGE_ERRORS = {
  disconnected: { title: TITLE, detail: CAPTURE_REASON_LABELS.disconnected },
  moderated: { title: TITLE, detail: ERROR_COPY.PROVIDER_BLOCKED },
  referenceLoad: { title: TITLE, detail: "The product photo could not be loaded for the preview." },
  recordingTooLarge: { title: "The take could not be saved", detail: ERROR_COPY.PAYLOAD_TOO_LARGE },
} as const satisfies Record<string, StageError>;

/** Why a live preview stopped on its own (shown as a one-line notice, not an error). */
export const STOP_NOTICES = {
  idle: "Preview stopped after 90 seconds without activity.",
  max: "Preview stopped at the 5 minute session limit.",
  lease: "The Reactor X2 session ended. Start it again when you are ready.",
  reference: "The product reference changed. Start the preview again to use it.",
} as const;
export type StopNoticeKey = keyof typeof STOP_NOTICES;
