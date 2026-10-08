import { X2Model, type FileRef, type X2StateUpdateMessage } from "@reactor-models/x2/core";
import type { StillImage } from "./geometry";
import { createStillSource, type StillSource } from "./source-canvas";

/** js-sdk types are not importable from apps/web (docs/providers/reactor-x2.md section 3). */
export type ReactorStatus = ReturnType<X2Model["getStatus"]>;
type ReactorError = NonNullable<ReturnType<X2Model["getLastError"]>>;
type RawMessage = { type: string; data: unknown };

export type PreviewStep = "connect" | "publish" | "reference" | "prompt";

/** A failed lifecycle step. `code` is a provider code (UNAUTHORIZED, invalid_image, ...), never a message. */
export class PreviewFailure extends Error {
  readonly code: string;
  readonly step: PreviewStep;
  constructor(code: string, step: PreviewStep) {
    super(`${step} failed (${code})`);
    this.name = "PreviewFailure";
    this.code = code;
    this.step = step;
  }
}

export interface X2PreviewError {
  code: string;
  recoverable: boolean;
  operation?: string;
}

/** One newly decoded main_video frame (its mediaTime advanced; re-presented frames never count). */
export interface FreshFrame {
  /** Run this frame belongs to, or 0 for output not attributable to an armed run. */
  runId: number;
  /** True for the first fresh frame of `runId`. */
  firstOfRun: boolean;
  mediaTime: number;
  /** performance.now() when the frame callback ran. */
  at: number;
}

export interface X2PreviewEvents {
  status: ReactorStatus;
  state: X2StateUpdateMessage;
  generationStarted: { runId: number };
  generationStopped: { reason: string };
  frame: FreshFrame;
  /** The main_video track ended (provider side). */
  outputEnded: null;
  /** Every failure incl. command errors (typed commands resolve undefined, never reject). */
  error: X2PreviewError;
  /** "terminate" ends the session shortly after. */
  moderation: "warn" | "terminate";
}

type Listener<K extends keyof X2PreviewEvents> = (payload: X2PreviewEvents[K]) => void;

function codeOf(err: unknown, fallback: string): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.length > 0 ? code : fallback;
}

function referenceName(blob: Blob): string {
  if (blob.type === "image/png") return "reference.png";
  if (blob.type === "image/webp") return "reference.webp";
  return "reference.jpg";
}

/**
 * One X2 connection (one token). Wraps the live-verified lifecycle from
 * docs/providers/reactor-x2.md section 7, split per section 8 into prepareRun() + fire() so the
 * recorder can be armed between them. Create a new instance (and a new token) per connection.
 */
export class X2Preview {
  readonly x2 = new X2Model();
  private readonly video: HTMLVideoElement;
  private readonly listeners = new Map<keyof X2PreviewEvents, Set<Listener<never>>>();
  private source: StillSource | null = null;
  private stream: MediaStream | null = null;
  private referenceFile: FileRef | null = null;
  private unsubs: Array<() => void> = [];
  private runId = 0;
  private armedRun = 0;
  private lastMediaTimeValue = -1;
  private mediaTimeAtArm = -1;
  private sawFresh = false;
  private frameHandle: number | null = null;
  private closed = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    const { x2 } = this;
    const status = (s: ReactorStatus) => {
      if (!this.closed) this.emit("status", s);
    };
    const error = (e: ReactorError) => {
      if (!this.closed) {
        this.emit("error", { code: e.code, recoverable: e.recoverable, operation: e.operation });
      }
    };
    const runtime = (m: RawMessage) => {
      if (m.type !== "moderation") return;
      const action = (m.data as { action?: unknown } | null)?.action;
      if (action === "warn" || action === "terminate") this.emit("moderation", action);
    };
    x2.on("statusChanged", status);
    x2.on("error", error);
    x2.on("runtimeMessage", runtime);
    this.unsubs.push(
      () => x2.off("statusChanged", status),
      () => x2.off("error", error),
      () => x2.off("runtimeMessage", runtime),
      x2.onStateUpdate((m) => this.emit("state", m)),
      x2.onGenerationStarted(() => this.arm()),
      x2.onGenerationStopped((m) => this.emit("generationStopped", { reason: m.reason })),
      x2.onMainVideo((track, stream) => this.attachOutput(track, stream)),
    );
  }

  on<K extends keyof X2PreviewEvents>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** mediaTime of the newest decoded output frame (-1 before any). */
  get lastMediaTime(): number {
    return this.lastMediaTimeValue;
  }

  /** Highest run id handed out so far (0 before the first fire()). */
  get currentRunId(): number {
    return this.runId;
  }

  getStatus(): ReactorStatus {
    return this.x2.getStatus();
  }

  /** jwt: the static string from POST /api/cases/:id/reactor-token. Resolves once the source is live. */
  async connect(jwt: string, still: StillImage): Promise<void> {
    try {
      await this.x2.connect(jwt);
    } catch (err) {
      throw new PreviewFailure(codeOf(err, "CONNECT_FAILED"), "connect");
    }
    if (this.closed) throw new PreviewFailure("ABORTED", "connect");
    if (this.x2.getStatus() !== "ready") throw new PreviewFailure("INVALID_STATE", "connect");
    this.source = createStillSource(still);
    try {
      await this.x2.publishSource(this.source.track);
    } catch (err) {
      throw new PreviewFailure(codeOf(err, "PUBLISH_FAILED"), "publish");
    }
    // Still mode: consume every source frame in order; persists across reset (doc section 9).
    await this.x2.setKeepBacklog({ keep_backlog: true });
  }

  /** Upload (once per connection) and apply the canonical reference. Generation needs fire() next. */
  async prepareRun(reference: Blob): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.referenceFile || attempt > 0) {
        try {
          this.referenceFile = await this.x2.uploadFile(reference, {
            name: referenceName(reference),
          });
        } catch (err) {
          throw new PreviewFailure(codeOf(err, "UPLOAD_FAILED"), "reference");
        }
      }
      if (this.closed) throw new PreviewFailure("ABORTED", "reference");
      const accepted = await this.x2.setReferenceImage({ reference_image: this.referenceFile });
      if (accepted) return;
    }
    throw new PreviewFailure(this.lastErrorCode("invalid_image"), "reference");
  }

  /** Sends the action prompt for a new run. Arming happens on generation_started. Returns the run id. */
  async fire(prompt: string): Promise<number> {
    this.runId += 1;
    const id = this.runId;
    const ack = await this.x2.setPrompt({ prompt });
    if (!ack) throw new PreviewFailure(this.lastErrorCode("invalid_command"), "prompt");
    return id;
  }

  /** Mid-run correction; applies from the next block, no restart. Callers serialize these. */
  async correct(prompt: string): Promise<boolean> {
    return (await this.x2.setPrompt({ prompt })) !== undefined;
  }

  /** Stops generation and keeps the connection + token. Output freezes until the next fire(). */
  async reset(): Promise<void> {
    this.armedRun = 0;
    this.sawFresh = false;
    await this.x2.reset();
  }

  /** Full teardown in the documented order. The session ends server-side. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.frameHandle !== null) this.video.cancelVideoFrameCallback(this.frameHandle);
    this.frameHandle = null;
    try {
      if (this.x2.getStatus() === "ready") await this.x2.unpublishSource(); // never rejects
      await this.x2.disconnect(); // non-recoverable: ends session + frees wasm client
    } catch {
      // Nothing else to free locally; the session also ends at max_session_duration.
    } finally {
      this.source?.stop();
      this.source = null;
      if (this.stream && this.video.srcObject === this.stream) {
        this.video.pause();
        this.video.srcObject = null;
      }
      for (const track of this.stream?.getTracks() ?? []) track.stop();
      this.stream = null;
      for (const off of this.unsubs.splice(0)) off();
      this.listeners.clear();
    }
  }

  private emit<K extends keyof X2PreviewEvents>(event: K, payload: X2PreviewEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) (fn as Listener<K>)(payload);
  }

  private lastErrorCode(fallback: string): string {
    return this.x2.getLastError()?.code ?? fallback;
  }

  private attachOutput(track: MediaStreamTrack, stream: MediaStream): void {
    if (this.closed) return;
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    void this.video.play().catch(() => undefined);
    track.addEventListener("ended", () => {
      if (!this.closed) this.emit("outputEnded", null);
    });
    this.watchFrames();
  }

  private arm(): void {
    // No frames flow between reset and the next generation_started, so any frame with a newer
    // mediaTime than the last pre-arm frame belongs to this run (doc section 7).
    this.armedRun = this.runId;
    this.sawFresh = false;
    this.mediaTimeAtArm = this.lastMediaTimeValue;
    this.emit("generationStarted", { runId: this.runId });
  }

  private watchFrames(): void {
    if (this.frameHandle !== null) this.video.cancelVideoFrameCallback(this.frameHandle);
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      if (this.closed) return;
      if (meta.mediaTime > this.lastMediaTimeValue) {
        this.lastMediaTimeValue = meta.mediaTime;
        const inRun = this.armedRun !== 0 && meta.mediaTime > this.mediaTimeAtArm;
        const firstOfRun = inRun && !this.sawFresh;
        if (firstOfRun) this.sawFresh = true;
        this.emit("frame", {
          runId: inRun ? this.armedRun : 0,
          firstOfRun,
          mediaTime: meta.mediaTime,
          at: performance.now(),
        });
      }
      this.frameHandle = this.video.requestVideoFrameCallback(onFrame);
    };
    this.frameHandle = this.video.requestVideoFrameCallback(onFrame);
  }
}
