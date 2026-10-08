import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreshFrame, X2Preview } from "@/features/preview/x2-preview";

const h = vi.hoisted(() => {
  const log: string[] = [];
  const compositor = { drawOutputFrame: vi.fn(), start: vi.fn(), stop: vi.fn() };
  const recorder = { stop: vi.fn() };
  return { log, compositor, recorder };
});

vi.mock("./compositor", () => ({
  RecordingCompositor: class {
    canvas = {};
    start = () => {
      h.log.push("compositor.start");
      h.compositor.start();
    };
    drawOutputFrame = () => h.compositor.drawOutputFrame();
    stop = () => h.compositor.stop();
  },
}));

vi.mock("./recorder", () => ({
  startCanvasRecorder: () => {
    h.log.push("recorder.start");
    const startedAt = performance.now();
    return {
      mimeType: "video/webm;codecs=vp9",
      started: Promise.resolve(startedAt),
      stop: async () => {
        h.log.push("recorder.stop");
        h.recorder.stop();
        return { blob: new Blob(["x"], { type: "video/webm" }), stoppedAt: performance.now() };
      },
    };
  },
}));

const { TakeCapture } = await import("./take-capture");
const { PreviewFailure } = await import("@/features/preview/x2-preview");

type Handler = (payload: never) => void;

/** Minimal stand-in for X2Preview: records call order, lets the test emit frames. */
class FakePreview {
  currentRunId = 0;
  rejectPrompt = false;
  private handlers = new Map<string, Set<Handler>>();
  on(event: string, fn: Handler) {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(fn);
    this.handlers.set(event, set);
    return () => set.delete(fn);
  }
  emit(event: string, payload: unknown) {
    for (const fn of this.handlers.get(event) ?? []) (fn as (p: unknown) => void)(payload);
  }
  listenerCount() {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
  reset = vi.fn(async () => {
    h.log.push("reset");
  });
  prepareRun = vi.fn(async () => {
    h.log.push("prepareRun");
  });
  fire = vi.fn(async () => {
    h.log.push("fire");
    if (this.rejectPrompt) throw new PreviewFailure("invalid_command", "prompt");
    this.currentRunId += 1;
    return this.currentRunId;
  });
  frame(runId: number, firstOfRun = false) {
    const f: FreshFrame = {
      runId,
      firstOfRun,
      mediaTime: performance.now(),
      at: performance.now(),
    };
    this.emit("frame", f);
  }
}

function setup() {
  const preview = new FakePreview();
  const phases: string[] = [];
  const capture = new TakeCapture({
    preview: preview as unknown as X2Preview,
    video: {} as HTMLVideoElement,
    still: {} as ImageBitmap,
    referenceBlob: new Blob(["ref"], { type: "image/jpeg" }),
    prompt: "the robot vacuum moves backward once",
    labels: {
      purposeLabel: "AI-generated reenactment",
      caption: "Moves backward once",
      productLabel: "Robot vacuum",
      generatedConcept: false,
    },
    mimeType: "video/webm;codecs=vp9",
    onPhase: (p) => phases.push(p),
    onProgress: () => undefined,
  });
  return { preview, phases, capture };
}

describe("TakeCapture (spec 12 Record next take)", () => {
  beforeEach(() => {
    h.log.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms the recorder BEFORE sending the action prompt, then keeps 8 s of fresh output", async () => {
    const { preview, phases, capture } = setup();
    const done = capture.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.log).toEqual(["compositor.start", "reset", "prepareRun", "recorder.start", "fire"]);
    expect(phases).toEqual(["armed", "recording"]);

    // Stale output (not attributable to the new run) is never drawn.
    preview.frame(0);
    expect(h.compositor.drawOutputFrame).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    preview.frame(1, true);
    expect(h.compositor.drawOutputFrame).toHaveBeenCalledTimes(1);
    for (let t = 0; t < 8_200; t += 55) {
      await vi.advanceTimersByTimeAsync(55);
      preview.frame(1);
    }
    const result = await done;
    expect(result).toMatchObject({
      kind: "recorded",
      mimeType: "video/webm;codecs=vp9",
      outcome: { status: "complete", reason: null, endedBy: "target" },
      firstOutputOffsetMs: 400,
    });
    if (result.kind !== "recorded") throw new Error("unreachable");
    expect(result.recordedDurationMs).toBeGreaterThanOrEqual(8_400);
    expect(result.recordedDurationMs).toBeLessThan(8_600);
    expect(h.log.at(-1)).toBe("recorder.stop");
    expect(h.compositor.stop).toHaveBeenCalled();
    expect(preview.listenerCount()).toBe(0);
  });

  it("persists an incomplete output_timeout when no fresh output arrives in 20 s", async () => {
    const { capture } = setup();
    const done = capture.run();
    await vi.advanceTimersByTimeAsync(20_100);
    await expect(done).resolves.toMatchObject({
      kind: "recorded",
      outcome: { status: "incomplete", reason: "output_timeout" },
      firstOutputOffsetMs: null,
    });
  });

  it("an ended output track yields an incomplete disconnected take", async () => {
    const { preview, capture } = setup();
    const done = capture.run();
    await vi.advanceTimersByTimeAsync(300);
    preview.frame(1, true);
    await vi.advanceTimersByTimeAsync(100);
    preview.emit("outputEnded", null);
    await expect(done).resolves.toMatchObject({
      outcome: { status: "incomplete", reason: "disconnected" },
      firstOutputOffsetMs: 300,
    });
  });

  it("early stop is refused before 4 s of output and accepted after", async () => {
    const { preview, capture } = setup();
    const done = capture.run();
    await vi.advanceTimersByTimeAsync(0);
    preview.frame(1, true);
    for (let t = 0; t < 3_000; t += 55) {
      await vi.advanceTimersByTimeAsync(55);
      preview.frame(1);
    }
    expect(capture.stopEarly()).toBe(false);
    for (let t = 0; t < 1_100; t += 55) {
      await vi.advanceTimersByTimeAsync(55);
      preview.frame(1);
    }
    expect(capture.stopEarly()).toBe(true);
    await expect(done).resolves.toMatchObject({
      outcome: { status: "complete", endedBy: "early_stop" },
    });
  });

  it("cancel while armed never sends the prompt", async () => {
    const { preview, capture } = setup();
    let release: () => void = () => undefined;
    preview.prepareRun.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const done = capture.run();
    await vi.advanceTimersByTimeAsync(0);
    capture.cancel();
    release();
    await expect(done).resolves.toEqual({ kind: "cancelled" });
    expect(preview.fire).not.toHaveBeenCalled();
  });

  it("a rejected prompt stops the recorder and surfaces the provider failure", async () => {
    const { preview, capture } = setup();
    preview.rejectPrompt = true;
    const done = capture.run();
    const assertion = expect(done).rejects.toMatchObject({ code: "invalid_command" });
    await vi.advanceTimersByTimeAsync(0);
    await assertion;
    expect(h.recorder.stop).toHaveBeenCalled();
    expect(preview.listenerCount()).toBe(0);
  });
});
