import { LIMITS, type CaptureReason } from "@symptomsketch/contracts";

/** Capture limits (spec 12); all in ms. Defaults come from contracts LIMITS. */
export interface CaptureTimings {
  /** No fresh output this long after the recorder started -> incomplete output_timeout. */
  outputStartDeadlineMs: number;
  /** No fresh decoded frame for this long after first output -> incomplete output_stalled. */
  stallMs: number;
  /** Default footage kept after the first output frame. */
  targetAfterFirstMs: number;
  /** Earliest user stop after the first output frame. */
  earlyStopAfterFirstMs: number;
  /** Never keep more than this after the first output frame. */
  maxAfterFirstMs: number;
  /** Hard cap on the raw recording. */
  hardCapMs: number;
}

export const DEFAULT_CAPTURE_TIMINGS: CaptureTimings = {
  outputStartDeadlineMs: LIMITS.outputStartDeadlineMs,
  stallMs: LIMITS.outputStallMs,
  targetAfterFirstMs: LIMITS.defaultCaptureSeconds * 1000,
  earlyStopAfterFirstMs: LIMITS.earlyStopSeconds * 1000,
  maxAfterFirstMs: LIMITS.maxCaptureSeconds * 1000,
  hardCapMs: LIMITS.recordingMaxSeconds * 1000,
};

export type CaptureOutcome =
  | { status: "complete"; reason: null; endedBy: "target" | "early_stop" | "hard_cap" }
  | { status: "incomplete"; reason: CaptureReason };

export interface CaptureSnapshot {
  phase: "not_started" | "waiting_output" | "output" | "done";
  /** Since the recorder actually started. */
  elapsedMs: number;
  /** Since the first fresh output frame (0 before it). */
  outputMs: number;
  firstOutputOffsetMs: number | null;
  canStopEarly: boolean;
  outcome: CaptureOutcome | null;
}

/**
 * Pure armed-recording state machine (spec 12). Every input carries its own monotonic timestamp
 * (performance.now() in the app), so it is deterministic under test. The first terminal outcome wins
 * and is sticky.
 */
export class CaptureMachine {
  private readonly t: CaptureTimings;
  private startedAt: number | null = null;
  private firstAt: number | null = null;
  private lastFrameAt: number | null = null;
  private outcomeValue: CaptureOutcome | null = null;

  constructor(timings: CaptureTimings = DEFAULT_CAPTURE_TIMINGS) {
    this.t = timings;
  }

  get outcome(): CaptureOutcome | null {
    return this.outcomeValue;
  }

  /** ms from the recorder's actual start to the first fresh frame drawn; null if none yet. */
  get firstOutputOffsetMs(): number | null {
    if (this.startedAt === null || this.firstAt === null) return null;
    return Math.max(0, Math.round(this.firstAt - this.startedAt));
  }

  /** The MediaRecorder actually started (its `start` event). */
  start(at: number): void {
    if (this.startedAt === null && this.outcomeValue === null) this.startedAt = at;
  }

  /** A fresh decoded frame of this run was drawn onto the recording canvas at `at`. */
  frame(at: number): CaptureOutcome | null {
    if (this.outcomeValue || this.startedAt === null) return this.outcomeValue;
    // Deadlines first: a frame arriving after a 2 s gap does not undo the stall.
    const due = this.tick(at);
    if (due) return due;
    if (this.firstAt === null) this.firstAt = at;
    this.lastFrameAt = at;
    return null;
  }

  /** The output track ended or the connection dropped. */
  trackEnded(): CaptureOutcome {
    return this.finish({ status: "incomplete", reason: "disconnected" });
  }

  cancel(): CaptureOutcome {
    return this.finish({ status: "incomplete", reason: "user_cancelled" });
  }

  canStopEarly(at: number): boolean {
    if (this.outcomeValue || this.firstAt === null || this.lastFrameAt === null) return false;
    if (at - this.lastFrameAt >= this.t.stallMs) return false;
    return at - this.firstAt >= this.t.earlyStopAfterFirstMs;
  }

  /** User asked to stop and review. Null when not allowed yet (before 4 s of output). */
  requestStop(at: number): CaptureOutcome | null {
    const due = this.tick(at);
    if (due) return due;
    if (!this.canStopEarly(at)) return null;
    return this.finish({ status: "complete", reason: null, endedBy: "early_stop" });
  }

  /** Evaluates every deadline at `at`; returns the outcome once one is reached. */
  tick(at: number): CaptureOutcome | null {
    if (this.outcomeValue) return this.outcomeValue;
    if (this.startedAt === null) return null;

    if (this.firstAt === null || this.lastFrameAt === null) {
      if (at - this.startedAt >= this.t.outputStartDeadlineMs) {
        return this.finish({ status: "incomplete", reason: "output_timeout" });
      }
    } else {
      const stallAt = this.lastFrameAt + this.t.stallMs;
      const keepMs = Math.min(this.t.targetAfterFirstMs, this.t.maxAfterFirstMs);
      const targetAt = this.firstAt + keepMs;
      if (at >= stallAt && stallAt <= targetAt) {
        return this.finish({ status: "incomplete", reason: "output_stalled" });
      }
      if (at >= targetAt)
        return this.finish({ status: "complete", reason: null, endedBy: "target" });
    }

    if (at - this.startedAt >= this.t.hardCapMs) {
      if (this.firstAt === null)
        return this.finish({ status: "incomplete", reason: "output_timeout" });
      if (at - this.firstAt >= this.t.earlyStopAfterFirstMs) {
        return this.finish({ status: "complete", reason: null, endedBy: "hard_cap" });
      }
      return this.finish({ status: "incomplete", reason: "output_stalled" });
    }
    return null;
  }

  snapshot(at: number): CaptureSnapshot {
    const phase =
      this.outcomeValue !== null
        ? "done"
        : this.startedAt === null
          ? "not_started"
          : this.firstAt === null
            ? "waiting_output"
            : "output";
    return {
      phase,
      elapsedMs: this.startedAt === null ? 0 : Math.max(0, at - this.startedAt),
      outputMs: this.firstAt === null ? 0 : Math.max(0, at - this.firstAt),
      firstOutputOffsetMs: this.firstOutputOffsetMs,
      canStopEarly: this.canStopEarly(at),
      outcome: this.outcomeValue,
    };
  }

  private finish(outcome: CaptureOutcome): CaptureOutcome {
    if (!this.outcomeValue) this.outcomeValue = outcome;
    return this.outcomeValue;
  }
}

/**
 * Drives machine.tick() on an interval until an outcome is reached, then calls onOutcome once.
 * Returns a stop function. `now` is injected (performance.now in the app, a fake clock in tests).
 */
export function startCaptureTicker(
  machine: CaptureMachine,
  now: () => number,
  onOutcome: (outcome: CaptureOutcome) => void,
  onTick?: (snapshot: CaptureSnapshot) => void,
  intervalMs = 100,
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    const at = now();
    const outcome = machine.tick(at);
    onTick?.(machine.snapshot(at));
    if (outcome) {
      stop();
      onOutcome(outcome);
    }
  }, intervalMs);
  function stop() {
    stopped = true;
    clearInterval(timer);
  }
  return stop;
}
