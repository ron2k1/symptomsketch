import type { SupportCallPhase } from "@symptomsketch/contracts";
import type { TranscriptState } from "../support-call-model";

/** Pure rules for the app-wide call dock (no SDK, no DOM), so they are unit-testable. */

/** Sam's playback volume while a story clip plays over the call. */
export const DUCKED_VOLUME = 0.2;
export const DOCK_MARGIN_PX = 24;
export const DOCK_WIDTH_PX = 300;
/** Requested Document Picture-in-Picture window size (fits the dock card). */
export const PIP_WINDOW_SIZE = { width: 320, height: 520 } as const;

/** "mm:ss" from elapsed seconds (live timer from the real call start). */
export function formatCallTimer(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** A call that is connecting or live (the SDK session is open or opening). */
export function isCallActive(phase: SupportCallPhase): boolean {
  return phase !== "idle" && phase !== "ended";
}

export interface DockInput {
  phase: SupportCallPhase;
  /** Error from the last call (shown with Retry until dismissed). */
  error: string | null;
  errorDismissed: boolean;
  /** The Support tab's full call view for this call is on screen. */
  fullViewOpen: boolean;
  /** A Document Picture-in-Picture window currently hosts the dock. */
  pipOpen: boolean;
}

export type DockPlacement = "hidden" | "page" | "pip";

/**
 * Where the dock renders: nowhere on the full call view or when no call is active (unless the
 * last call failed and the error is not dismissed); in the PiP window while one is open.
 */
export function dockPlacement(input: DockInput): DockPlacement {
  const failed = input.phase === "ended" && input.error !== null && !input.errorDismissed;
  if (!isCallActive(input.phase) && !failed) return "hidden";
  if (input.pipOpen) return "pip";
  if (input.fullViewOpen) return "hidden";
  return "page";
}

export interface CaptionLine {
  speaker: "user" | "character";
  text: string;
  interim: boolean;
}

/** The newest line of the real transcript: Sam's unsettled words first, then the customer's. */
export function latestCaption(transcript: TranscriptState): CaptionLine | null {
  const { interim, lines } = transcript;
  if (interim.character) return { speaker: "character", text: interim.character, interim: true };
  if (interim.user) return { speaker: "user", text: interim.user, interim: true };
  const last = lines[lines.length - 1];
  return last ? { speaker: last.speaker, text: last.text, interim: false } : null;
}

export type PipSupport = "document" | "video" | "none";

export interface PipEnvironment {
  documentPictureInPicture?: unknown;
  document?: { pictureInPictureEnabled?: boolean };
  HTMLVideoElement?: { prototype: object };
}

/** Document PiP (whole dock) > video PiP (Sam's video only) > none (Pop out hidden). */
export function detectPipSupport(env: PipEnvironment | undefined): PipSupport {
  if (!env) return "none";
  const dpip = env.documentPictureInPicture as { requestWindow?: unknown } | undefined;
  if (dpip && typeof dpip.requestWindow === "function") return "document";
  const proto = env.HTMLVideoElement?.prototype as
    { requestPictureInPicture?: unknown } | undefined;
  if (env.document?.pictureInPictureEnabled && typeof proto?.requestPictureInPicture === "function")
    return "video";
  return "none";
}

/** Sam's volume: ducked while at least one story clip is playing. */
export function samVolume(duckCount: number): number {
  return duckCount > 0 ? DUCKED_VOLUME : 1;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Keep the dock's top-left inside the viewport with the margin (top-left wins when too small). */
export function clampDockPosition(
  pos: Point,
  dock: Size,
  viewport: Size,
  margin = DOCK_MARGIN_PX,
): Point {
  const maxX = viewport.width - dock.width - margin;
  const maxY = viewport.height - dock.height - margin;
  return {
    x: Math.max(margin, Math.min(pos.x, maxX)),
    y: Math.max(margin, Math.min(pos.y, maxY)),
  };
}

/** Default spot: bottom-right corner with the margin. */
export function defaultDockPosition(dock: Size, viewport: Size, margin = DOCK_MARGIN_PX): Point {
  return clampDockPosition(
    { x: viewport.width - dock.width - margin, y: viewport.height - dock.height - margin },
    dock,
    viewport,
    margin,
  );
}
