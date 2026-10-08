import { describe, expect, it } from "vitest";
import { SamPrep, prepStatusText, type PrepPortrait, type SamPrepDeps } from "./sam-prep";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(err: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const portrait = (source: "base" | "composite"): PrepPortrait => ({
  blob: new Blob(["x"]),
  source,
});

function harness(opts: {
  avatarId?: string | null;
  avatarSource?: "base" | "composite" | null;
  portraits?: Array<"base" | "composite">;
  build?: () => Promise<{ avatarId: string; avatarMs: number }>;
}) {
  const log: string[] = [];
  const signals: AbortSignal[] = [];
  const portraits = [...(opts.portraits ?? ["composite"])];
  let clock = 1000;
  let builds = 0;
  const deps: SamPrepDeps = {
    getBrief: async (id) => {
      log.push(`brief:${id}`);
      return {
        avatarId: opts.avatarId ?? null,
        avatarPortraitSource: opts.avatarSource ?? null,
      };
    },
    getPortrait: async () => {
      const source = portraits.length > 1 ? portraits.shift()! : portraits[0]!;
      log.push(`portrait:${source}`);
      return portrait(source);
    },
    buildAvatar: async (_id, p, signal) => {
      signals.push(signal);
      builds += 1;
      log.push(`build:${p.source}`);
      return opts.build ? opts.build() : { avatarId: `av_${builds}`, avatarMs: 20_000 };
    },
    saveAvatar: async (_id, avatarId, source) => {
      log.push(`save:${avatarId}:${source}`);
    },
    now: () => (clock += 1000),
    sleep: async (_ms, signal) => {
      if (signal.aborted) throw new Error("aborted");
    },
  };
  return { prep: new SamPrep(deps), log, signals };
}

describe("SamPrep", () => {
  it("builds and saves an avatar from the composite as soon as a ticket exists", async () => {
    const { prep, log } = harness({});
    prep.start("t1");
    expect(prep.current.phase).toBe("preparing");
    await flush();
    expect(log).toEqual([
      "brief:t1",
      "portrait:composite",
      "build:composite",
      "save:av_1:composite",
    ]);
    expect(prep.current.phase).toBe("ready");
    expect(prep.current.portraitSource).toBe("composite");
    expect(prep.current.avatarMs).toBe(20_000);
  });

  it("does not build again when the saved avatar matches the portrait", async () => {
    const { prep, log } = harness({ avatarId: "av_saved", avatarSource: "composite" });
    prep.start("t1");
    await flush();
    expect(log).toEqual(["brief:t1", "portrait:composite"]);
    expect(prep.current.phase).toBe("ready");
  });

  it("rebuilds when the saved avatar came from a different portrait", async () => {
    const { prep, log } = harness({ avatarId: "av_saved", avatarSource: "base" });
    prep.start("t1");
    await flush();
    expect(log).toContain("build:composite");
    expect(prep.current.phase).toBe("ready");
  });

  it("is single flight: never two prep sessions at once, on any ticket", async () => {
    const gate = deferred<{ avatarId: string; avatarMs: number }>();
    const { prep, log } = harness({ build: () => gate.promise });
    prep.start("t1");
    prep.start("t1");
    prep.start("t2");
    await flush();
    expect(log.filter((l) => l.startsWith("build"))).toHaveLength(1);
    expect(log).not.toContain("brief:t2");
    gate.resolve({ avatarId: "av_1", avatarMs: 1 });
    await flush();
    expect(prep.current.phase).toBe("ready");
    prep.start("t1");
    await flush();
    expect(log.filter((l) => l.startsWith("build"))).toHaveLength(1);
  });

  it("stops when a real call starts: aborts the session, saves nothing, never restarts", async () => {
    const gate = deferred<{ avatarId: string; avatarMs: number }>();
    const { prep, log, signals } = harness({ build: () => gate.promise });
    prep.start("t1");
    await flush();
    expect(prep.current.step).toBe("building");
    prep.stop("t1");
    expect(signals[0]?.aborted).toBe(true);
    expect(prep.current.phase).toBe("stopped");
    gate.resolve({ avatarId: "av_late", avatarMs: 1 });
    await flush();
    expect(log.some((l) => l.startsWith("save"))).toBe(false);
    prep.start("t1");
    await flush();
    expect(log.filter((l) => l.startsWith("brief"))).toHaveLength(1);
  });

  it("a call on another ticket also stops a running prep, which may restart later", async () => {
    const gate = deferred<{ avatarId: string; avatarMs: number }>();
    const { prep, log, signals } = harness({ build: () => gate.promise });
    prep.start("t1");
    await flush();
    prep.stop("t2");
    expect(signals[0]?.aborted).toBe(true);
    expect(prep.current.phase).toBe("stopped");
    gate.resolve({ avatarId: "av_late", avatarMs: 1 });
    await flush();
    prep.start("t2");
    expect(log.filter((l) => l.startsWith("brief"))).toEqual(["brief:t1"]);
    prep.start("t1");
    await flush();
    expect(log.filter((l) => l.startsWith("brief"))).toEqual(["brief:t1", "brief:t1"]);
  });

  it("rebuilds once when the composite lands after a base-portrait build", async () => {
    const { prep, log } = harness({ portraits: ["base", "base", "composite"] });
    prep.start("t1");
    await flush();
    await flush();
    expect(log).toEqual([
      "brief:t1",
      "portrait:base",
      "build:base",
      "save:av_1:base",
      "portrait:base",
      "portrait:composite",
      "build:composite",
      "save:av_2:composite",
    ]);
    expect(prep.current.phase).toBe("ready");
    expect(prep.current.portraitSource).toBe("composite");
  });

  it("reports a failure and lets Talk fall back to the normal path", async () => {
    const { prep } = harness({
      build: () => Promise.reject(new Error("The support agent could not start (X).")),
    });
    prep.start("t1");
    await flush();
    expect(prep.current.phase).toBe("failed");
    expect(prepStatusText(prep.current, 0, "Sam")).toMatch(/Talk still works/);
  });

  it("shows real elapsed time while building", () => {
    const text = prepStatusText(
      {
        ticketId: "t1",
        phase: "preparing",
        step: "building",
        startedAt: 1_000,
        readyAt: null,
        portraitSource: null,
        avatarMs: null,
        error: null,
      },
      24_500,
      "Sam",
    );
    expect(text).toBe("Preparing Sam on Reactor: building avatar (0:23)");
  });
});
