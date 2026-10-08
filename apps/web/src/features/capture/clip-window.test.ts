import { describe, expect, it } from "vitest";
import {
  CLIP_WINDOW,
  ClipSchedule,
  clipOffsetMs,
  clipReadiness,
  type ClipWindowConfig,
} from "./clip-window";

const CFG: ClipWindowConfig = {
  recorders: 2,
  periodMs: 11_500,
  minClipMs: 5_000,
  maxClipMs: 12_000,
  stallMs: 2_000,
};

/**
 * Drives a schedule like the browser does: every `tickMs` it restarts due slots (their recorder
 * reports `start` `startLagMs` later) and a fresh output frame is drawn every `frameMs`.
 */
function drive(
  s: ClipSchedule,
  from: number,
  to: number,
  opts: { tickMs?: number; frameMs?: number; startLagMs?: number } = {},
) {
  const tickMs = opts.tickMs ?? 250;
  const frameMs = opts.frameMs ?? 55;
  const lag = opts.startLagMs ?? 20;
  const pending: Array<{ at: number; slot: number; generation: number }> = [];
  let nextFrame = from;
  for (let t = from; t <= to; t += 5) {
    for (const p of pending.splice(0)) {
      if (p.at <= t) s.started(p.slot, p.generation, p.at);
      else pending.push(p);
    }
    if (t >= nextFrame) {
      s.frame(t);
      nextFrame += frameMs;
    }
    if ((t - from) % tickMs === 0) {
      for (const d of s.due(t)) pending.push({ at: t + lag, ...d });
    }
  }
}

describe("CLIP_WINDOW (server take limits)", () => {
  it("never saves more than the export keeps, nor less than it needs", () => {
    // The export keeps at most 12 s from the start of the upload, so the clip must end at the click.
    expect(CLIP_WINDOW.periodMs).toBeLessThanOrEqual(12_000);
    expect(CLIP_WINDOW.maxClipMs).toBe(12_000);
    // The export rejects less than 4 s of generated output.
    expect(CLIP_WINDOW.minClipMs).toBeGreaterThanOrEqual(4_000);
    // Two staggered recorders: the shortest steady-state clip is half a period.
    expect(CLIP_WINDOW.periodMs / CLIP_WINDOW.recorders).toBeGreaterThanOrEqual(
      CLIP_WINDOW.minClipMs,
    );
    expect(CLIP_WINDOW.stallMs).toBe(2_000);
  });
});

describe("ClipSchedule", () => {
  it("staggers the recorders by period / N and restarts each every period", () => {
    const s = new ClipSchedule(0, CFG);
    expect(s.due(0)).toEqual([{ slot: 0, generation: 1 }]);
    expect(s.due(5_749)).toEqual([]);
    expect(s.due(5_750)).toEqual([{ slot: 1, generation: 1 }]);
    expect(s.due(11_499)).toEqual([]);
    expect(s.due(11_500)).toEqual([{ slot: 0, generation: 2 }]);
    expect(s.due(17_250)).toEqual([{ slot: 1, generation: 2 }]);
  });

  it("keeps the stagger phase when the timer runs late (throttled tab)", () => {
    const s = new ClipSchedule(0, CFG);
    s.due(0);
    s.due(5_750);
    // 30 s late: one restart per slot, next boundaries stay on the original grid.
    expect(s.due(41_000)).toEqual([
      { slot: 0, generation: 2 },
      { slot: 1, generation: 2 },
    ]);
    expect(s.due(45_999)).toEqual([]);
    expect(s.due(46_000)).toEqual([{ slot: 0, generation: 3 }]);
    expect(s.due(51_750)).toEqual([{ slot: 1, generation: 3 }]);
  });

  it("is warming until minClipMs of generated output exists, then ready", () => {
    const s = new ClipSchedule(1_000, CFG);
    drive(s, 1_000, 2_000);
    // Slot 0 started at 1020; its first fresh frame was drawn at 1055.
    expect(s.availability(2_000)).toEqual({ kind: "warming", msLeft: 4_055 });
    drive(s, 2_000, 6_100);
    expect(s.availability(6_100)).toEqual({ kind: "ready", slot: 0, clipMs: 5_045 });
  });

  it("before the first recorder is due, counts its due time into the wait", () => {
    const s = new ClipSchedule(10_000, CFG);
    expect(s.availability(10_000)).toEqual({ kind: "warming", msLeft: 5_000 });
  });

  it("in steady state always offers a clip between period / 2 and period that ends now", () => {
    const s = new ClipSchedule(0, CFG);
    drive(s, 0, 6_000);
    for (let t = 6_000; t < 120_000; t += 250) {
      drive(s, t, t + 245);
      const now = t + 245;
      const a = s.availability(now);
      expect(a.kind, `at ${now}`).toBe("ready");
      if (a.kind !== "ready") continue;
      expect(a.clipMs).toBeGreaterThanOrEqual(CFG.periodMs / 2 - 300);
      expect(a.clipMs).toBeLessThanOrEqual(CFG.periodMs);
    }
  });

  it("reports stalled output when no fresh frame arrived for stallMs", () => {
    const s = new ClipSchedule(0, CFG);
    drive(s, 0, 7_000);
    s.frame(7_000);
    expect(s.availability(7_000).kind).toBe("ready");
    expect(s.availability(8_999).kind).toBe("ready");
    expect(s.availability(9_000)).toEqual({ kind: "stalled" });
    s.frame(9_100);
    expect(s.availability(9_100).kind).toBe("ready");
  });

  it("counts generated output, not recording time, toward the minimum", () => {
    const s = new ClipSchedule(0, { ...CFG, stallMs: 60_000 });
    const [d] = s.due(0);
    s.started(d!.slot, d!.generation, 10);
    // Recording for 6 s with no fresh frame yet: nothing worth saving.
    expect(s.availability(6_000).kind).toBe("warming");
    s.frame(6_000);
    expect(s.availability(6_000)).toEqual({ kind: "warming", msLeft: 5_000 });
    expect(s.availability(11_000)).toEqual({ kind: "ready", slot: 0, clipMs: 5_000 });
  });

  it("ignores frames drawn before a recorder started", () => {
    const s = new ClipSchedule(0, { ...CFG, stallMs: 60_000 });
    const [d] = s.due(0);
    s.frame(5);
    s.started(d!.slot, d!.generation, 10);
    expect(s.availability(9_000).kind).toBe("warming");
  });

  it("never offers a segment longer than maxClipMs (restart overdue)", () => {
    const s = new ClipSchedule(0, CFG);
    const [d] = s.due(0);
    s.started(d!.slot, d!.generation, 0);
    for (let t = 0; t <= 13_000; t += 50) s.frame(t);
    // Slot 0 is 13 s old and slot 1 never started: nothing valid until due() restarts them.
    expect(s.availability(13_000).kind).toBe("warming");
  });

  it("take() hands out the longest segment, restarts that slot and ignores stale starts", () => {
    const s = new ClipSchedule(0, CFG);
    drive(s, 0, 15_000);
    expect(s.availability(15_000)).toEqual({ kind: "ready", slot: 1, clipMs: 15_000 - 5_775 });
    const pick = s.take(15_000)!;
    expect(pick).toEqual({
      slot: 1,
      startedAt: 5_770,
      firstFrameAt: 5_775,
      durationMs: 15_000 - 5_770,
      restart: { slot: 1, generation: 2 },
    });
    // The other slot (restarted at 11.5 s) has 3.5 s of output: warming again.
    expect(s.availability(15_000).kind).toBe("warming");
    // A start event of the replaced generation is ignored.
    s.started(1, 1, 15_010);
    s.frame(15_015);
    expect(s.availability(15_015).kind).toBe("warming");
    s.started(1, 2, 15_020);
    for (let t = 15_020; t <= 20_100; t += 50) s.frame(t);
    expect(s.availability(20_100)).toMatchObject({ kind: "ready", slot: 0 });
    // The restarted slot keeps its place on the stagger grid.
    expect(s.due(17_249)).toEqual([]);
    expect(s.due(17_250)).toEqual([{ slot: 1, generation: 3 }]);
  });

  it("take() returns null while warming or stalled", () => {
    const s = new ClipSchedule(0, CFG);
    drive(s, 0, 3_000);
    expect(s.take(3_000)).toBeNull();
    drive(s, 3_000, 7_000);
    expect(s.take(9_500)).toBeNull(); // last frame at 6960: stalled
  });
});

describe("clipReadiness (whole seconds for the Clip button)", () => {
  it("labels the clip length rounded down and the wait rounded up, never 0 s", () => {
    expect(clipReadiness({ kind: "ready", slot: 1, clipMs: 9_225 })).toEqual({
      kind: "ready",
      seconds: 9,
    });
    expect(clipReadiness({ kind: "warming", msLeft: 4_055 })).toEqual({
      kind: "warming",
      secondsLeft: 5,
    });
    expect(clipReadiness({ kind: "warming", msLeft: 0 })).toEqual({
      kind: "warming",
      secondsLeft: 1,
    });
    expect(clipReadiness({ kind: "stalled" })).toEqual({ kind: "stalled" });
  });
});

describe("clipOffsetMs", () => {
  it("is the ms from the recorder start to its first fresh frame, never negative", () => {
    expect(clipOffsetMs({ startedAt: 1_000, firstFrameAt: 1_041.6 })).toBe(42);
    expect(clipOffsetMs({ startedAt: 1_000, firstFrameAt: 999 })).toBe(0);
  });
});
