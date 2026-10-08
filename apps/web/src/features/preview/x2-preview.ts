import { X2Model, type FileRef, type X2StateUpdateMessage } from "@reactor-models/x2/core";
import type { Purpose, SelectedAction } from "@symptomsketch/contracts";
import { STAGE_HEIGHT, STAGE_WIDTH, type StillImage } from "./geometry";
import {
  buildMotionProgram,
  pointerSchedule,
  type MotionProgram,
  type ProductRegion,
} from "./motion-sketch";
import { createStillSource, type StillSource } from "./source-canvas";
import { linkStatsFrom, type LinkStats, type StatsSample } from "./x2-stats";

/** Output frames this soon after setPrompt are left over from the previous run (motion lab). */
const STALE_AFTER_PROMPT_MS = 250;
/** After reset(), wait until no new output frame arrives for this long (capped) before the next run. */
const RESET_QUIET_MS = 700;
const RESET_QUIET_MAX_MS = 2500;

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
  /** WebRTC link numbers from the SDK's statsUpdate (every ~2 s while ready). */
  stats: LinkStats;
  /** setPrompt round trip to X2's correlated prompt_accepted reply. */
  promptAck: { ms: number };
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
  private region: ProductRegion | null = null;
  private motion: MotionProgram | null = null;
  private purpose: Purpose = "problem";
  private keepBacklog: boolean | null = null;
  private firedAt = Number.NEGATIVE_INFINITY;
  private lastFreshAt = 0;
  private pointerTimers: number[] = [];
  private pointerSent = false;

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
    const stats = (sample: StatsSample) => {
      if (!this.closed) this.emit("stats", linkStatsFrom(sample));
    };
    x2.on("statusChanged", status);
    x2.on("error", error);
    x2.on("runtimeMessage", runtime);
    x2.on("statsUpdate", stats);
    this.unsubs.push(
      () => x2.off("statusChanged", status),
      () => x2.off("error", error),
      () => x2.off("runtimeMessage", runtime),
      () => x2.off("statsUpdate", stats),
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

  /** Motion program the next run plays (null = static still). */
  get motionProgram(): MotionProgram | null {
    return this.motion;
  }

  /**
   * jwt: the static string from POST /api/cases/:id/reactor-token. Resolves once the source is live.
   * `action` (plan.selectedAction) selects the motion sketch when the product `region` (from the
   * Gemini product box) is known; without one X2 restyles the plain still.
   */
  async connect(
    jwt: string,
    still: StillImage,
    action: SelectedAction | null = null,
    purpose: Purpose = "problem",
    region: ProductRegion | null = null,
  ): Promise<void> {
    this.purpose = purpose; // a case is one purpose for its whole session
    try {
      await this.x2.connect(jwt);
    } catch (err) {
      throw new PreviewFailure(codeOf(err, "CONNECT_FAILED"), "connect");
    }
    if (this.closed) throw new PreviewFailure("ABORTED", "connect");
    if (this.x2.getStatus() !== "ready") throw new PreviewFailure("INVALID_STATE", "connect");
    this.region = region;
    this.motion = buildMotionProgram(action, this.region, this.purpose);
    this.source = createStillSource(still, this.region);
    try {
      await this.x2.publishSource(this.source.track);
    } catch (err) {
      throw new PreviewFailure(codeOf(err, "PUBLISH_FAILED"), "publish");
    }
    await this.syncBacklog();
  }

  /**
   * Static still: keep_backlog true (consume every frame in order). Animated sketch: false, because
   * true delays the sketched motion by about 5 s and carries it into the next run (doc section 9).
   * Persists across reset, so it is only sent when it changes.
   */
  private async syncBacklog(): Promise<void> {
    const want = this.motion === null;
    if (this.keepBacklog === want) return;
    await this.x2.setKeepBacklog({ keep_backlog: want });
    this.keepBacklog = want;
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
    await this.syncBacklog();
    this.runId += 1;
    const id = this.runId;
    this.firedAt = performance.now();
    if (!(await this.sendPrompt(prompt))) {
      throw new PreviewFailure(this.lastErrorCode("invalid_command"), "prompt");
    }
    return id;
  }

  /**
   * Replays the movement from the start pose on the same connection (no new token): stop the run,
   * re-apply the reference, fire the prompt again. With an `action`, the new run plays that
   * action's motion sketch. Returns the new run id.
   */
  async restartRun(
    reference: Blob,
    prompt: string,
    action?: SelectedAction | null,
  ): Promise<number> {
    await this.reset();
    if (this.closed) throw new PreviewFailure("ABORTED", "prompt");
    if (action !== undefined) this.motion = buildMotionProgram(action, this.region, this.purpose);
    await this.prepareRun(reference);
    return this.fire(prompt);
  }

  /**
   * True when the current run animates the source, or a run with `action` would. Such changes need
   * a fresh run: replaying a sketch mid-run, over X2's own history of the moved product, left the
   * product in place with a ghost copy beside it (live check 2026-10-08). Every measured move came
   * from a fresh run (doc section 9).
   */
  sketches(action: SelectedAction | null): boolean {
    return this.motion !== null || buildMotionProgram(action, this.region, this.purpose) !== null;
  }

  /** setPrompt resolves with X2's correlated prompt_accepted (never rejects); times that reply. */
  private async sendPrompt(prompt: string): Promise<boolean> {
    const sentAt = performance.now();
    const ack = await this.x2.setPrompt({ prompt });
    if (ack && !this.closed) this.emit("promptAck", { ms: performance.now() - sentAt });
    return ack !== undefined;
  }

  /**
   * Mid-run correction; applies from the next block, no restart. Callers serialize these, and use
   * restartRun() instead whenever sketches() is true.
   * With a new `action`, the motion sketch replays from the still pose so the change is visible.
   */
  async correct(prompt: string, action?: SelectedAction | null): Promise<boolean> {
    const ok = await this.sendPrompt(prompt);
    if (ok && action !== undefined && !this.closed) {
      this.stopMotion();
      this.motion = buildMotionProgram(action, this.region, this.purpose);
      await this.syncBacklog();
      if (this.sawFresh) this.startMotion(performance.now());
    }
    return ok;
  }

  /** Stops generation and keeps the connection + token. Output freezes until the next fire(). */
  async reset(): Promise<void> {
    this.armedRun = 0;
    this.sawFresh = false;
    this.stopMotion();
    await this.x2.reset();
    // Frames of the previous run can still arrive after reset; let them drain (motion lab).
    const started = performance.now();
    this.lastFreshAt = started;
    while (!this.closed) {
      const now = performance.now();
      if (now - this.lastFreshAt >= RESET_QUIET_MS || now - started >= RESET_QUIET_MAX_MS) break;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }

  /** Plays the motion program from t0 on the source canvas and drags the pointer along its path. */
  private startMotion(t0: number): void {
    const program = this.motion;
    const source = this.source;
    if (!program || !source || !this.region) return;
    source.play(program, t0);
    const { fore } = source;
    const center = {
      x: (fore.x + this.region.center.x * fore.w) / STAGE_WIDTH,
      y: (fore.y + this.region.center.y * fore.h) / STAGE_HEIGHT,
    };
    const boxH = (this.region.box.h * fore.h) / STAGE_HEIGHT;
    for (const sample of pointerSchedule(program, center, boxH)) {
      const delay = Math.max(0, t0 + sample.atMs - performance.now());
      const timer = window.setTimeout(() => {
        if (this.closed) return;
        this.pointerSent = sample.active;
        void this.x2.setPointer({ x: sample.x, y: sample.y, active: sample.active });
      }, delay);
      this.pointerTimers.push(timer);
    }
  }

  /** Back to the still pose; cancels pending pointer sends and releases an active pointer. */
  private stopMotion(): void {
    for (const t of this.pointerTimers.splice(0)) window.clearTimeout(t);
    this.source?.rest();
    if (this.pointerSent && !this.closed) {
      this.pointerSent = false;
      void this.x2.setPointer({ x: 0.5, y: 0.5, active: false });
    }
  }

  /** Full teardown in the documented order. The session ends server-side. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    for (const t of this.pointerTimers.splice(0)) window.clearTimeout(t);
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
        const at = performance.now();
        this.lastMediaTimeValue = meta.mediaTime;
        this.lastFreshAt = at;
        const inRun =
          this.armedRun !== 0 &&
          meta.mediaTime > this.mediaTimeAtArm &&
          at - this.firedAt >= STALE_AFTER_PROMPT_MS;
        const firstOfRun = inRun && !this.sawFresh;
        if (firstOfRun) {
          this.sawFresh = true;
          this.startMotion(at); // the run's first real output frame is the sketch's t0
        }
        this.emit("frame", {
          runId: inRun ? this.armedRun : 0,
          firstOfRun,
          mediaTime: meta.mediaTime,
          at,
        });
      }
      this.frameHandle = this.video.requestVideoFrameCallback(onFrame);
    };
    this.frameHandle = this.video.requestVideoFrameCallback(onFrame);
  }
}
