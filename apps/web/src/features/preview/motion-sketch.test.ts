import { describe, expect, it } from "vitest";
import type { SelectedAction } from "@symptomsketch/contracts";
import {
  DEMO_VACUUM_REGION,
  MOTION,
  amplitudeFor,
  buildMotionProgram,
  durationFor,
  pointerSchedule,
  poseAt,
  programEndMs,
  progressAt,
} from "./motion-sketch";
import { lumaDistance, matchKnownRegion } from "./product-region";

function action(patch: Partial<SelectedAction> = {}): SelectedAction {
  return {
    subject: "robot vacuum",
    startingState: "sits still on the rug",
    action: "moves backward",
    direction: "backward",
    repetitions: 1,
    timing: "over about 2 seconds",
    magnitude: "about a quarter of its body length",
    endingState: "stopped on the rug",
    ...patch,
  };
}

describe("buildMotionProgram (motion-lab recipe)", () => {
  it("demo vacuum backward = screen-right and slightly away, 8% W, shrink to 0.97, 2 s", () => {
    const p = buildMotionProgram(action(), DEMO_VACUUM_REGION);
    expect(p).toEqual({
      dx: 0.08,
      dy: -0.02,
      endScale: 0.97,
      segments: [{ startMs: 500, durMs: 2000, from: 0, to: 1 }],
      pointer: true,
    });
  });

  it("falls back to safe defaults when every detail field is null", () => {
    const p = buildMotionProgram(
      action({
        direction: null,
        repetitions: null,
        timing: null,
        magnitude: null,
        action: "moves backward",
      }),
      DEMO_VACUUM_REGION,
    );
    // Null direction: the direction word in the action text is used.
    expect(p).toMatchObject({ dx: 0.08, dy: -0.02, endScale: 0.97, pointer: true });
    expect(p?.segments).toEqual([{ startMs: 500, durMs: 2000, from: 0, to: 1 }]);
  });

  it("never guesses a direction: no direction field and none in the text keeps the still", () => {
    expect(
      buildMotionProgram(action({ action: "moves", direction: null }), DEMO_VACUUM_REGION),
    ).toBeNull();
  });

  it("negated travel, nouns and a person's step are not product motion (direction null)", () => {
    const still = (text: string) =>
      buildMotionProgram(action({ action: text, direction: null }), DEMO_VACUUM_REGION);
    expect(still("does not move when the start button is pressed")).toBeNull();
    expect(still("spins in place without moving forward")).toBeNull();
    expect(still("stops moving and beeps")).toBeNull();
    expect(still("headlight blinks red")).toBeNull();
    expect(still("presses the start button once and steps back")).toBeNull();
    // A negated direction field or travel verb never moves the product either.
    expect(
      buildMotionProgram(
        action({ action: "does not move forward", direction: "forward" }),
        DEMO_VACUUM_REGION,
      ),
    ).toBeNull();
  });

  it("a negated 'reversing' does not override an explicit forward", () => {
    const p = buildMotionProgram(
      action({
        action: "drives forward in a straight line without stopping or reversing",
        direction: null,
      }),
      DEMO_VACUUM_REGION,
    );
    expect(p).toMatchObject({ dx: -0.08, dy: 0.02, endScale: 1.03 }); // forward, not backward
  });

  it("a stop before the move in another clause does not negate it", () => {
    const p = buildMotionProgram(
      action({ action: "stops, then jerks backward", direction: null }),
      DEMO_VACUUM_REGION,
    );
    expect(p).toMatchObject({ dx: 0.08, dy: -0.02 });
  });

  it("no region (an uploaded photo) or no action keeps the static still", () => {
    expect(buildMotionProgram(action(), null)).toBeNull();
    expect(buildMotionProgram(null, DEMO_VACUUM_REGION)).toBeNull();
  });

  it("rotations, lights and unmapped directions are not translated", () => {
    expect(
      buildMotionProgram(
        action({ action: "spins in place", direction: "clockwise" }),
        DEMO_VACUUM_REGION,
      ),
    ).toBeNull();
    expect(
      buildMotionProgram(
        action({ action: "blinks its light", direction: null }),
        DEMO_VACUUM_REGION,
      ),
    ).toBeNull();
    expect(
      buildMotionProgram(action({ action: "moves", direction: "diagonally" }), DEMO_VACUUM_REGION),
    ).toBeNull();
  });

  it("maps screen directions without a depth change", () => {
    const left = buildMotionProgram(action({ direction: "to the left" }), DEMO_VACUUM_REGION);
    expect(left).toMatchObject({ dx: -0.08, dy: 0, endScale: 1 });
    const right = buildMotionProgram(action({ direction: "right" }), DEMO_VACUUM_REGION);
    expect(right).toMatchObject({ dx: 0.08, dy: 0, endScale: 1 });
    const up = buildMotionProgram(action({ direction: "up" }), DEMO_VACUUM_REGION);
    expect(up).toMatchObject({ dx: 0, dy: -0.08, endScale: 1 });
  });

  it("forward on the demo is screen-left and toward the camera (grows)", () => {
    const p = buildMotionProgram(action({ direction: "forward" }), DEMO_VACUUM_REGION);
    expect(p).toMatchObject({ dx: -0.08, dy: 0.02, endScale: 1.03 });
  });

  it("magnitude words map to 0.06..0.12 of frame width, never outside", () => {
    expect(amplitudeFor(null)).toBe(0.08);
    expect(amplitudeFor("a little")).toBe(0.08);
    expect(amplitudeFor("half its body length")).toBe(0.12);
    expect(amplitudeFor("noticeable")).toBe(0.12);
    expect(amplitudeFor("tiny")).toBe(0.06);
    const big = buildMotionProgram(
      action({ magnitude: "half its body length" }),
      DEMO_VACUUM_REGION,
    );
    expect(big).toMatchObject({ dx: 0.12, dy: -0.03, endScale: 0.955 });
  });

  it("timing parses seconds and quick/slow words, clamped to 1.5..2.5 s", () => {
    expect(durationFor("over about 2 seconds")).toBe(2000);
    expect(durationFor("in 1.8 s")).toBe(1800);
    expect(durationFor("10 seconds")).toBe(2500);
    expect(durationFor("half a second")).toBe(1500);
    expect(durationFor(null, "jerks backward")).toBe(1500);
    expect(durationFor("slowly")).toBe(2500);
    expect(durationFor(null)).toBe(2000);
  });

  it("repetitions split the path into equal steps with a 300 ms hold, total capped at 0.12", () => {
    const p = buildMotionProgram(
      action({ repetitions: 2, timing: "2 seconds" }),
      DEMO_VACUUM_REGION,
    )!;
    expect(p.dx).toBe(0.12);
    expect(p.segments).toEqual([
      { startMs: 500, durMs: 2000, from: 0, to: 0.5 },
      { startMs: 2800, durMs: 2000, from: 0.5, to: 1 },
    ]);
    const many = buildMotionProgram(action({ repetitions: 9 }), DEMO_VACUUM_REGION)!;
    expect(many.segments).toHaveLength(MOTION.maxRepetitions);
  });
});

describe("progress, pose and pointer path", () => {
  const program = buildMotionProgram(action(), DEMO_VACUUM_REGION)!;

  it("holds the still for 500 ms, eases in-out over the duration, then holds the end pose", () => {
    expect(progressAt(program, 0)).toBe(0);
    expect(progressAt(program, 499)).toBe(0);
    expect(progressAt(program, 1500)).toBeCloseTo(0.5, 5);
    expect(progressAt(program, 1000)).toBeLessThan(0.25); // ease-in
    expect(progressAt(program, 2500)).toBe(1);
    expect(progressAt(program, 60_000)).toBe(1);
    expect(programEndMs(program)).toBe(2500);
    expect(poseAt(program, 1)).toEqual({ dx: 0.08, dy: -0.02, scale: 0.97 });
    expect(poseAt(program, 0)).toEqual({ dx: 0, dy: 0, scale: 1 });
  });

  it("drags the pointer from the raised centre along the same path, then releases at the end", () => {
    const samples = pointerSchedule(program, { x: 0.54, y: 0.68 }, 0.3);
    expect(samples).toHaveLength(MOTION.pointerSteps + 2);
    expect(samples[0]).toMatchObject({ atMs: 500, x: 0.54, active: true });
    expect(samples[0]?.y).toBeCloseTo(0.668, 6);
    const last = samples.at(-1)!;
    expect(last).toMatchObject({ atMs: 2650, active: false });
    expect(last.x).toBeCloseTo(0.62, 6);
    expect(last.y).toBeCloseTo(0.648, 6);
    expect(samples.slice(0, -1).every((s) => s.active)).toBe(true);
    const xs = samples.map((s) => s.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs); // monotone along the path
  });
});

describe("product region matching", () => {
  it("matches only a still with the demo aspect and a close luma fingerprint", () => {
    const flat = new Array<number>(96).fill(128);
    expect(lumaDistance(flat, flat)).toBe(0);
    expect(lumaDistance(flat, [1, 2])).toBe(Number.POSITIVE_INFINITY);
    expect(matchKnownRegion(1600 / 1067, flat)).toBeNull();
  });
});
