import { LIMITS } from "@symptomsketch/contracts";

/**
 * Retroactive clipping without a WebM ring buffer: only the first chunk of a MediaRecorder carries
 * the WebM header and a keyframe, so later chunks cannot be stitched into a playable file. Instead
 * N recorders each restart every `periodMs`, staggered by period / N. At any moment one of them has
 * been recording for between period / N and period, and stopping it yields a complete WebM that
 * ends at the click.
 *
 * The server keeps min(12 s, raw - (firstOutputOffset - 0.04 s)) and rejects less than ~3.9 s of
 * generated footage, so the minimum counts output after the first fresh frame, and the period stays
 * under the 12 s export cap so the saved clip always ends at the click.
 */
export interface ClipWindowConfig {
  recorders: number;
  periodMs: number;
  /** Generated output a clip needs (server floor 4 s, plus margin for the trim and encode). */
  minClipMs: number;
  /** Longest recording a clip may come from (the export keeps at most 12 s). */
  maxClipMs: number;
  /** No fresh output frame for this long means the take would freeze: clipping waits. */
  stallMs: number;
}

export const CLIP_WINDOW: ClipWindowConfig = {
  recorders: 2,
  periodMs: LIMITS.finalClipMaxSeconds * 1000 - 500,
  minClipMs: LIMITS.finalClipMinSeconds * 1000 + 1000,
  maxClipMs: LIMITS.finalClipMaxSeconds * 1000,
  stallMs: LIMITS.outputStallMs,
};

export type ClipAvailability =
  | { kind: "ready"; slot: number; clipMs: number }
  | { kind: "warming"; msLeft: number }
  | { kind: "stalled" };

export interface SlotRestart {
  slot: number;
  generation: number;
}

export interface ClipPick {
  slot: number;
  startedAt: number;
  firstFrameAt: number;
  /** Recording length of the picked segment at the click. */
  durationMs: number;
  /** The picked slot restarts at once (its recorder was stopped to produce the clip). */
  restart: SlotRestart;
}

interface Slot {
  dueAt: number;
  generation: number;
  startedAt: number | null;
  firstFrameAt: number | null;
}

/** Pure timing for the staggered recorders. Times are performance.now() milliseconds. */
export class ClipSchedule {
  private readonly slots: Slot[];
  private lastFrameAt: number | null = null;

  constructor(
    private readonly epoch: number,
    private readonly cfg: ClipWindowConfig = CLIP_WINDOW,
  ) {
    const stride = cfg.periodMs / cfg.recorders;
    this.slots = Array.from({ length: cfg.recorders }, (_, i) => ({
      dueAt: epoch + i * stride,
      generation: 0,
      startedAt: null,
      firstFrameAt: null,
    }));
  }

  /** Slots whose recorder must (re)start now. Boundaries stay on the epoch grid even when late. */
  due(now: number): SlotRestart[] {
    const out: SlotRestart[] = [];
    this.slots.forEach((slot, i) => {
      if (slot.dueAt > now) return;
      const missed = Math.floor((now - slot.dueAt) / this.cfg.periodMs);
      slot.dueAt += (missed + 1) * this.cfg.periodMs;
      out.push(this.restart(i));
    });
    return out;
  }

  /** The recorder of `slot` began recording at `at`; ignored for a replaced generation. */
  started(slot: number, generation: number, at: number): void {
    const s = this.slots[slot];
    if (!s || s.generation !== generation) return;
    s.startedAt = at;
    s.firstFrameAt = null;
  }

  /** A fresh X2 output frame was drawn into the recorded canvas at `at`. */
  frame(at: number): void {
    this.lastFrameAt = at;
    for (const s of this.slots) {
      if (s.startedAt !== null && s.firstFrameAt === null && at >= s.startedAt) {
        s.firstFrameAt = at;
      }
    }
  }

  availability(now: number): ClipAvailability {
    if (now - (this.lastFrameAt ?? this.epoch) >= this.cfg.stallMs) return { kind: "stalled" };
    let best: { slot: number; clipMs: number } | null = null;
    let readyAt = Number.POSITIVE_INFINITY;
    for (const [i, s] of this.slots.entries()) {
      if (
        s.startedAt !== null &&
        s.firstFrameAt !== null &&
        now - s.startedAt <= this.cfg.maxClipMs
      ) {
        const clipMs = now - s.firstFrameAt;
        if (clipMs < this.cfg.minClipMs) {
          readyAt = Math.min(readyAt, s.firstFrameAt + this.cfg.minClipMs);
        } else if (!best || clipMs > best.clipMs) {
          best = { slot: i, clipMs };
        }
        continue;
      }
      // Not started, no fresh frame yet, or overdue: it restarts at its due time at the earliest.
      readyAt = Math.min(readyAt, Math.max(now, s.dueAt) + this.cfg.minClipMs);
    }
    if (best) return { kind: "ready", slot: best.slot, clipMs: best.clipMs };
    return { kind: "warming", msLeft: Math.max(0, readyAt - now) };
  }

  /** Picks the longest ready segment ending now and restarts its slot; null when none is ready. */
  take(now: number): ClipPick | null {
    const a = this.availability(now);
    if (a.kind !== "ready") return null;
    const s = this.slots[a.slot]!;
    const pick = {
      slot: a.slot,
      startedAt: s.startedAt!,
      firstFrameAt: s.firstFrameAt!,
      durationMs: now - s.startedAt!,
    };
    return { ...pick, restart: this.restart(a.slot) };
  }

  private restart(i: number): SlotRestart {
    const s = this.slots[i]!;
    s.generation += 1;
    s.startedAt = null;
    s.firstFrameAt = null;
    return { slot: i, generation: s.generation };
  }
}

export type ClipReadiness =
  | { kind: "ready"; seconds: number }
  | { kind: "warming"; secondsLeft: number }
  | { kind: "stalled" };

/** Whole seconds for the UI: the clip length never overstated, the wait never shown as 0 s. */
export function clipReadiness(a: ClipAvailability): ClipReadiness {
  if (a.kind === "ready") return { kind: "ready", seconds: Math.floor(a.clipMs / 1000) };
  if (a.kind === "warming") {
    return { kind: "warming", secondsLeft: Math.max(1, Math.ceil(a.msLeft / 1000)) };
  }
  return { kind: "stalled" };
}

/** firstOutputOffsetMs for the upload: recorder start to the first fresh frame, whole ms. */
export function clipOffsetMs(seg: { startedAt: number; firstFrameAt: number }): number {
  return Math.max(0, Math.round(seg.firstFrameAt - seg.startedAt));
}
