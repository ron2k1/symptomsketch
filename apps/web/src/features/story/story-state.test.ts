import { describe, expect, it } from "vitest";
import {
  branchReadiness,
  initialStoryState,
  planCustom,
  planPick,
  playedBeats,
  shouldPlayPending,
  storyReducer,
  type Offer,
  type StoryEvent,
  type StoryState,
} from "./story-state";

// Labeled stubs only (test fixtures, never shown by the live app).
const scene = (n: number) => ({
  label: `STUB ${n}`,
  caption: `STUB caption ${n}`,
  prompt: `STUB prompt ${n} with a motor whine`,
});
const meta = (beat: number, choice: string) => JSON.stringify({ beat, choice });

function run(events: StoryEvent[], s: StoryState = initialStoryState()): StoryState {
  return events.reduce(storyReducer, s);
}

function offerWith(ids: (string | null)[]): Offer {
  return {
    beat: 2,
    act: "went_wrong",
    offerEnd: false,
    atCap: false,
    branches: ids.map((clipId, i) => ({ scene: scene(i), clipId, failed: false })),
  };
}

const queued = (clipId: string, at: number, beat = 2): StoryEvent => ({
  type: "clip_queued",
  clip: { clipId, metadata: meta(beat, "STUB"), seconds: 5.875 },
  at,
});

describe("live queue view (driven only by FastH3 messages)", () => {
  it("front of the generation queue is building, the rest queued, playout ready", () => {
    const s = run([
      { type: "state_update", playoutCapacity: 4, generationCapacity: 8 },
      queued("a", 0),
      queued("b", 1),
      queued("c", 2),
      {
        type: "queue_update",
        generation: [{ clipId: "b" }, { clipId: "c" }],
        playout: [{ clipId: "a", ready: true }],
        at: 5,
      },
    ]);
    expect(s.clips.a!.state).toBe("ready");
    expect(s.clips.b!.state).toBe("building");
    expect(s.clips.c!.state).toBe("queued");
    expect(s.clips.a!.meta).toEqual({ beat: 2, choice: "STUB" });
  });

  it("records build time clip_queued -> clip_generated once per clip", () => {
    const s = run([
      queued("a", 1000),
      { type: "clip_generated", clip: { clipId: "a" }, at: 7200 },
      { type: "clip_generated", clip: { clipId: "a" }, at: 9000 },
    ]);
    expect(s.timings.buildMs).toEqual([6200]);
    expect(s.clips.a!.state).toBe("ready");
  });

  it("popped and played clips never come back to life from a late queue_update", () => {
    const s = run([
      queued("a", 0),
      { type: "clip_popped", clipId: "a" },
      { type: "queue_update", generation: [{ clipId: "a" }], playout: [], at: 1 },
    ]);
    expect(s.clips.a!.state).toBe("popped");
  });
});

describe("branch bookkeeping", () => {
  const base = run([
    queued("x", 0),
    queued("y", 1),
    queued("z", 2),
    {
      type: "queue_update",
      generation: [{ clipId: "y" }, { clipId: "z" }],
      playout: [{ clipId: "x" }],
      at: 3,
    },
  ]);
  const offer = offerWith(["x", "y", "z"]);

  it("pick a ready branch: no move, pop the other two", () => {
    expect(planPick(base, offer, "x")).toEqual([
      { name: "pop", clipId: "y" },
      { name: "pop", clipId: "z" },
    ]);
  });

  it("pick a branch still building: move it to the front, pop the rest", () => {
    expect(planPick(base, offer, "z")).toEqual([
      { name: "move", clipId: "z", position: 0 },
      { name: "pop", clipId: "x" },
      { name: "pop", clipId: "y" },
    ]);
  });

  it("free text pops every speculative branch; already-gone ones are skipped", () => {
    const s = storyReducer(base, { type: "clip_popped", clipId: "y" });
    expect(planCustom(s, offer)).toEqual([
      { name: "pop", clipId: "x" },
      { name: "pop", clipId: "z" },
    ]);
    expect(planCustom(s, null)).toEqual([]);
  });

  it("card readiness comes from the queue view", () => {
    expect(branchReadiness(base, offer.branches[0]!)).toBe("ready");
    expect(branchReadiness(base, offer.branches[1]!)).toBe("building");
    expect(branchReadiness(base, offer.branches[2]!)).toBe("queued");
    expect(branchReadiness(base, { scene: scene(9), clipId: null, failed: false })).toBe("sending");
    expect(branchReadiness(base, { scene: scene(9), clipId: null, failed: true })).toBe("failed");
  });

  it("pending pick plays only when built and the stage is free; latency is measured", () => {
    let s = run(
      [
        { type: "clip_started", clip: { clipId: "x" }, at: 10 },
        {
          type: "picked",
          beat: {
            ...scene(2),
            custom: false,
            clipId: "z",
            offered: ["STUB 0", "STUB 1", "STUB 2"],
          },
          pending: { clipId: "z", pickedAt: 100, wasReady: false, playSent: false, measure: true },
        },
      ],
      base,
    );
    expect(s.offer).toBeNull();
    expect(s.beats).toHaveLength(1);
    expect(shouldPlayPending(s)).toBeNull(); // x still playing, z not built
    s = run([{ type: "clip_finished", clipId: "x" }], s);
    expect(shouldPlayPending(s)).toBeNull(); // z not built
    s = run([{ type: "clip_generated", clip: { clipId: "z" }, at: 4000 }], s);
    expect(shouldPlayPending(s)).toBe("z");
    s = run([{ type: "play_sent" }], s);
    expect(shouldPlayPending(s)).toBeNull();
    s = run([{ type: "clip_started", clip: { clipId: "z" }, at: 4300 }], s);
    expect(s.pending).toBeNull();
    expect(s.timings.pickToStartBuildingMs).toEqual([4200]);
    expect(s.clips.z!.state).toBe("playing");
  });

  it("the opening scene is not counted as a pick", () => {
    const s = run(
      [
        {
          type: "picked",
          beat: { ...scene(0), custom: false, clipId: "x", offered: [] },
          pending: { clipId: "x", pickedAt: 0, wasReady: false, playSent: true, measure: false },
        },
        { type: "clip_started", clip: { clipId: "x" }, at: 500 },
      ],
      base,
    );
    expect(s.timings.pickToStartBuildingMs).toEqual([]);
    expect(s.timings.pickToStartReadyMs).toEqual([]);
  });

  it("branch_queued fills the clip id of the right card, or marks it failed", () => {
    let s = storyReducer(initialStoryState(), {
      type: "offer",
      offer: offerWith([null, null, null]),
    });
    s = storyReducer(s, { type: "branch_queued", beat: 2, index: 1, clipId: "q" });
    s = storyReducer(s, { type: "branch_queued", beat: 2, index: 2, clipId: null });
    s = storyReducer(s, { type: "branch_queued", beat: 3, index: 0, clipId: "stale" });
    expect(s.offer!.branches.map((b) => b.clipId)).toEqual([null, "q", null]);
    expect(s.offer!.branches[2]!.failed).toBe(true);
  });
});

describe("playedBeats (what the story sends)", () => {
  const beat = (clipId: string, n: number) => ({
    ...scene(n),
    custom: false,
    clipId,
    offered: [],
  });
  const pending = (clipId: string) => ({
    clipId,
    pickedAt: 0,
    wasReady: false,
    playSent: false,
    measure: true,
  });

  it("drops a pick that was still building when the story ended", () => {
    const s = run([
      queued("o", 0, 1),
      { type: "picked", beat: beat("o", 1), pending: pending("o") },
      { type: "clip_started", clip: { clipId: "o" }, at: 1 },
      { type: "clip_finished", clipId: "o" },
      queued("b", 2),
      { type: "picked", beat: beat("b", 2), pending: pending("b") },
    ]);
    expect(s.beats.map((b) => b.clipId)).toEqual(["o", "b"]);
    expect(playedBeats(s).map((b) => b.clipId)).toEqual(["o"]);
  });

  it("keeps the scene on stage when the story ended mid-scene", () => {
    const s = run([
      queued("o", 0, 1),
      { type: "picked", beat: beat("o", 1), pending: pending("o") },
      { type: "clip_started", clip: { clipId: "o" }, at: 1 },
    ]);
    expect(playedBeats(s).map((b) => b.clipId)).toEqual(["o"]);
  });

  it("is empty when the opening never reached the stage", () => {
    const s = run([
      queued("o", 0, 1),
      { type: "picked", beat: beat("o", 1), pending: pending("o") },
    ]);
    expect(playedBeats(s)).toEqual([]);
  });
});
