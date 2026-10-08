/**
 * Live Reactor X2 numbers for the stage readout. Every value comes from a real measurement (the
 * SDK's WebRTC stats, our own prompt-ack timing, Resource Timing of the planner request); anything
 * not measured is null and the readout omits it.
 */

/** The subset of the SDK's ConnectionStats we read (structurally compatible with it). */
export interface StatsSample {
  rtt?: number | undefined;
  framesPerSecond?: number | undefined;
  connectionTimings?: { totalMs: number } | undefined;
  timestamp?: number | undefined;
}

export interface LinkStats {
  fps: number | null;
  rttMs: number | null;
  /** connect() to status "ready" for the current connection. */
  connectMs: number | null;
}

export interface LiveStats extends LinkStats {
  /** Last setPrompt round trip to X2's prompt_accepted. */
  appliedMs: number | null;
}

export const EMPTY_STATS: LiveStats = { fps: null, rttMs: null, connectMs: null, appliedMs: null };

/** A measurement, or null when the browser could not produce one. */
export function measured(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function linkStatsFrom(sample: StatsSample): LinkStats {
  return {
    fps: measured(sample.framesPerSecond),
    rttMs: measured(sample.rtt),
    connectMs: measured(sample.connectionTimings?.totalMs),
  };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const ms = (v: number) => (v < 1 ? "<1 ms" : `${Math.round(v)} ms`);
const sec = (v: number) => `${(v / 1000).toFixed(1)} s`;

export interface ReadoutCell {
  key: "session" | "fps" | "rtt" | "planned" | "applied" | "connect";
  label: string;
  value: string;
}

export function readoutCells(input: {
  stats: LiveStats;
  /** Duration of the latest successful Gemini planner request. */
  plannedMs: number | null;
  /** Time since the preview started (spans reconnects). */
  sessionMs: number | null;
}): ReadoutCell[] {
  const { stats } = input;
  const cells: Array<ReadoutCell | null> = [
    cell("session", "Live for", measured(input.sessionMs), formatClock),
    cell("fps", "Output", stats.fps, (v) => `${v.toFixed(1)} fps`),
    cell("rtt", "Round trip", stats.rttMs, ms),
    cell("planned", "Gemini planned in", measured(input.plannedMs), sec),
    cell("applied", "X2 applied in", stats.appliedMs, ms),
    cell("connect", "Connected in", stats.connectMs, sec),
  ];
  return cells.filter((c): c is ReadoutCell => c !== null);
}

function cell(
  key: ReadoutCell["key"],
  label: string,
  value: number | null,
  format: (v: number) => string,
): ReadoutCell | null {
  return value === null ? null : { key, label, value: format(value) };
}
