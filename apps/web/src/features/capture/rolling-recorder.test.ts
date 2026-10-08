import { describe, expect, it, vi } from "vitest";
import type { ClipWindowConfig } from "./clip-window";
import type { CanvasRecorder } from "./recorder";
import { RollingRecorder, type RollingDeps } from "./rolling-recorder";

const CFG: ClipWindowConfig = {
  recorders: 2,
  periodMs: 11_500,
  minClipMs: 5_000,
  maxClipMs: 12_000,
  stallMs: 2_000,
};

interface FakeRecorder extends CanvasRecorder {
  id: number;
  stopped: boolean;
  begin(at: number): void;
}

function harness() {
  let clock = 0;
  const recorders: FakeRecorder[] = [];
  const compositor = {
    canvas: {} as HTMLCanvasElement,
    start: vi.fn(),
    drawOutputFrame: vi.fn(),
    stop: vi.fn(),
  };
  const deps: RollingDeps = {
    compositor,
    now: () => clock,
    startRecorder: () => {
      let begin: (at: number) => void = () => undefined;
      const started = new Promise<number>((resolve) => {
        begin = resolve;
      });
      const rec: FakeRecorder = {
        id: recorders.length,
        stopped: false,
        mimeType: "video/webm;codecs=vp9",
        started,
        begin,
        stop: vi.fn(async () => {
          rec.stopped = true;
          return { blob: new Blob([`clip-${rec.id}`], { type: "video/webm" }), stoppedAt: clock };
        }),
      };
      recorders.push(rec);
      return rec;
    },
  };
  // `started` resolves -> its then() callback runs: two microtask turns, no timer needed.
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  /** Advance the clock, starting pending recorders 20 ms after creation and drawing frames. */
  async function run(r: RollingRecorder, to: number) {
    while (clock < to) {
      clock = Math.min(to, clock + 50);
      r.tick();
      for (const rec of recorders) rec.begin(clock); // resolves once; later calls are no-ops
      await flush();
      r.frame(clock);
    }
  }
  return {
    deps,
    compositor,
    recorders,
    run,
    flush,
    setClock: (t: number) => {
      clock = t;
    },
  };
}

describe("RollingRecorder", () => {
  it("paints output into the recording canvas and starts the first recorder at once", async () => {
    const h = harness();
    const r = new RollingRecorder(h.deps, "video/webm;codecs=vp9", 0, CFG);
    expect(h.compositor.start).toHaveBeenCalledTimes(1);
    expect(h.compositor.drawOutputFrame).toHaveBeenCalledTimes(1);
    expect(h.recorders).toHaveLength(1);
    r.frame(10);
    expect(h.compositor.drawOutputFrame).toHaveBeenCalledTimes(2);
    r.dispose();
  });

  it("keeps two staggered recorders rolling and discards the expired segment", async () => {
    const h = harness();
    const r = new RollingRecorder(h.deps, "video/webm;codecs=vp9", 0, CFG);
    await h.run(r, 5_800);
    expect(h.recorders).toHaveLength(2);
    await h.run(r, 11_550);
    expect(h.recorders).toHaveLength(3);
    expect(h.recorders[0]!.stopped).toBe(true); // replaced at 11.5 s, its blob dropped
    expect(h.recorders[1]!.stopped).toBe(false);
    r.dispose();
  });

  it("clip() is null while warming and touches no recorder", async () => {
    const h = harness();
    const r = new RollingRecorder(h.deps, "video/webm;codecs=vp9", 0, CFG);
    await h.run(r, 3_000);
    expect(r.availability().kind).toBe("warming");
    expect(await r.clip()).toBeNull();
    expect(h.recorders.every((rec) => !rec.stopped)).toBe(true);
    r.dispose();
  });

  it("clip() saves the longest segment ending now and keeps recording", async () => {
    const h = harness();
    const r = new RollingRecorder(h.deps, "video/webm;codecs=vp9", 0, CFG);
    await h.run(r, 15_000);
    expect(r.availability()).toMatchObject({ kind: "ready", slot: 1 });
    const saved = await r.clip();
    expect(saved).not.toBeNull();
    expect(await saved!.blob.text()).toBe("clip-1");
    expect(saved!.mimeType).toBe("video/webm;codecs=vp9");
    // Recorder 1 started at 5.75 s and the first fresh frame was drawn in that same step.
    expect(saved!.firstOutputOffsetMs).toBe(0);
    expect(saved!.recordedDurationMs).toBe(15_000 - 5_750);
    // The clipped slot restarted at once; nothing else was stopped.
    expect(h.recorders).toHaveLength(4);
    expect(h.recorders[2]!.stopped).toBe(false);
    expect(h.recorders[3]!.stopped).toBe(false);
    r.dispose();
  });

  it("dispose() stops the compositor and every recorder; later calls do nothing", async () => {
    const h = harness();
    const r = new RollingRecorder(h.deps, "video/webm;codecs=vp9", 0, CFG);
    await h.run(r, 6_000);
    r.dispose();
    expect(h.compositor.stop).toHaveBeenCalledTimes(1);
    expect(h.recorders.every((rec) => rec.stopped)).toBe(true);
    const count = h.recorders.length;
    r.tick();
    r.frame(7_000);
    expect(await r.clip()).toBeNull();
    expect(h.recorders).toHaveLength(count);
    r.dispose();
    expect(h.compositor.stop).toHaveBeenCalledTimes(1);
  });

  it("a recorder that fails to start leaves its slot empty until the next restart", async () => {
    const h = harness();
    let fail = true;
    const startRecorder = h.deps.startRecorder;
    h.deps.startRecorder = (canvas, mime) => {
      if (fail) {
        fail = false;
        throw new Error("NotSupportedError");
      }
      return startRecorder(canvas, mime);
    };
    const r = new RollingRecorder(h.deps, "video/webm;codecs=vp9", 0, CFG);
    expect(h.recorders).toHaveLength(0);
    await h.run(r, 11_000);
    expect(r.availability()).toMatchObject({ kind: "ready", slot: 1 });
    r.dispose();
  });
});
