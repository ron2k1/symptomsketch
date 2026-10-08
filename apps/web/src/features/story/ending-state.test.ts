import { describe, expect, it, vi } from "vitest";
import type { StoryEndingResponse, StoryTokenResponse } from "@symptomsketch/contracts";
import {
  EndingLaunchError,
  endingComplete,
  endingReducer,
  failedScene,
  initialEndingState,
  launchEnding,
  nextEndingClip,
  playingScene,
  type EndingEvent,
  type EndingSession,
  type EndingState,
} from "./ending-state";
import { ReactorError } from "@reactor-team/js-sdk";
import { reactorFailure, type EnqueueParams } from "./fast-h3";

// Labeled stubs only (test fixtures, never shown by the live app).
const scene = (n: number) => ({
  label: `STUB fix ${n}`,
  caption: `STUB caption ${n}`,
  prompt: `STUB ending prompt ${n}`,
});
const TOKEN: StoryTokenResponse = {
  jwt: "stub.jwt",
  expiresAt: "2026-10-08T17:00:00.000Z",
  modelName: "reactor/fast-h3",
  clipSeconds: 5.875,
  sessionMaxSeconds: 300,
};
const ENDING = (n: number): StoryEndingResponse => ({
  scenes: Array.from({ length: n }, (_, i) => scene(i + 1)),
  modelId: "stub-model",
  latencyMs: 1234,
});

const run = (events: EndingEvent[], s: EndingState = initialEndingState()) =>
  events.reduce(endingReducer, s);
const queued = (clipId: string, n: number): EndingEvent => ({
  type: "queued",
  clipId,
  scene: scene(n),
  at: n,
});

describe("ending order (driven only by FastH3 clip events)", () => {
  it("plays scene 1 once built, then scene 2 only after scene 1 finished", () => {
    let s = run([queued("c1", 1), queued("c2", 2)]);
    expect(nextEndingClip(s)).toBeNull();
    s = run([{ type: "ready", clipIds: ["c2"], at: 3 }], s);
    expect(nextEndingClip(s)).toBeNull(); // scene 2 is built first, but scene 1 goes first
    s = run([{ type: "ready", clipIds: ["c1"], at: 4 }], s);
    expect(nextEndingClip(s)).toBe("c1");
    s = run([{ type: "play_sent", clipId: "c1" }], s);
    expect(nextEndingClip(s)).toBeNull(); // no double play
    s = run([{ type: "started", clipId: "c1" }], s);
    expect(playingScene(s)?.index).toBe(0);
    expect(nextEndingClip(s)).toBeNull(); // stage busy
    s = run([{ type: "finished", clipId: "c1" }], s);
    expect(nextEndingClip(s)).toBe("c2");
    s = run(
      [
        { type: "play_sent", clipId: "c2" },
        { type: "started", clipId: "c2" },
      ],
      s,
    );
    expect(endingComplete(s, 2)).toBe(false);
    s = run([{ type: "finished", clipId: null }], s);
    expect(endingComplete(s, 2)).toBe(true);
    expect(nextEndingClip(s)).toBeNull();
  });

  it("keeps a built report that lands before the enqueue reply", () => {
    const s = run([{ type: "ready", clipIds: ["c1"], at: 1 }, queued("c1", 1)]);
    expect(s.clips[0]!.state).toBe("ready");
    expect(s.early).toEqual([]);
    expect(nextEndingClip(s)).toBe("c1");
  });

  it("a new clip on stage settles the previous one; a failed scene is reported", () => {
    let s = run([
      queued("c1", 1),
      queued("c2", 2),
      { type: "ready", clipIds: ["c1", "c2"], at: 3 },
      { type: "started", clipId: "c1" },
      { type: "started", clipId: "c2" },
    ]);
    expect(s.clips.map((c) => c.state)).toEqual(["played", "playing"]);
    s = run([{ type: "failed", clipId: "c2" }], s);
    expect(failedScene(s)).toBe(2);
    expect(endingComplete(s, 2)).toBe(false);
  });

  it("is not complete until every expected scene was queued", () => {
    const s = run([
      queued("c1", 1),
      { type: "ready", clipIds: ["c1"], at: 2 },
      { type: "started", clipId: "c1" },
      { type: "finished", clipId: "c1" },
    ]);
    expect(endingComplete(s, 2)).toBe(false);
    expect(endingComplete(s, 1)).toBe(true);
    expect(endingComplete(initialEndingState(), 0)).toBe(false);
  });
});

function stubSession(replies: Array<string | null>) {
  const calls: string[] = [];
  const enqueued: EnqueueParams[] = [];
  const session: EndingSession = {
    connect: vi.fn(async (jwt: string) => {
      calls.push(`connect:${jwt}`);
    }),
    configure: vi.fn(async (seconds: number) => {
      calls.push(`configure:${seconds}`);
    }),
    uploadFile: vi.fn(async (blob: Blob) => {
      calls.push(`upload:${blob.size}`);
      return { id: "stub-file-ref" } as never;
    }),
    enqueue: vi.fn(async (p: EnqueueParams) => {
      enqueued.push(p);
      const id = replies.shift() ?? null;
      return id ? { clipId: id } : null;
    }),
  };
  return { session, calls, enqueued };
}

describe("launchEnding (the live sequence, with stub API and session)", () => {
  it("scene 1 starts from the uploaded last frame; scene 2 continues from scene 1", async () => {
    const { session, calls, enqueued } = stubSession(["c1", "c2"]);
    const frame = new Blob(["STUB frame bytes"], { type: "image/png" });
    const queuedIds: string[] = [];
    const out = await launchEnding(
      {
        write: async () => ENDING(2),
        token: async () => TOKEN,
        frame: async () => frame,
      },
      session,
      { queued: (id) => queuedIds.push(id) },
    );
    expect(calls).toEqual(["connect:stub.jwt", "configure:5.875", `upload:${frame.size}`]);
    expect(enqueued).toHaveLength(2);
    expect(enqueued[0]!.startingFrame).toEqual({ id: "stub-file-ref" });
    expect(enqueued[0]!.continueFromClipId).toBeUndefined();
    expect(enqueued[1]!.startingFrame).toBeUndefined();
    expect(enqueued[1]!.continueFromClipId).toBe("c1");
    expect(enqueued.map((p) => p.prompt)).toEqual(["STUB ending prompt 1", "STUB ending prompt 2"]);
    expect(enqueued[0]!.seconds).toBe(5.875);
    expect(JSON.parse(enqueued[1]!.metadata)).toEqual({ ending: 2, choice: "STUB fix 2" });
    expect(queuedIds).toEqual(["c1", "c2"]);
    expect(out.scenes).toHaveLength(2);
  });

  it("writes the scenes while the session connects (both start before either finishes)", async () => {
    const { session } = stubSession(["c1"]);
    const order: string[] = [];
    let releaseWrite: () => void = () => undefined;
    const p = launchEnding(
      {
        write: () => {
          order.push("write");
          return new Promise((r) => (releaseWrite = () => r(ENDING(1))));
        },
        token: async () => {
          order.push("token");
          return TOKEN;
        },
        frame: async () => new Blob(["STUB"]),
      },
      session,
    );
    await vi.waitFor(() => expect(session.uploadFile).toHaveBeenCalled());
    expect(order).toEqual(["token", "write"]);
    expect(session.enqueue).not.toHaveBeenCalled();
    releaseWrite();
    await p;
    expect(session.enqueue).toHaveBeenCalledTimes(1);
  });

  it("a director failure enqueues nothing; a refused enqueue rejects", async () => {
    const a = stubSession(["c1"]);
    await expect(
      launchEnding(
        {
          write: async () => {
            throw new Error("STUB 502");
          },
          token: async () => TOKEN,
          frame: async () => new Blob(["STUB"]),
        },
        a.session,
      ),
    ).rejects.toThrow("STUB 502");
    expect(a.session.enqueue).not.toHaveBeenCalled();

    const b = stubSession([null]);
    await expect(
      launchEnding(
        { write: async () => ENDING(2), token: async () => TOKEN, frame: async () => new Blob([]) },
        b.session,
      ),
    ).rejects.toBeInstanceOf(EndingLaunchError);
    expect(b.enqueued).toHaveLength(1);
  });
});

describe("reactorFailure (SDK errors shown by code, never by provider message)", () => {
  it("names a rate limit plainly and other failures by step and code", () => {
    const limited = new ReactorError("STUB provider text", {
      code: "RATE_LIMITED",
      operation: "connect",
    });
    expect(reactorFailure(limited)).toMatch(/busy right now/);
    const other = new ReactorError("STUB provider text", {
      code: "TRANSPORT",
      operation: "connect",
    });
    expect(reactorFailure(other)).toBe(
      "The FastH3 connect step failed (TRANSPORT). Retry in a moment.",
    );
    expect(reactorFailure(other)).not.toContain("STUB provider text");
    expect(reactorFailure(new Error("x"))).toBeNull();
  });
});
