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
    private handlers = new Map<string, Set<Fn>>();
    connect = vi.fn(async () => undefined);
    prepareRun = vi.fn(async () => undefined);
    fire = vi.fn(async () => ++this.currentRunId);
    correct = vi.fn(async (_prompt: string) => true);
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
      this.emit("frame", { runId: this.currentRunId, firstOfRun, mediaTime, at: 0 });
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

async function startLive() {
  const views: Array<{ status: string }> = [];
  const c = new PreviewController((v) => views.push(v));
  c.setProps({ caseId: "case_1", plan: plan("plan_1", "prompt one"), referenceImageUrl: "/ref" });
  await c.start(video);
  const preview = h.instances.at(-1)!;
  preview.frame(1, true);
  return { c, preview, views };
}

describe("PreviewController (spec 8 live preview)", () => {
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
    expect(c.current).toMatchObject({ status: "waiting_frames", activePlanId: "plan_1" });

    preview.frame(0.04, true);
    expect(c.current.status).toBe("live");
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
    preview.correct.mockResolvedValueOnce(false);
    c.setProps({ caseId: "case_1", plan: plan("plan_2", "prompt two"), referenceImageUrl: "/ref" });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.current.status).toBe("live");
    expect(c.current.activePlanId).toBe("plan_1");
    expect(c.current.notice).toMatch(/did not accept/);
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

  it("shows Continue preview before the 90 s idle stop; continuing resets it", async () => {
    const { c, preview } = await startLive();
    await vi.advanceTimersByTimeAsync(76_000);
    expect(c.current.idleMsLeft).not.toBeNull();
    c.continuePreview();
    expect(c.current.idleMsLeft).toBeNull();
    await vi.advanceTimersByTimeAsync(80_000);
    expect(preview.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(preview.close).toHaveBeenCalled();
    expect(c.current).toMatchObject({ status: "idle", notice: STOP_NOTICES.idle });
  });

  it("never auto-stops or changes the prompt while a take is being captured", async () => {
    const { c, preview } = await startLive();
    c.setBusy(true);
    c.setProps({ caseId: "case_1", plan: plan("plan_2", "prompt two"), referenceImageUrl: "/ref" });
    await vi.advanceTimersByTimeAsync(400_000);
    expect(preview.correct).not.toHaveBeenCalled();
    expect(preview.close).not.toHaveBeenCalled();
    await c.stop("captured");
    expect(preview.close).toHaveBeenCalledTimes(1);
    expect(c.current).toMatchObject({ status: "idle", notice: null });
  });

  it("an unexpected disconnect tears down and surfaces an honest error", async () => {
    const { c, preview } = await startLive();
    preview.emit("status", "disconnected");
    await vi.advanceTimersByTimeAsync(0);
    expect(preview.close).toHaveBeenCalled();
    expect(h.releaseLease).toHaveBeenCalledWith("case_1", "lease_1");
    expect(c.current).toMatchObject({ status: "error", error: STAGE_ERRORS.disconnected });
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
