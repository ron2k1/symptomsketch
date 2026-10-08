import { describe, expect, it } from "vitest";
import { containRect, stageFit, stageRect } from "./geometry";
import { evaluateSessionClock } from "./session-clock";

describe("evaluateSessionClock (spec 8: 90 s idle, 5 min max)", () => {
  const base = { startedAt: 0, lastActivityAt: 0, busy: false };

  it("stays ok while active", () => {
    expect(evaluateSessionClock({ ...base, now: 60_000 })).toEqual({ kind: "ok" });
  });

  it("shows Continue preview 15 s before the idle stop", () => {
    expect(evaluateSessionClock({ ...base, now: 74_999 })).toEqual({ kind: "ok" });
    expect(evaluateSessionClock({ ...base, now: 80_000 })).toEqual({
      kind: "idle_warning",
      msLeft: 10_000,
    });
    expect(evaluateSessionClock({ ...base, now: 90_000 })).toEqual({
      kind: "stop",
      reason: "idle",
    });
  });

  it("activity resets the idle timer but not the 5 minute max", () => {
    expect(evaluateSessionClock({ ...base, lastActivityAt: 250_000, now: 290_000 })).toEqual({
      kind: "ok",
    });
    expect(evaluateSessionClock({ ...base, lastActivityAt: 299_000, now: 300_000 })).toEqual({
      kind: "stop",
      reason: "max",
    });
  });

  it("never stops during a capture", () => {
    expect(evaluateSessionClock({ ...base, busy: true, now: 400_000 })).toEqual({ kind: "ok" });
  });
});

describe("containRect", () => {
  it("fits X2 output 1472x832 into 1280x720 without distortion", () => {
    const r = containRect(1472, 832, 1280, 720);
    expect(r.w / r.h).toBeCloseTo(1472 / 832, 6);
    expect(r.w).toBeLessThanOrEqual(1280);
    expect(r.h).toBeLessThanOrEqual(720);
    expect(r.x).toBeCloseTo((1280 - r.w) / 2, 6);
  });

  it("letterboxes a 3:2 product photo, never cropping it", () => {
    const r = containRect(1600, 1067, 1280, 720);
    expect(r.h).toBe(720);
    expect(r.w).toBeCloseTo(1600 * (720 / 1067), 6);
    expect(r.x).toBeGreaterThan(0);
  });
});

describe("stageRect", () => {
  it("fills the 16:9 stage with a 3:2 photo (trims ~16% of its height, no side bars)", () => {
    const r = stageRect(1600, 1067, 1280, 720);
    expect(r.x).toBe(0);
    expect(r.w).toBe(1280);
    expect(r.y).toBeLessThan(0);
    expect(r.w / r.h).toBeCloseTo(1600 / 1067, 6);
  });

  it("keeps a portrait photo letterboxed so the product is not cropped away", () => {
    const r = stageRect(1200, 1600, 1280, 720);
    expect(r).toEqual(containRect(1200, 1600, 1280, 720));
  });
});

describe("stageFit", () => {
  it("names the same fit stageRect draws, so the DOM still matches the X2 canvas", () => {
    expect(stageFit(1600, 1067, 1280, 720)).toBe("cover");
    expect(stageFit(1200, 1600, 1280, 720)).toBe("contain");
    expect(stageFit(0, 0, 1280, 720)).toBe("contain");
  });
});
