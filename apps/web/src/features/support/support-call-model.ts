import {
  LIMITS,
  type SupportCallPhase,
  type SupportCallSpeaker,
  type SupportCallTranscriptLine,
} from "@symptomsketch/contracts";

/** Pure state for the live AI support agent call (no SDK, no DOM), so it is unit-testable. */

export interface CallLine {
  id: number;
  speaker: SupportCallSpeaker;
  text: string;
  typed?: boolean;
}

export interface TranscriptState {
  lines: CallLine[];
  /** Unsettled text per speaker (shown greyed until the final arrives). */
  interim: Partial<Record<SupportCallSpeaker, string>>;
  nextId: number;
  /** Last typed message, so the model's echo of it is not listed twice. */
  lastTyped: { text: string; at: number } | null;
}

export const EMPTY_TRANSCRIPT: TranscriptState = {
  lines: [],
  interim: {},
  nextId: 1,
  lastTyped: null,
};

const ECHO_WINDOW_MS = 15_000;

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function speakerOf(raw: string): SupportCallSpeaker {
  return raw === "user" ? "user" : "character";
}

/** Fold one SDK `transcript` message into the state. */
export function applyTranscript(
  state: TranscriptState,
  msg: { speaker: string; text: string; final: boolean },
  at = Date.now(),
): TranscriptState {
  const speaker = speakerOf(msg.speaker);
  const text = msg.text.trim();
  if (!msg.final) {
    return { ...state, interim: { ...state.interim, [speaker]: text } };
  }
  const interim = { ...state.interim };
  delete interim[speaker];
  if (!text) return { ...state, interim };
  const echo =
    speaker === "user" &&
    state.lastTyped !== null &&
    at - state.lastTyped.at < ECHO_WINDOW_MS &&
    norm(state.lastTyped.text) === norm(text);
  if (echo) return { ...state, interim, lastTyped: null };
  return {
    ...state,
    interim,
    lines: [...state.lines, { id: state.nextId, speaker, text }],
    nextId: state.nextId + 1,
  };
}

/** A typed say() message is listed immediately as the customer's line. */
export function addTypedLine(
  state: TranscriptState,
  text: string,
  at = Date.now(),
): TranscriptState {
  const clean = text.trim();
  if (!clean) return state;
  return {
    ...state,
    lines: [...state.lines, { id: state.nextId, speaker: "user", text: clean, typed: true }],
    nextId: state.nextId + 1,
    lastTyped: { text: clean, at },
  };
}

/** Final lines in the stored-transcript shape (bounded to the contract limits). */
export function finalLines(state: TranscriptState): SupportCallTranscriptLine[] {
  return state.lines.slice(-LIMITS.supportCallTranscriptMaxLines).map((l) => ({
    speaker: l.speaker,
    text: l.text.slice(0, LIMITS.supportCallLineMaxChars),
    ...(l.typed ? { typed: true } : {}),
  }));
}

/** SDK session_state.phase -> the four plain labels the UI shows. */
export function phaseFromSession(phase: string, callStarted: boolean): SupportCallPhase {
  switch (phase) {
    case "starting":
    case "warming_up":
      return "connecting";
    case "live":
      return "live";
    case "ending":
    case "ended":
    case "failed":
      return callStarted ? "ended" : "preparing";
    default:
      return "preparing";
  }
}

/** Seconds the call may run: the provider's call_max_seconds, never past the client cap. */
export function callCapSeconds(callMaxSeconds: number | null): number {
  const client = Math.floor(LIMITS.supportCallClientMaxMs / 1000);
  return callMaxSeconds && callMaxSeconds > 0 ? Math.min(callMaxSeconds, client) : client;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface CallView {
  phase: SupportCallPhase;
  /** Plain sub-step under the phase label, e.g. "Building the avatar". */
  detail: string | null;
  error: string | null;
  transcript: TranscriptState;
  elapsedSeconds: number;
  capSeconds: number;
  micOn: boolean;
  micNotice: string | null;
  /** Object URL of the portrait this call uses (shown until video arrives). */
  portraitUrl: string | null;
  hasVideo: boolean;
  /** Sam's live output (main_video + main_audio) while the call runs; null otherwise. */
  media: MediaStream | null;
  /** Epoch ms when the call went live (the real call start), null before. */
  liveAt: number | null;
  /** Measured create_avatar time (upload excluded), null when an avatar was re-attached. */
  avatarMs: number | null;
  endReason: string | null;
}

export const INITIAL_CALL_VIEW: CallView = {
  phase: "idle",
  detail: null,
  error: null,
  transcript: EMPTY_TRANSCRIPT,
  elapsedSeconds: 0,
  capSeconds: callCapSeconds(null),
  micOn: false,
  micNotice: null,
  portraitUrl: null,
  hasVideo: false,
  media: null,
  liveAt: null,
  avatarMs: null,
  endReason: null,
};

export interface CallEnded {
  lines: SupportCallTranscriptLine[];
  durationSeconds: number;
  endReason: string | null;
}
