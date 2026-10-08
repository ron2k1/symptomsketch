import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRevision, ReactorTokenResponse } from "@symptomsketch/contracts";

const h = vi.hoisted(() => {
  type Fn = (payload: unknown) => void;
  const instances: FakePreview[] = [];
  /** Stand-in for X2Preview: same public surface the controller uses, no network or wasm. */
  class FakePreview {
    lastMediaTime = -1;
    isClosed = false;
    currentRunId = 0;
    motionProgram: unknown = null;
    private handlers = new Map<string, Set<Fn>>();
    connect = vi.fn(async () => undefined);
    prepareRun = vi.fn(async () => undefined);
    fire = vi.fn(async () => ++this.currentRunId);
    restartRun = vi.fn(async (_reference: Blob, _prompt: string) => ++this.currentRunId);
    correct = vi.fn(async (_prompt: string, _action?: unknown) => true);
    close = vi.fn(async () => {
      this.isClosed = true;
    });
    constructor() {
      instances.push(this);
    }
    on(event: string, fn: Fn) {
      const set = this.handlers.get(event) ?? new Set<Fn>();
      set.add(fn);
      this.handlers.set(event, set);
      return () => set.delete(fn);
    }
    emit(event: string, payload: unknown) {
      for (const fn of this.handlers.get(event) ?? []) fn(payload);
    }
    frame(mediaTime: number, firstOfRun = false) {
      this.lastMediaTime = mediaTime;
      this.emit("frame", {
        runId: this.currentRunId,
        firstOfRun,
        mediaTime,
        at: performance.now(),
      });
    }
  }
  return {
    instances,
    FakePreview,
    createReactorToken: vi.fn(),
    heartbeatLease: vi.fn(async () => "ok"),
    releaseLease: vi.fn(),
    loadReference: vi.fn(async () => ({
      blob: new Blob(["ref"], { type: "image/jpeg" }),
      still: {} as ImageBitmap,
    })),
  };
});

vi.mock("./x2-preview", async (orig) => ({
  ...(await orig<typeof import("./x2-preview")>()),
  X2Preview: h.FakePreview,
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  createReactorToken: h.createReactorToken,
}));
vi.mock("./lease", () => ({
  heartbeatLease: h.heartbeatLease,
  releaseLease: h.releaseLease,
  releaseLeaseKeepalive: vi.fn(),
  loadReference: h.loadReference,
}));

const { PreviewController } = await import("./preview-controller");
const { STAGE_ERRORS, STOP_NOTICES } = await import("./preview-errors");
const { LIVE_COPY } = await import("./live-policy");
const { EMPTY_STATS } = await import("./x2-stats");
const { ApiClientError } = await import("@/lib/api");

function plan(id: string, prompt: string): PlanRevision {
  return {
    id,
    status: "ready",
    reactorPrompt: prompt,
    caption: "Moves backward once",
    purpose: "problem",
    productRevisionId: "prod_1",
    procedureRevisionId: null,
  } as unknown as PlanRevision;
}

const TOKEN: ReactorTokenResponse = {
  jwt: "test-jwt-not-real",
  expiresAt: null,
  leaseId: "lease_1",
  leaseExpiresAt: "2026-10-08T12:00:00.000Z",
  reactorPrompt: "server compiled prompt one",
};

const video = {} as HTMLVideoElement;
const MIN = 60_000;

async function startLive() {
  const views: Array<{ status: string }> = [];
  const c = new PreviewController((v) => views.push(v));
  c.setProps({ caseId: "case_1", plan: plan("plan_1", "prompt one"), referenceImageUrl: "/ref" });
  await c.start(video);
  const preview = h.instances.at(-1)!;
  preview.frame(1, true);
  return { c, preview, views };
}

describe("PreviewController (infinite live preview)", () => {
  beforeEach(() => {
    h.instances.length = 0;
    vi.clearAllMocks();
    h.createReactorToken.mockResolvedValue(TOKEN);
    h.heartbeatLease.mockResolvedValue("ok");
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing until start(); then token -> connect -> reference -> prompt -> live", async () => {
    const c = new PreviewController(() => undefined);
    c.setProps({ caseId: "case_1", plan: plan("plan_1", "prompt one"), referenceImageUrl: "/ref" });
    expect(h.createReactorToken).not.toHaveBeenCalled();
    expect(h.instances).toHaveLength(0);

    await c.start(video);
    expect(h.createReactorToken).toHaveBeenCalledWith(
      "case_1",
      expect.objectContaining({ planRevisionId: "plan_1" }),
    );
    const preview = h.instances[0]!;
    // No selectedAction on this plan: null -> static still (no motion sketch).
    expect(preview.connect).toHaveBeenCalledWith(
      "test-jwt-not-real",
      expect.anything(),
      null,
      "problem",
    );
    expect(preview.prepareRun).toHaveBeenCalledTimes(1);
    expect(preview.fire).toHaveBeenCalledWith("server compiled prompt one");
    expect(c.current).toMatchObject({
      status: "waiting_frames",
      activePlanId: "plan_1",
      outputSince: null,
    });
    expect(c.current.startedAt).not.toBeNull();

    preview.frame(0.04, true);
    expect(c.current.status).toBe("live");
    expect(c.current.outputSince).toBe(performance.now());
  });

  it("hands plan.selectedAction + purpose to connect and the action to every correction", async () => {
    const action = (direction: string) => ({
      subject: "robot vacuum",
      startingState: "still",
      action: "moves",
      direction,
      repetitions: 1,
      timing: null,
      magnitude: null,
      endingState: "stopped",
    });
    const withAction = (id: string, prompt: string, direction: string) =>
      ({
        ...plan(id, prompt),
        purpose: "solution", // a support demonstration sizes the sketch differently
        plan: { selectedAction: action(direction) },
      }) as PlanRevision;
    const c = new PreviewController(() => undefined);
    c.setProps({
      caseId: "case_1",
      plan: withAction("plan_1", "prompt one", "backward"),
      referenceImageUrl: "/ref",
    });
    await c.start(video);
    const preview = h.instances[0]!;
    expect(preview.connect).toHaveBeenCalledWith(
      "test-jwt-not-real",
      expect.anything(),
      action("backward"),
      "solution",
    );
    preview.frame(1, true);
    c.setProps({
      caseId: "case_1",
      plan: withAction("plan_2", "prompt two", "left"),
      referenceImageUrl: "/ref",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(preview.correct).toHaveBeenCalledWith("prompt two", action("left"));
  });

  it("serializes prompt updates: newest wins, live again only after a fresh frame", async () => {
    const { c, preview } = await startLive();
    let ack: (ok: boolean) => void = () => undefined;
    preview.correct.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          ack = resolve;
        }),
    );
    c.setProps({ caseId: "case_1", plan: plan("plan_2", "prompt two"), referenceImageUrl: "/ref" });
    expect(c.current.status).toBe("updating");
    c.setProps({
      caseId: "case_1",
      plan: plan("plan_3", "prompt three"),
      referenceImageUrl: "/ref",
    });
    expect(preview.correct).toHaveBeenCalledTimes(1); // one in flight

    ack(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(preview.correct.mock.calls.map((call) => call[0])).toEqual([
      "prompt two",
      "prompt three",
    ]);
    expect(c.current).toMatchObject({ status: "updating", activePlanId: "plan_3" });

    preview.frame(preview.lastMediaTime); // re-presented frame: not fresh
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current.status).toBe("updating");
    preview.frame(preview.lastMediaTime + 0.05);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current.status).toBe("live");
  });

  it("a declined update keeps the old plan active and says so", async () => {
    const { c, preview } = await startLive();
    const since = c.current.outputSince;
    preview.correct.mockResolvedValueOnce(false);
    c.setProps({ caseId: "case_1", plan: plan("plan_2", "prompt two"), referenceImageUrl: "/ref" });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current.status).toBe("live");
    expect(c.current.activePlanId).toBe("plan_1");
    expect(c.current.outputSince).toBe(since);
    expect(c.current.notice).toMatch(/did not accept/);
  });

  it("marks when current-plan output began and relays fresh frames to clip capture", async () => {
    const { c, preview } = await startLive();
    const seen: number[] = [];
    const off = c.onFrame((f) => seen.push(f.mediaTime));
    expect(c.current.outputSince).not.toBeNull();

    c.setProps({ caseId: "case_1", plan: plan("plan_2", "prompt two"), referenceImageUrl: "/ref" });
    await vi.advanceTimersByTimeAsync(0);
    // The applied correction starts a new clip epoch: older footage shows the previous plan.
    expect(c.current).toMatchObject({ activePlanId: "plan_2", outputSince: null });
    await vi.advanceTimersByTimeAsync(500);
    preview.frame(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current.status).toBe("live");
    preview.frame(3);
    expect(c.current.outputSince).toBe(performance.now());
    off();
    preview.frame(4);
    expect(seen).toEqual([2, 3]);
  });

  it("publishes measured link stats and the prompt ack time, cleared on stop", async () => {
    const { c, preview } = await startLive();
    preview.emit("stats", { fps: 24, rttMs: 40, connectMs: 2_100 });
    preview.emit("promptAck", { ms: 120 });
    expect(c.current.stats).toEqual({ fps: 24, rttMs: 40, connectMs: 2_100, appliedMs: 120 });
    await c.stop("user");
    expect(c.current.stats).toEqual(EMPTY_STATS);
  });

  it("heartbeats every 10 s and stops when the lease is lost", async () => {
    const { c, preview } = await startLive();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.heartbeatLease).toHaveBeenCalledWith("case_1", "lease_1");
    h.heartbeatLease.mockResolvedValueOnce("lost");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(preview.close).toHaveBeenCalled();
    expect(h.releaseLease).toHaveBeenCalledWith("case_1", "lease_1");
    expect(c.current).toMatchObject({ status: "idle", notice: STOP_NOTICES.lease });
  });

  it("never stops a visible preview for inactivity and rotates to a fresh token before the lease cap", async () => {
    const { c, preview } = await startLive();
    await vi.advanceTimersByTimeAsync(4 * MIN);
    expect(preview.close).not.toHaveBeenCalled();
    expect(c.current.status).toBe("live");

    h.createReactorToken.mockResolvedValueOnce({ ...TOKEN, leaseId: "lease_2" });
    await vi.advanceTimersByTimeAsync(41_000); // past 4:40
    expect(preview.close).toHaveBeenCalledTimes(1);
    expect(h.releaseLease).toHaveBeenCalledWith("case_1", "lease_1");
    expect(h.createReactorToken).toHaveBeenCalledTimes(2);
    const next = h.instances.at(-1)!;
    expect(next).not.toBe(preview);
    expect(next.fire).toHaveBeenCalledWith("server compiled prompt one");
    expect(c.current).toMatchObject({
      status: "waiting_frames",
      reconnecting: true,
      activePlanId: "plan_1",
      outputSince: null,
    });
    next.frame(1, true);
    expect(c.current).toMatchObject({ status: "live", reconnecting: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.heartbeatLease).toHaveBeenLastCalledWith("case_1", "lease_2");
    // And again 4:40 into the new connection: generation never ends on its own.
    await vi.advanceTimersByTimeAsync(4 * MIN + 31_000);
    expect(h.createReactorToken).toHaveBeenCalledTimes(3);
  });

  it("reconnects automatically after a provider drop and reapplies the current plan", async () => {
    const { c, preview } = await startLive();
    c.setProps({ caseId: "case_1", plan: plan("plan_2", "prompt two"), referenceImageUrl: "/ref" });
    await vi.advanceTimersByTimeAsync(0);
    preview.frame(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current.activePlanId).toBe("plan_2");

    h.createReactorToken.mockResolvedValueOnce({
      ...TOKEN,
      leaseId: "lease_2",
      reactorPrompt: "server compiled prompt two",
    });
    preview.emit("status", "disconnected");
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current).toMatchObject({ status: "connecting", reconnecting: true, error: null });
    expect(preview.close).toHaveBeenCalled();
    expect(h.releaseLease).toHaveBeenCalledWith("case_1", "lease_1");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.createReactorToken).toHaveBeenLastCalledWith(
      "case_1",
      expect.objectContaining({ planRevisionId: "plan_2" }),
    );
    const next = h.instances.at(-1)!;
    expect(next.fire).toHaveBeenCalledWith("server compiled prompt two");
    next.frame(1, true);
    expect(c.current).toMatchObject({
      status: "live",
      reconnecting: false,
      activePlanId: "plan_2",
    });
  });

  it("gives up with an honest error after repeated drops without stable output", async () => {
    const { c } = await startLive();
    for (let i = 0; i < 3; i += 1) {
      h.instances.at(-1)!.emit("outputEnded", null);
      await vi.advanceTimersByTimeAsync(9_000); // backoff 1 s, 3 s, 8 s
      h.instances.at(-1)!.frame(1, true);
    }
    expect(h.instances).toHaveLength(4);
    const last = h.instances.at(-1)!;
    last.emit("status", "disconnected");
    await vi.advanceTimersByTimeAsync(0);
    expect(last.close).toHaveBeenCalled();
    expect(c.current).toMatchObject({ status: "error", error: STAGE_ERRORS.disconnected });
  });

  it("forgets earlier drops once output has been stable for 30 s", async () => {
    await startLive();
    for (let i = 0; i < 3; i += 1) {
      h.instances.at(-1)!.emit("outputEnded", null);
      await vi.advanceTimersByTimeAsync(9_000);
      h.instances.at(-1)!.frame(1, true);
    }
    await vi.advanceTimersByTimeAsync(31_000);
    h.instances.at(-1)!.emit("outputEnded", null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.instances).toHaveLength(5);
  });

  it("stops after 2 minutes in a hidden tab; returning to the tab resets that clock", async () => {
    const { c, preview } = await startLive();
    c.setHidden(true);
    await vi.advanceTimersByTimeAsync(MIN);
    c.setHidden(false);
    c.setHidden(true);
    await vi.advanceTimersByTimeAsync(2 * MIN - 2_000);
    expect(preview.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(preview.close).toHaveBeenCalled();
    expect(c.current).toMatchObject({ status: "idle", notice: LIVE_COPY.hiddenStop });
    // No reconnect afterwards: a hidden-tab stop needs an explicit Start.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.createReactorToken).toHaveBeenCalledTimes(1);
  });

  it("Replay movement replays the sketch through the correction path on the same session", async () => {
    const { c, preview } = await startLive();
    preview.motionProgram = { steps: [] }; // a motion sketch drives this plan
    const since = c.current.outputSince;
    c.replayMovement();
    await vi.advanceTimersByTimeAsync(0);
    expect(preview.correct).toHaveBeenCalledWith("server compiled prompt one", null);
    expect(c.current.status).toBe("updating");
    preview.frame(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current).toMatchObject({ status: "live", activePlanId: "plan_1", outputSince: since });
    expect(h.createReactorToken).toHaveBeenCalledTimes(1);
    expect(preview.close).not.toHaveBeenCalled();
  });

  it("Replay movement on a static still restarts the run on the same connection", async () => {
    const { c, preview } = await startLive();
    c.replayMovement();
    await vi.advanceTimersByTimeAsync(0);
    expect(preview.restartRun).toHaveBeenCalledWith(expect.any(Blob), "server compiled prompt one");
    expect(c.current).toMatchObject({ status: "updating", outputSince: null });
    preview.frame(2, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current.status).toBe("live");
    preview.frame(3);
    expect(c.current.outputSince).toBe(performance.now());
    expect(h.createReactorToken).toHaveBeenCalledTimes(1);
    expect(preview.close).not.toHaveBeenCalled();
  });

  it("a moderation terminate ends the preview instead of reconnecting", async () => {
    const { c, preview } = await startLive();
    preview.emit("moderation", "terminate");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(preview.close).toHaveBeenCalled();
    expect(h.createReactorToken).toHaveBeenCalledTimes(1);
    expect(c.current).toMatchObject({ status: "error", error: STAGE_ERRORS.moderated });
  });

  it("token errors show the server copy and create no X2 session", async () => {
    h.createReactorToken.mockRejectedValueOnce(
      new ApiClientError("CAPACITY_FULL", "The demo is at capacity. Try again shortly.", 429),
    );
    const c = new PreviewController(() => undefined);
    c.setProps({ caseId: "case_1", plan: plan("plan_1", "prompt one"), referenceImageUrl: "/ref" });
    await c.start(video);
    expect(h.instances).toHaveLength(0);
    expect(c.current).toMatchObject({
      status: "error",
      error: { detail: "The demo is at capacity. Try again shortly." },
    });
  });

  it("stop during token mint releases the lease that arrives late", async () => {
    let resolveToken: (t: ReactorTokenResponse) => void = () => undefined;
    h.createReactorToken.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveToken = resolve;
      }),
    );
    const c = new PreviewController(() => undefined);
    c.setProps({ caseId: "case_1", plan: plan("plan_1", "prompt one"), referenceImageUrl: "/ref" });
    const pending = c.start(video);
    await vi.advanceTimersByTimeAsync(0);
    await c.stop("user");
    resolveToken(TOKEN);
    await pending;
    expect(h.instances).toHaveLength(0);
    expect(h.releaseLease).toHaveBeenCalledWith("case_1", "lease_1");
    expect(c.current.status).toBe("idle");
  });

  it("case or reference changes stop the live session", async () => {
    const first = await startLive();
    first.c.setProps({ caseId: "case_2", plan: plan("plan_1", "p"), referenceImageUrl: "/ref" });
    await vi.advanceTimersByTimeAsync(0);
    expect(first.preview.close).toHaveBeenCalled();

    const second = await startLive();
    second.c.setProps({ caseId: "case_1", plan: plan("plan_1", "p"), referenceImageUrl: "/ref2" });
    await vi.advanceTimersByTimeAsync(0);
    expect(second.preview.close).toHaveBeenCalled();
    expect(second.c.current.notice).toBe(STOP_NOTICES.reference);
  });
});
