import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaptureMachine,
  DEFAULT_CAPTURE_TIMINGS,
  startCaptureTicker,
  type CaptureOutcome,
} from "./capture-machine";

/** Feeds a fresh frame every `stepMs` from `from` to `to` (inclusive of from, exclusive of to). */
function frames(m: CaptureMachine, from: number, to: number, stepMs = 55): CaptureOutcome | null {
  let out: CaptureOutcome | null = null;
  for (let t = from; t < to; t += stepMs) out = m.frame(t) ?? out;
  return out;
}

describe("CaptureMachine (spec 12 limits)", () => {
  it("uses the contract limits", () => {
    expect(DEFAULT_CAPTURE_TIMINGS).toEqual({
      outputStartDeadlineMs: 20_000,
      stallMs: 2_000,
      targetAfterFirstMs: 8_000,
      earlyStopAfterFirstMs: 4_000,
      maxAfterFirstMs: 12_000,
      hardCapMs: 35_000,
    });
  });

  it("records the first-output offset relative to the recorder's actual start", () => {
    const m = new CaptureMachine();
    expect(m.firstOutputOffsetMs).toBeNull();
    m.start(1_000);
    expect(m.tick(1_300)).toBeNull();
    m.frame(1_412.6);
    expect(m.firstOutputOffsetMs).toBe(413);
    m.frame(1_470);
    expect(m.firstOutputOffsetMs).toBe(413); // later frames never move it
  });

  it("ignores frames before the recorder started", () => {
    const m = new CaptureMachine();
    expect(m.frame(50)).toBeNull();
    m.start(100);
    expect(m.firstOutputOffsetMs).toBeNull();
  });

  it("completes 8 s after the first output with steady frames", () => {
    const m = new CaptureMachine();
    m.start(0);
    expect(frames(m, 400, 8_400)).toBeNull();
    expect(m.tick(8_399)).toBeNull();
    expect(m.tick(8_400)).toEqual({ status: "complete", reason: null, endedBy: "target" });
    expect(m.firstOutputOffsetMs).toBe(400);
  });

  it("times out with no output 20 s after the recorder start", () => {
    const m = new CaptureMachine();
    m.start(500);
    expect(m.tick(20_499)).toBeNull();
    expect(m.tick(20_500)).toEqual({ status: "incomplete", reason: "output_timeout" });
    expect(m.firstOutputOffsetMs).toBeNull();
    // a late frame cannot rescue it
    expect(m.frame(20_600)).toEqual({ status: "incomplete", reason: "output_timeout" });
  });

  it("marks a 2 s gap in fresh frames as stalled", () => {
    const m = new CaptureMachine();
    m.start(0);
    frames(m, 300, 3_000);
    const last = 300 + Math.floor((3_000 - 300 - 1) / 55) * 55;
    expect(m.tick(last + 1_999)).toBeNull();
    expect(m.tick(last + 2_000)).toEqual({ status: "incomplete", reason: "output_stalled" });
  });

  it("a frame arriving after the stall threshold does not undo the stall", () => {
    const m = new CaptureMachine();
    m.start(0);
    m.frame(100);
    expect(m.frame(2_200)).toEqual({ status: "incomplete", reason: "output_stalled" });
  });

  it("prefers completion when the target is reached before a stall would be", () => {
    const m = new CaptureMachine();
    m.start(0);
    frames(m, 0, 7_500);
    // last frame 7480, so a stall would be 9480; the 8000 target came first
    expect(m.tick(9_600)).toEqual({ status: "complete", reason: null, endedBy: "target" });
  });

  it("allows early stop only after 4 s of output", () => {
    const m = new CaptureMachine();
    m.start(0);
    frames(m, 1_000, 4_990);
    expect(m.canStopEarly(4_990)).toBe(false);
    expect(m.requestStop(4_990)).toBeNull();
    m.frame(5_000);
    expect(m.canStopEarly(5_000)).toBe(true);
    expect(m.requestStop(5_000)).toEqual({
      status: "complete",
      reason: null,
      endedBy: "early_stop",
    });
  });

  it("does not allow early stop while frames are stalled", () => {
    const m = new CaptureMachine();
    m.start(0);
    frames(m, 0, 5_000);
    expect(m.canStopEarly(7_100)).toBe(false);
  });

  it("track end and cancel produce their reasons; the first outcome is sticky", () => {
    const ended = new CaptureMachine();
    ended.start(0);
    ended.frame(200);
    expect(ended.trackEnded()).toEqual({ status: "incomplete", reason: "disconnected" });
    expect(ended.cancel()).toEqual({ status: "incomplete", reason: "disconnected" });

    const cancelled = new CaptureMachine();
    cancelled.start(0);
    expect(cancelled.cancel()).toEqual({ status: "incomplete", reason: "user_cancelled" });
    expect(cancelled.tick(25_000)).toEqual({ status: "incomplete", reason: "user_cancelled" });
  });

  it("caps kept output at 12 s even if a longer target is configured", () => {
    const m = new CaptureMachine({ ...DEFAULT_CAPTURE_TIMINGS, targetAfterFirstMs: 30_000 });
    m.start(0);
    frames(m, 1_000, 13_100);
    expect(m.tick(13_000)).toEqual({ status: "complete", reason: null, endedBy: "target" });
  });

  it("enforces the 35 s hard cap on the raw recording", () => {
    const m = new CaptureMachine({
      ...DEFAULT_CAPTURE_TIMINGS,
      outputStartDeadlineMs: 60_000,
      targetAfterFirstMs: 60_000,
      maxAfterFirstMs: 60_000,
    });
    m.start(0);
    frames(m, 30_000, 35_000);
    expect(m.tick(35_000)).toEqual({ status: "complete", reason: null, endedBy: "hard_cap" });
  });

  it("snapshots elapsed and output time for the UI", () => {
    const m = new CaptureMachine();
    expect(m.snapshot(0).phase).toBe("not_started");
    m.start(1_000);
    expect(m.snapshot(1_500)).toMatchObject({
      phase: "waiting_output",
      elapsedMs: 500,
      outputMs: 0,
    });
    m.frame(2_000);
    expect(m.snapshot(3_000)).toMatchObject({
      phase: "output",
      elapsedMs: 2_000,
      outputMs: 1_000,
      firstOutputOffsetMs: 1_000,
      canStopEarly: false,
    });
  });
});

describe("startCaptureTicker (fake timers)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires output_timeout from the interval when no frame ever arrives", () => {
    vi.useFakeTimers();
    const m = new CaptureMachine();
    m.start(Date.now());
    const onOutcome = vi.fn();
    startCaptureTicker(m, () => Date.now(), onOutcome);
    vi.advanceTimersByTime(19_900);
    expect(onOutcome).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith({ status: "incomplete", reason: "output_timeout" });
    vi.advanceTimersByTime(5_000);
    expect(onOutcome).toHaveBeenCalledTimes(1);
  });

  it("detects a stall between frames and completes a healthy run at 8 s", () => {
    vi.useFakeTimers();
    const stalled = new CaptureMachine();
    stalled.start(Date.now());
    const onStall = vi.fn();
    startCaptureTicker(stalled, () => Date.now(), onStall);
    vi.advanceTimersByTime(500);
    stalled.frame(Date.now()); // first output at 0.5 s, then nothing
    vi.advanceTimersByTime(1_900);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onStall).toHaveBeenCalledWith({ status: "incomplete", reason: "output_stalled" });

    const healthy = new CaptureMachine();
    healthy.start(Date.now());
    const onDone = vi.fn();
    const ticks: number[] = [];
    startCaptureTicker(
      healthy,
      () => Date.now(),
      onDone,
      (s) => ticks.push(s.elapsedMs),
    );
    const feed = setInterval(() => healthy.frame(Date.now()), 55); // ~18 fps decoded output
    vi.advanceTimersByTime(8_200);
    expect(onDone).toHaveBeenCalledWith({ status: "complete", reason: null, endedBy: "target" });
    clearInterval(feed);
    expect(healthy.firstOutputOffsetMs).toBe(55);
    expect(ticks.length).toBeGreaterThan(50);
  });

  it("stop() halts the ticker before any outcome", () => {
    vi.useFakeTimers();
    const m = new CaptureMachine();
    m.start(Date.now());
    const onOutcome = vi.fn();
    const stop = startCaptureTicker(m, () => Date.now(), onOutcome);
    stop();
    vi.advanceTimersByTime(30_000);
    expect(onOutcome).not.toHaveBeenCalled();
  });
});
