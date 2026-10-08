import type { SupportCallBriefResponse } from "@symptomsketch/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupportCallController, type CallView } from "./support-call-controller";

// The Reactor SDK needs WebRTC + wasm, so ViduS2AvatarModel is replaced by a fake that answers
// each command with the session_state the real service sends. The API calls are mocked too.
const sdk = vi.hoisted(() => {
  type Handler = (message: never) => void;
  class FakeModel {
    static instances: FakeModel[] = [];
    readonly handlers = new Map<string, Set<Handler>>();
    readonly calls: string[] = [];
    /** What end_call returns; a test that needs it to hang (as in the live runs) replaces it. */
    endCallResult: Promise<undefined> = Promise.resolve(undefined);
    constructor() {
      FakeModel.instances.push(this);
    }
    private sub(kind: string, handler: Handler): () => void {
      const set = this.handlers.get(kind) ?? new Set<Handler>();
      set.add(handler);
      this.handlers.set(kind, set);
      return () => set.delete(handler);
    }
    emit(kind: string, message: unknown): void {
      for (const handler of [...(this.handlers.get(kind) ?? [])]) handler(message as never);
    }
    listenerCount(): number {
      return [...this.handlers.values()].reduce((n, set) => n + set.size, 0);
    }
    private session(phase: string, extra: Record<string, unknown> = {}): void {
      setTimeout(() => this.emit("session", { phase, ...extra }), 0);
    }
    on(kind: string, handler: Handler): void {
      this.sub(`on:${kind}`, handler);
    }
    off(kind: string, handler: Handler): void {
      this.handlers.get(`on:${kind}`)?.delete(handler);
    }
    onSessionState = (h: Handler) => this.sub("session", h);
    onCommandError = (h: Handler) => this.sub("commandError", h);
    onTranscript = (h: Handler) => this.sub("transcript", h);
    onCallEnded = (h: Handler) => this.sub("callEnded", h);
    onMainVideo = (h: Handler) => this.sub("video", h);
    onMainAudio = (h: Handler) => this.sub("audio", h);
    async connect(): Promise<void> {
      this.calls.push("connect");
    }
    getStatus(): string {
      return "ready";
    }
    async getState(): Promise<{ phase: string }> {
      return { phase: "idle" };
    }
    async attachAvatar({ avatar_id }: { avatar_id: string }): Promise<void> {
      this.calls.push(`attach_avatar:${avatar_id}`);
      this.session("avatar_ready", { avatar_id });
    }
    async uploadFile(): Promise<{ id: string }> {
      this.calls.push("upload");
      return { id: "upload_1" };
    }
    async createAvatar(): Promise<void> {
      this.calls.push("create_avatar");
      this.session("avatar_ready", { avatar_id: "av_new" });
    }
    async startCall(): Promise<void> {
      this.calls.push("start_call");
      this.session("live", { call_max_seconds: 240 });
    }
    async say({ text }: { text: string }): Promise<void> {
      this.calls.push(`say:${text}`);
    }
    endCall(): Promise<undefined> {
      this.calls.push("end_call");
      return this.endCallResult;
    }
    async disconnect(): Promise<void> {
      this.calls.push("disconnect");
    }
  }
  return { FakeModel };
});

vi.mock("@reactor-models/vidu-s2-avatar/core", () => ({ ViduS2AvatarModel: sdk.FakeModel }));

const api = vi.hoisted(() => ({
  createSupportCallToken: vi.fn(),
  getSupportCallBrief: vi.fn(),
  fetchSupportCallPortrait: vi.fn(),
  saveSupportCallAvatar: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

function brief(overrides: Partial<SupportCallBriefResponse> = {}): SupportCallBriefResponse {
  return {
    package: { persona: "You are Sam, an AI.", greeting: 'Open the call by saying: "Hi"' },
    modelId: "stub",
    avatarId: null,
    avatarPortraitSource: null,
    portraitUrl: "/api/tickets/tkt_1/support-call/portrait",
    ...overrides,
  };
}

function setup() {
  const views: CallView[] = [];
  const ended = vi.fn();
  const controller = new SupportCallController((v) => views.push(v), ended);
  const view = () => views.at(-1)!;
  return { controller, ended, view };
}

beforeEach(() => {
  sdk.FakeModel.instances.length = 0;
  URL.createObjectURL = () => "blob:portrait";
  URL.revokeObjectURL = () => undefined;
  api.createSupportCallToken.mockResolvedValue({ jwt: "stub.jwt", maxSessionDurationSeconds: 300 });
  api.getSupportCallBrief.mockResolvedValue(brief());
  api.fetchSupportCallPortrait.mockResolvedValue({ blob: new Blob(["x"]), source: "composite" });
  api.saveSupportCallAvatar.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SupportCallController avatar reuse", () => {
  it("rebuilds an avatar made from the base portrait once the composite exists", async () => {
    api.getSupportCallBrief.mockResolvedValue(
      brief({ avatarId: "av_base", avatarPortraitSource: "base" }),
    );
    const { controller, view } = setup();
    await controller.start("tkt_1");
    expect(view().phase).toBe("live");
    const model = sdk.FakeModel.instances[0]!;
    expect(model.calls).not.toContain("attach_avatar:av_base");
    expect(model.calls).toContain("create_avatar");
    expect(api.saveSupportCallAvatar).toHaveBeenCalledWith("tkt_1", {
      avatarId: "av_new",
      portraitSource: "composite",
    });
    await controller.end();
  });

  it("re-attaches the saved avatar when it was built from the same portrait", async () => {
    api.getSupportCallBrief.mockResolvedValue(
      brief({ avatarId: "av_comp", avatarPortraitSource: "composite" }),
    );
    const { controller, view } = setup();
    await controller.start("tkt_1");
    expect(view().phase).toBe("live");
    const model = sdk.FakeModel.instances[0]!;
    expect(model.calls).toContain("attach_avatar:av_comp");
    expect(model.calls).not.toContain("create_avatar");
    expect(api.saveSupportCallAvatar).not.toHaveBeenCalled();
    await controller.end();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function liveCall(controller: InstanceType<typeof SupportCallController>) {
  await controller.start("tkt_1");
  const model = sdk.FakeModel.instances.at(-1)!;
  model.emit("transcript", { speaker: "character", text: "Hi, I'm Sam.", final: true });
  return model;
}

describe("SupportCallController end of call", () => {
  it("hands over the transcript and media at once, before end_call answers", async () => {
    const { controller, ended, view } = setup();
    const model = await liveCall(controller);
    const endCall = deferred<undefined>();
    model.endCallResult = endCall.promise;

    const ending = controller.end();
    expect(view().phase).toBe("ended");
    expect(view().hasVideo).toBe(false);
    expect(ended).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [{ speaker: "character", text: "Hi, I'm Sam." }],
        endReason: "ended_by_client",
      }),
    );
    expect(model.listenerCount()).toBe(0);
    expect(model.calls).toContain("end_call");
    expect(model.calls).not.toContain("disconnect");

    endCall.resolve(undefined);
    await ending;
    expect(model.calls).toContain("disconnect");
  });

  it("starts a clean call right after End that the old teardown cannot touch", async () => {
    const { controller, ended, view } = setup();
    const first = await liveCall(controller);
    const endCall = deferred<undefined>();
    first.endCallResult = endCall.promise;
    const ending = controller.end();

    await controller.start("tkt_1");
    const second = sdk.FakeModel.instances.at(-1)!;
    expect(second).not.toBe(first);
    expect(view().phase).toBe("live");
    const listeners = second.listenerCount();
    expect(listeners).toBeGreaterThan(0);

    endCall.resolve(undefined);
    await ending;
    expect(first.calls).toContain("disconnect");
    expect(second.calls).not.toContain("disconnect");
    expect(second.listenerCount()).toBe(listeners);
    expect(view().phase).toBe("live");
    expect(await controller.say("Still there?")).toBe(true);
    expect(second.calls).toContain("say:Still there?");
    expect(ended).toHaveBeenCalledTimes(1);
    await controller.end();
  });

  it("drops a call that was still starting when it ended once the next call runs", async () => {
    const token = deferred<{ jwt: string }>();
    api.createSupportCallToken.mockReturnValueOnce(token.promise);
    const { controller, view } = setup();
    const stale = controller.start("tkt_1");
    await vi.waitFor(() => expect(api.createSupportCallToken).toHaveBeenCalledTimes(1));
    await controller.end();
    expect(view().phase).toBe("ended");

    await controller.start("tkt_1");
    expect(view().phase).toBe("live");
    token.resolve({ jwt: "late.jwt" });
    await stale;
    expect(sdk.FakeModel.instances).toHaveLength(1);
    expect(sdk.FakeModel.instances[0]!.listenerCount()).toBeGreaterThan(0);
    expect(view().phase).toBe("live");
    await controller.end();
  });

  it("on page hide saves the transcript and disconnects without waiting for end_call", async () => {
    const { controller, ended } = setup();
    const model = await liveCall(controller);
    model.endCallResult = new Promise(() => undefined);
    controller.dispose();
    expect(ended).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(model.calls).toContain("disconnect"));
    expect(model.calls).not.toContain("end_call");
  });
});

describe("SupportCallController call cap", () => {
  it("ends the call before the provider's session hard stop", async () => {
    // The session cap runs from connect; a first call spends ~55 s building the avatar first.
    api.createSupportCallToken.mockResolvedValue({
      jwt: "stub.jwt",
      maxSessionDurationSeconds: 200,
    });
    const { controller, view } = setup();
    await controller.start("tkt_1");
    expect(view().phase).toBe("live");
    expect(view().capSeconds).toBeLessThanOrEqual(190);
    expect(view().capSeconds).toBeGreaterThanOrEqual(189);
    sdk.FakeModel.instances[0]!.emit("session", { phase: "live", call_max_seconds: 240 });
    expect(view().capSeconds).toBeLessThanOrEqual(190);
    await controller.end();
  });

  it("keeps the four-minute cap when the session has room for it", async () => {
    const { controller, view } = setup();
    await controller.start("tkt_1");
    expect(view().capSeconds).toBe(240);
    await controller.end();
  });
});
