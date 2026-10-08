import {
  LIMITS,
  type PlanRevision,
  type PreviewStatus,
  type ReactorTokenResponse,
  type SelectedAction,
} from "@symptomsketch/contracts";
import { createReactorToken } from "@/lib/api";
import { newClientRequestId } from "@/lib/ids";
import { heartbeatLease, loadReference, releaseLease, releaseLeaseKeepalive } from "./lease";
import {
  STAGE_ERRORS,
  STOP_NOTICES,
  stageErrorFrom,
  type StageError,
  type StopNoticeKey,
} from "./preview-errors";
import { evaluateSessionClock } from "./session-clock";
import { X2Preview } from "./x2-preview";

export type SessionStatus = Extract<
  PreviewStatus,
  "idle" | "connecting" | "waiting_frames" | "live" | "updating" | "error"
>;

export interface SessionView {
  status: SessionStatus;
  error: StageError | null;
  /** One-line, non-error explanation (why the preview stopped, a declined correction, ...). */
  notice: string | null;
  /** Set while the visible Continue preview prompt is due (ms until the idle stop). */
  idleMsLeft: number | null;
  /** Plan revision whose prompt the live output currently reflects. */
  activePlanId: string | null;
}

export const INITIAL_SESSION_VIEW: SessionView = {
  status: "idle",
  error: null,
  notice: null,
  idleMsLeft: null,
  activePlanId: null,
};

/** What Record next take borrows from the live session. */
export interface ActiveSession {
  preview: X2Preview;
  video: HTMLVideoElement;
  still: ImageBitmap;
  referenceBlob: Blob;
  activePlanId: string;
}

export interface PreviewProps {
  caseId: string;
  plan: PlanRevision | null;
  referenceImageUrl: string;
}

type StopReason = StopNoticeKey | "user" | "captured" | "case" | "unmount";

interface LiveSession {
  seq: number;
  caseId: string;
  referenceUrl: string;
  video: HTMLVideoElement;
  preview: X2Preview;
  leaseId: string;
  still: ImageBitmap;
  referenceBlob: Blob;
  startedAt: number;
  lastActivityAt: number;
  connected: boolean;
  fired: boolean;
  firstFrameSeen: boolean;
  busy: boolean;
  heartbeatFailures: number;
  timers: number[];
  unsubs: Array<() => void>;
}

const CORRECTION_DECLINED =
  "The visual workspace did not accept that update. The preview keeps the previous movement.";
const MODERATION_WARNING = "The provider flagged part of this request. Consider rephrasing it.";

/** The structured action that selects the motion sketch (null when the plan carries none). */
function actionOf(plan: PlanRevision): SelectedAction | null {
  const inner = (plan as { plan?: { selectedAction?: SelectedAction } }).plan;
  return inner?.selectedAction ?? null;
}

function isReadyPlan(plan: PlanRevision | null): plan is PlanRevision & { reactorPrompt: string } {
  return plan !== null && plan.status === "ready" && typeof plan.reactorPrompt === "string";
}

/**
 * Imperative owner of one live X2 preview at a time (spec 8): explicit start only, token + lease,
 * serialized prompt updates, heartbeat, idle/max timers, documented cleanup. React-free so the
 * hook stays thin; `onChange` receives a fresh view object on every change.
 */
export class PreviewController {
  private readonly onChange: (view: SessionView) => void;
  private view: SessionView = INITIAL_SESSION_VIEW;
  private props: PreviewProps | null = null;
  private session: LiveSession | null = null;
  private seq = 0;
  private reference: { url: string; blob: Blob; still: ImageBitmap } | null = null;
  private pendingPrompt: {
    planId: string;
    prompt: string;
    action: SelectedAction | null;
  } | null = null;
  private queuedPlanId: string | null = null;
  private pumping = false;
  private frameWaiter: { threshold: number; resolve: () => void } | null = null;

  constructor(onChange: (view: SessionView) => void) {
    this.onChange = onChange;
  }

  get current(): SessionView {
    return this.view;
  }

  setProps(next: PreviewProps): void {
    const prev = this.props;
    this.props = next;
    const s = this.session;
    if (!s) return;
    if (prev && next.caseId !== s.caseId) {
      void this.stop("case");
      return;
    }
    if (s.busy) return; // plan, labels and source are frozen while a take is captured
    if (next.referenceImageUrl !== s.referenceUrl) {
      void this.stop("reference");
      return;
    }
    if (isReadyPlan(next.plan) && next.plan.id !== this.queuedPlanId) {
      this.queuedPlanId = next.plan.id;
      this.pendingPrompt = {
        planId: next.plan.id,
        prompt: next.plan.reactorPrompt,
        action: actionOf(next.plan),
      };
      s.lastActivityAt = performance.now();
      if (s.fired) void this.pump(s);
    }
  }

  /** Explicit user action only (never on mount). */
  async start(video: HTMLVideoElement): Promise<void> {
    const props = this.props;
    if (!props || this.session || this.view.status === "connecting") return;
    const plan = props.plan;
    if (!isReadyPlan(plan)) return;
    const seq = ++this.seq;
    this.update({ status: "connecting", error: null, notice: null, idleMsLeft: null });

    let token: ReactorTokenResponse;
    let ref: { blob: Blob; still: ImageBitmap };
    try {
      ref = await this.referenceFor(props.referenceImageUrl);
    } catch {
      if (seq === this.seq) this.update({ status: "error", error: STAGE_ERRORS.referenceLoad });
      return;
    }
    if (seq !== this.seq) return;
    try {
      token = await createReactorToken(props.caseId, {
        planRevisionId: plan.id,
        clientRequestId: newClientRequestId(),
      });
    } catch (err) {
      if (seq === this.seq) this.update({ status: "error", error: stageErrorFrom(err) });
      return;
    }
    if (seq !== this.seq) {
      releaseLease(props.caseId, token.leaseId);
      return;
    }

    const now = performance.now();
    const s: LiveSession = {
      seq,
      caseId: props.caseId,
      referenceUrl: props.referenceImageUrl,
      video,
      preview: new X2Preview(video),
      leaseId: token.leaseId,
      still: ref.still,
      referenceBlob: ref.blob,
      startedAt: now,
      lastActivityAt: now,
      connected: false,
      fired: false,
      firstFrameSeen: false,
      busy: false,
      heartbeatFailures: 0,
      timers: [],
      unsubs: [],
    };
    this.session = s;
    this.queuedPlanId = plan.id;
    this.pendingPrompt = null;
    this.wire(s);

    try {
      await s.preview.connect(token.jwt, ref.still, actionOf(plan), plan.purpose);
      if (this.session !== s) return;
      s.connected = true;
      this.update({ status: "waiting_frames" });
      await s.preview.prepareRun(ref.blob);
      if (this.session !== s) return;
      await s.preview.fire(token.reactorPrompt);
      if (this.session !== s) return;
      s.fired = true;
      this.update({ activePlanId: plan.id });
      if (this.pendingPrompt) void this.pump(s); // plan changed while connecting
    } catch (err) {
      if (this.session !== s) return;
      await this.fail(stageErrorFrom(err));
    }
  }

  /** User Stop preview, and every automatic stop. */
  async stop(reason: StopReason = "user"): Promise<void> {
    this.seq += 1;
    const notice = reason in STOP_NOTICES ? STOP_NOTICES[reason as StopNoticeKey] : null;
    const hadSession = this.session !== null || this.view.status === "connecting";
    await this.teardown();
    if (hadSession || reason === "user") {
      this.update({ status: "idle", error: null, notice, idleMsLeft: null, activePlanId: null });
    }
  }

  continuePreview(): void {
    this.touch();
  }

  /** Explicit activity resets the 90 s idle timer. */
  touch(): void {
    if (!this.session) return;
    this.session.lastActivityAt = performance.now();
    if (this.view.idleMsLeft !== null) this.update({ idleMsLeft: null });
  }

  dismissNotice(): void {
    if (this.view.notice) this.update({ notice: null });
  }

  /** The live session a take can be captured from (generation running, output current). */
  getActive(): ActiveSession | null {
    const s = this.session;
    if (!s || !s.fired || s.preview.isClosed || this.view.activePlanId === null) return null;
    return {
      preview: s.preview,
      video: s.video,
      still: s.still,
      referenceBlob: s.referenceBlob,
      activePlanId: this.view.activePlanId,
    };
  }

  /** Capture in progress: no prompt updates, no idle/max stop, no source change. */
  setBusy(busy: boolean): void {
    if (!this.session) return;
    this.session.busy = busy;
    this.session.lastActivityAt = performance.now();
    if (busy) this.pendingPrompt = null;
  }

  /** Best-effort release when the page is going away (pagehide). */
  releaseOnPageHide(): void {
    const s = this.session;
    if (!s) return;
    releaseLeaseKeepalive(s.caseId, s.leaseId);
    void s.preview.close();
  }

  private update(patch: Partial<SessionView>): void {
    this.view = { ...this.view, ...patch };
    this.onChange(this.view);
  }

  private async referenceFor(url: string): Promise<{ blob: Blob; still: ImageBitmap }> {
    if (this.reference?.url === url) return this.reference;
    const loaded = await loadReference(url);
    this.reference = { url, ...loaded };
    return loaded;
  }

  private wire(s: LiveSession): void {
    const { preview } = s;
    s.unsubs.push(
      preview.on("frame", (frame) => {
        if (this.session !== s) return;
        if (frame.firstOfRun && !s.firstFrameSeen) {
          s.firstFrameSeen = true;
          if (!s.busy && this.view.status === "waiting_frames") this.update({ status: "live" });
        }
        const waiter = this.frameWaiter;
        if (waiter && frame.mediaTime > waiter.threshold) {
          this.frameWaiter = null;
          waiter.resolve();
        }
      }),
      preview.on("status", (status) => {
        if (this.session === s && s.connected && status === "disconnected") {
          void this.fail(STAGE_ERRORS.disconnected);
        }
      }),
      preview.on("outputEnded", () => {
        if (this.session === s && s.connected) void this.fail(STAGE_ERRORS.disconnected);
      }),
      preview.on("moderation", (action) => {
        if (this.session !== s) return;
        if (action === "terminate") void this.fail(STAGE_ERRORS.moderated);
        else this.update({ notice: MODERATION_WARNING });
      }),
    );

    const heartbeat = window.setInterval(() => void this.heartbeat(s), LIMITS.previewHeartbeatMs);
    const watchdog = window.setInterval(() => this.checkClock(s), 1000);
    s.timers.push(heartbeat, watchdog);
  }

  private async heartbeat(s: LiveSession): Promise<void> {
    const result = await heartbeatLease(s.caseId, s.leaseId);
    if (this.session !== s) return;
    s.heartbeatFailures = result === "transient" ? s.heartbeatFailures + 1 : 0;
    const lost = result === "lost" || s.heartbeatFailures >= 2;
    // Never cut a capture short for capacity bookkeeping; the capture ends the session itself.
    if (lost && !s.busy) void this.stop("lease");
  }

  private checkClock(s: LiveSession): void {
    if (this.session !== s) return;
    const verdict = evaluateSessionClock({
      now: performance.now(),
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      busy: s.busy,
    });
    if (verdict.kind === "stop") {
      void this.stop(verdict.reason);
    } else if (verdict.kind === "idle_warning") {
      const msLeft = Math.ceil(verdict.msLeft / 1000) * 1000;
      if (msLeft !== this.view.idleMsLeft) this.update({ idleMsLeft: msLeft });
    } else if (this.view.idleMsLeft !== null) {
      this.update({ idleMsLeft: null });
    }
  }

  /** Serialized prompt updates: one in flight, newest wins, live again only after a fresh frame. */
  private async pump(s: LiveSession): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pendingPrompt && this.session === s && !s.busy) {
        const next = this.pendingPrompt;
        this.pendingPrompt = null;
        this.update({ status: "updating" });
        const ok = await s.preview.correct(next.prompt, next.action);
        if (this.session !== s || s.busy) return;
        if (!ok) {
          this.update({ notice: CORRECTION_DECLINED });
          continue;
        }
        this.update({ activePlanId: next.planId });
        if (this.pendingPrompt) continue; // a newer revision is already waiting
        const threshold = s.preview.lastMediaTime;
        await new Promise<void>((resolve) => {
          this.frameWaiter = { threshold, resolve };
        });
      }
    } finally {
      this.pumping = false;
      if (this.session === s && !s.busy && this.view.status === "updating") {
        this.update({ status: s.firstFrameSeen ? "live" : "waiting_frames" });
      }
    }
  }

  private async fail(error: StageError): Promise<void> {
    this.seq += 1;
    await this.teardown();
    this.update({ status: "error", error, idleMsLeft: null, activePlanId: null });
  }

  /** Documented cleanup order, then lease release. Safe to call repeatedly. */
  private async teardown(): Promise<void> {
    const s = this.session;
    this.session = null;
    this.pendingPrompt = null;
    this.queuedPlanId = null;
    const waiter = this.frameWaiter;
    this.frameWaiter = null;
    waiter?.resolve();
    if (!s) return;
    for (const t of s.timers) window.clearInterval(t);
    for (const off of s.unsubs) off();
    await s.preview.close();
    releaseLease(s.caseId, s.leaseId);
  }
}
