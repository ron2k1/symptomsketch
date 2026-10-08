import {
  ViduS2AvatarModel,
  type ViduS2AvatarCommandErrorMessage,
  type ViduS2AvatarSessionStateMessage,
} from "@reactor-models/vidu-s2-avatar/core";
import {
  LIMITS,
  paths,
  SUPPORT_CALL_AGENT_NAME,
  SUPPORT_CALL_COPY,
  type SupportCallBriefResponse,
  type SupportCallPhase,
  type SupportCallTranscriptLine,
} from "@symptomsketch/contracts";
import {
  createSupportCallToken,
  errorMessage,
  fetchSupportCallPortrait,
  getSupportCallBrief,
  saveSupportCallAvatar,
  type SupportCallPortrait,
} from "@/lib/api";
import {
  EMPTY_TRANSCRIPT,
  addTypedLine,
  applyTranscript,
  callCapSeconds,
  finalLines,
  phaseFromSession,
  type TranscriptState,
} from "./support-call-model";

export interface CallView {
  phase: SupportCallPhase;
  /** Plain sub-step under the phase label, e.g. "Building the avatar". */
  detail: string | null;
  error: string | null;
  transcript: TranscriptState;
  elapsedSeconds: number;
  capSeconds: number;
  micOn: boolean;
  micNotice: string | null;
  /** Object URL of the portrait this call uses (shown until video arrives). */
  portraitUrl: string | null;
  hasVideo: boolean;
  /** Measured create_avatar time (upload excluded), null when an avatar was re-attached. */
  avatarMs: number | null;
  endReason: string | null;
}

export const INITIAL_CALL_VIEW: CallView = {
  phase: "idle",
  detail: null,
  error: null,
  transcript: EMPTY_TRANSCRIPT,
  elapsedSeconds: 0,
  capSeconds: callCapSeconds(null),
  micOn: false,
  micNotice: null,
  portraitUrl: null,
  hasVideo: false,
  avatarMs: null,
  endReason: null,
};

export interface CallEnded {
  lines: SupportCallTranscriptLine[];
  durationSeconds: number;
  endReason: string | null;
}

const AVATAR_READY_TIMEOUT_MS = 120_000;
const LIVE_TIMEOUT_MS = 60_000;
const END_CALL_TIMEOUT_MS = 5_000;
/**
 * disconnect() waits out SDK reads still in flight (an unanswered end_call among them), which held
 * it ~25 s in the first live call. The UI and the transcript save never wait on it (finish() hands
 * both off first); this only bounds when end() resolves, and the disconnect finishes regardless.
 */
const DISCONNECT_WAIT_MS = 5_000;
/** The call ends this long before the provider's session hard stop would cut it off. */
const SESSION_END_MARGIN_S = 10;

const settleWithin = (p: Promise<unknown>, ms: number): Promise<boolean> =>
  Promise.race([
    p.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((r) => window.setTimeout(() => r(false), ms)),
  ]);

class CallFailure extends Error {}

/**
 * Provider teardown for one call's own model. end_call only while a call runs (phase null skips
 * it, e.g. on pagehide), then disconnect. The SDK never rejects endCall, and the provider also
 * stops the session at max_session_duration_seconds.
 */
async function endSession(model: ViduS2AvatarModel, phase: string | null): Promise<void> {
  const t0 = performance.now();
  const ended =
    phase !== null && ["starting", "warming_up", "live"].includes(phase)
      ? await settleWithin(model.endCall(), END_CALL_TIMEOUT_MS)
      : null;
  const t1 = performance.now();
  const disconnected = await settleWithin(model.disconnect(), DISCONNECT_WAIT_MS);
  console.info(
    `[support-call] end_call ${ended === null ? "skipped" : ended ? "ok" : "timeout"} ` +
      `ms=${Math.round(t1 - t0)} disconnect ${disconnected ? "ok" : "pending"} ` +
      `ms=${Math.round(performance.now() - t1)}`,
  );
}

/**
 * One live AI support agent call on one ticket (Reactor Vidu S2 Avatar). A new SDK instance and a
 * new max_sessions=1 token per call. Billing runs from session ready, so the session connects only
 * after the brief and portrait are in hand, and disconnects as soon as the call ends.
 */
export class SupportCallController {
  private view: CallView = INITIAL_CALL_VIEW;
  private model: ViduS2AvatarModel | null = null;
  /** The <video> mounts once the call leaves idle, so it is looked up when output arrives. */
  private getVideo: () => HTMLVideoElement | null = () => null;
  private video: HTMLVideoElement | null = null;
  private out: MediaStream | null = null;
  private mic: MediaStreamTrack | null = null;
  private unsubs: Array<() => void> = [];
  private abort: AbortController | null = null;
  private tick: number | null = null;
  private liveAt: number | null = null;
  /** max_session_duration_seconds runs from connect, ~55 s before a first call goes live. */
  private sessionEndsAt: number | null = null;
  private callStarted = false;
  private closing = false;
  private session: ViduS2AvatarSessionStateMessage | null = null;
  private waiters = new Set<() => void>();
  private lastCommandError: ViduS2AvatarCommandErrorMessage | null = null;

  constructor(
    private readonly onView: (view: CallView) => void,
    private readonly onEnded?: (ended: CallEnded) => void,
  ) {}

  private set(patch: Partial<CallView>): void {
    this.view = { ...this.view, ...patch };
    this.onView(this.view);
  }

  get busy(): boolean {
    return this.view.phase !== "idle" && this.view.phase !== "ended";
  }

  /** From an explicit click only. */
  async start(ticketId: string, getVideo: () => HTMLVideoElement | null): Promise<void> {
    if (this.busy) return;
    this.reset();
    this.getVideo = getVideo;
    const abort = new AbortController();
    this.abort = abort;
    this.set({ ...INITIAL_CALL_VIEW, phase: "preparing", detail: "Reading your ticket" });
    try {
      const [brief, portrait] = await Promise.all([
        getSupportCallBrief(ticketId, { signal: abort.signal }),
        this.loadPortrait(ticketId, abort.signal),
      ]);
      this.ensureOpen(abort.signal);
      this.set({ detail: "Connecting to the avatar service" });
      const token = await createSupportCallToken(ticketId);
      this.ensureOpen(abort.signal);
      const model = new ViduS2AvatarModel();
      this.model = model;
      this.listen(model);
      if (token.maxSessionDurationSeconds > 0) {
        this.sessionEndsAt = Date.now() + token.maxSessionDurationSeconds * 1000;
      }
      await model.connect(token.jwt);
      this.ensureOpen(abort.signal);
      if (model.getStatus() !== "ready")
        throw new CallFailure("The avatar service did not get ready.");
      this.session = (await model.getState()) ?? this.session;
      await this.bindAvatar(model, ticketId, brief, portrait, abort.signal);
      this.ensureOpen(abort.signal);
      this.set({ phase: "connecting", detail: `${SUPPORT_CALL_AGENT_NAME} is joining` });
      this.callStarted = true;
      await model.startCall({
        persona: brief.package.persona,
        greeting: brief.package.greeting,
        call_mode: "audio",
        transcripts: true,
        vad: { type: "semantic" },
        llm: { max_tokens: 90, temperature: 0.6 },
      });
      this.ensureOpen(abort.signal);
      await this.waitFor((s) => s.phase === "live", LIVE_TIMEOUT_MS, "start_call");
      this.ensureOpen(abort.signal);
      this.liveAt = Date.now();
      this.set({
        phase: "live",
        detail: null,
        capSeconds: this.capFor(this.session?.call_max_seconds),
      });
      this.tick = window.setInterval(() => this.onTick(), 500);
    } catch (err) {
      // Closing, or an earlier call ended while this await was pending: nothing left to tear down.
      if (this.closing || abort.signal.aborted) return;
      const message =
        err instanceof CallFailure ? err.message : errorMessage(err) || "The call could not start.";
      await this.finish(null, message);
    }
  }

  /** Runs alongside the brief: the per-ticket Nano Banana composite can take ~15 s. */
  private async loadPortrait(ticketId: string, signal: AbortSignal): Promise<SupportCallPortrait> {
    this.set({ detail: "Preparing the agent portrait" });
    const portrait = await fetchSupportCallPortrait(paths.ticketSupportCallPortrait(ticketId), {
      signal,
    });
    this.set({ portraitUrl: URL.createObjectURL(portrait.blob) });
    return portrait;
  }

  private async bindAvatar(
    model: ViduS2AvatarModel,
    ticketId: string,
    brief: SupportCallBriefResponse,
    portrait: SupportCallPortrait,
    signal: AbortSignal,
  ): Promise<void> {
    // Reuse the saved avatar only when it was built from this portrait: an avatar from the base
    // portrait is rebuilt once Nano Banana's composite (the agent holding the product) exists.
    if (brief.avatarId && brief.avatarPortraitSource === portrait.source) {
      this.set({ detail: "Loading the avatar" });
      await model.attachAvatar({ avatar_id: brief.avatarId });
      this.ensureOpen(signal);
      const ok = await this.waitFor((s) => s.phase === "avatar_ready", 30_000, "attach_avatar")
        .then(() => true)
        .catch(() => false);
      this.ensureOpen(signal);
      if (ok) return;
    }
    this.set({ detail: "Building the avatar" });
    const image = await model.uploadFile(portrait.blob, { name: "support-agent.jpg" });
    this.ensureOpen(signal);
    const started = performance.now();
    await model.createAvatar({ image, name: SUPPORT_CALL_AGENT_NAME });
    this.ensureOpen(signal);
    const state = await this.waitFor(
      (s) => s.phase === "avatar_ready",
      AVATAR_READY_TIMEOUT_MS,
      "create_avatar",
    );
    const avatarMs = Math.round(performance.now() - started);
    this.set({ avatarMs });
    console.info(`[support-call] create_avatar ready ms=${avatarMs}`);
    if (state.avatar_id) {
      void saveSupportCallAvatar(ticketId, {
        avatarId: state.avatar_id,
        portraitSource: portrait.source,
      }).catch(() => undefined);
    }
  }

  private listen(model: ViduS2AvatarModel): void {
    const onStatus = (status: string) => {
      if (status === "disconnected" && this.busy && !this.closing) {
        void this.finish(null, "The call connection closed.");
      }
    };
    const onError = (e: { code?: string }) => {
      if (this.closing) return;
      console.warn(`[support-call] sdk error code=${e.code ?? "-"}`);
    };
    model.on("statusChanged", onStatus);
    model.on("error", onError);
    this.unsubs.push(
      () => model.off("statusChanged", onStatus),
      () => model.off("error", onError),
      model.onSessionState((s) => this.onSession(s)),
      model.onCommandError((e) => {
        this.lastCommandError = e;
        console.warn(`[support-call] command_error command=${e.command} code=${e.code}`);
        for (const wake of [...this.waiters]) wake();
      }),
      model.onTranscript((m) => this.set({ transcript: applyTranscript(this.view.transcript, m) })),
      model.onCallEnded((m) => {
        if (!this.closing) void this.finish(m.end_reason || null, null);
      }),
      model.onMainVideo((track) => this.attach(track, true)),
      model.onMainAudio((track) => this.attach(track, false)),
    );
  }

  private onSession(s: ViduS2AvatarSessionStateMessage): void {
    this.session = s;
    for (const wake of [...this.waiters]) wake();
    const patch: Partial<CallView> = {};
    if (s.call_max_seconds) patch.capSeconds = this.capFor(s.call_max_seconds);
    if (typeof s.call_elapsed_seconds === "number") patch.elapsedSeconds = s.call_elapsed_seconds;
    if (this.callStarted && !this.closing) {
      const phase = phaseFromSession(s.phase, true);
      if (phase === "ended" && this.view.phase === "live") {
        void this.finish(s.end_reason, null);
        return;
      }
      if (phase === "connecting" || phase === "live") patch.phase = phase;
    }
    this.set(patch);
  }

  /** Both output tracks go on ONE MediaStream on ONE <video> (audio + lip-sync together). */
  private attach(track: MediaStreamTrack, isVideo: boolean): void {
    const video = this.getVideo();
    if (!video || this.closing) return;
    this.video = video;
    if (!this.out) this.out = new MediaStream();
    for (const old of this.out.getTracks()) {
      if (old.kind === track.kind && old.id !== track.id) this.out.removeTrack(old);
    }
    if (!this.out.getTracks().some((t) => t.id === track.id)) this.out.addTrack(track);
    if (video.srcObject !== this.out) video.srcObject = this.out;
    video.muted = false;
    void video.play().catch(() => undefined);
    if (isVideo) this.set({ hasVideo: true });
  }

  /** callCapSeconds, but never past the session's hard stop (minus a margin) once live. */
  private capFor(callMaxSeconds: number | null | undefined): number {
    const cap = callCapSeconds(callMaxSeconds ?? null);
    if (this.sessionEndsAt === null || this.liveAt === null) return cap;
    const left = Math.floor((this.sessionEndsAt - this.liveAt) / 1000) - SESSION_END_MARGIN_S;
    return Math.max(0, Math.min(cap, left));
  }

  private waitFor(
    pred: (s: ViduS2AvatarSessionStateMessage) => boolean,
    timeoutMs: number,
    command: string,
  ): Promise<ViduS2AvatarSessionStateMessage> {
    const errorBefore = this.lastCommandError;
    return new Promise((resolve, reject) => {
      const done = () => {
        this.waiters.delete(check);
        window.clearTimeout(timer);
      };
      const check = () => {
        if (this.closing) {
          done();
          reject(new CallFailure("Call ended."));
        } else if (this.session && pred(this.session)) {
          done();
          resolve(this.session);
        } else if (
          this.lastCommandError &&
          this.lastCommandError !== errorBefore &&
          (this.lastCommandError.command === command || this.lastCommandError.command === "session")
        ) {
          const code = this.lastCommandError.code;
          done();
          reject(new CallFailure(`The support agent could not start (${code}).`));
        }
      };
      const timer = window.setTimeout(() => {
        done();
        reject(new CallFailure("The support agent took too long to get ready."));
      }, timeoutMs);
      this.waiters.add(check);
      check();
    });
  }

  private onTick(): void {
    if (this.view.phase !== "live" || this.liveAt === null) return;
    const local = (Date.now() - this.liveAt) / 1000;
    const elapsed = Math.max(local, this.session?.call_elapsed_seconds ?? 0);
    this.set({ elapsedSeconds: elapsed });
    if (elapsed >= this.view.capSeconds) void this.end();
  }

  async say(text: string): Promise<boolean> {
    const clean = text.trim().slice(0, LIMITS.supportCallSayMaxChars);
    if (!clean || this.view.phase !== "live" || !this.model) return false;
    this.set({ transcript: addTypedLine(this.view.transcript, clean) });
    await this.model.say({ text: clean });
    return true;
  }

  async interrupt(): Promise<void> {
    if (this.view.phase === "live") await this.model?.interrupt();
  }

  /** getUserMedia only after the customer turns the mic on; denied -> text-only notice. */
  async toggleMic(): Promise<void> {
    const model = this.model;
    if (!model || this.view.phase !== "live") return;
    if (this.mic) {
      const track = this.mic;
      this.mic = null;
      this.set({ micOn: false });
      await model.unpublishMic().catch(() => undefined);
      track.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      this.set({ micNotice: SUPPORT_CALL_COPY.micDenied });
      return;
    }
    const track = stream.getAudioTracks()[0];
    if (!track || this.view.phase !== "live") {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    this.mic = track;
    try {
      await model.publishMic(track);
      this.set({ micOn: true, micNotice: null });
    } catch {
      this.mic = null;
      track.stop();
      this.set({ micNotice: SUPPORT_CALL_COPY.micDenied });
    }
  }

  /** End call -> report the transcript -> end_call + disconnect in the background. Idempotent. */
  async end(): Promise<void> {
    if (!this.busy) return;
    await this.finish("ended_by_client", null);
  }

  /**
   * Everything up to the first await clears the shared fields: release() detaches this call's
   * model, listeners and media, and the transcript is handed over at once. The provider teardown
   * then runs on this call's own model, so "Talk to support again" right after End starts a clean
   * call that this teardown cannot touch. `leaving` (pagehide/unmount) skips end_call and
   * disconnects at once.
   */
  private async finish(
    endReason: string | null,
    error: string | null,
    leaving = false,
  ): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    for (const wake of [...this.waiters]) wake();
    this.abort?.abort();
    if (this.tick !== null) window.clearInterval(this.tick);
    this.tick = null;
    const model = this.model;
    const phase = leaving ? null : (this.session?.phase ?? "");
    const duration =
      this.liveAt !== null
        ? Math.max(this.view.elapsedSeconds, (Date.now() - this.liveAt) / 1000)
        : 0;
    this.set({ phase: "ended", detail: null, error, micOn: false, endReason });
    this.release();
    if (this.callStarted && this.view.transcript.lines.length > 0) {
      this.onEnded?.({
        lines: finalLines(this.view.transcript),
        durationSeconds: Math.round(duration),
        endReason: endReason ?? this.session?.end_reason ?? null,
      });
    }
    if (model) await endSession(model, phase);
  }

  private release(): void {
    for (const off of this.unsubs.splice(0)) off();
    this.mic?.stop();
    this.mic = null;
    if (this.video && this.video.srcObject === this.out) {
      this.video.pause();
      this.video.srcObject = null;
    }
    for (const t of this.out?.getTracks() ?? []) t.stop();
    this.out = null;
    this.model = null;
    this.set({ hasVideo: false });
  }

  /** Throws once this call is closing or was replaced by a newer start(). */
  private ensureOpen(signal: AbortSignal): void {
    if (this.closing || signal.aborted) throw new CallFailure("Call ended.");
  }

  private reset(): void {
    if (this.view.portraitUrl) URL.revokeObjectURL(this.view.portraitUrl);
    this.closing = false;
    this.callStarted = false;
    this.liveAt = null;
    this.sessionEndsAt = null;
    this.session = null;
    this.lastCommandError = null;
  }

  /** Unmount / pagehide: save the transcript (keepalive) and disconnect without end_call. */
  dispose(): void {
    if (this.busy) void this.finish("ended_by_client", null, true);
    if (this.view.portraitUrl) URL.revokeObjectURL(this.view.portraitUrl);
  }
}
