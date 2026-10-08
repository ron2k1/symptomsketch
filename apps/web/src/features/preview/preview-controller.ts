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
import { LIVE_COPY, LIVE_POLICY, evaluateLivePolicy, reconnectDelayMs } from "./live-policy";
import { STAGE_ERRORS, STOP_NOTICES, stageErrorFrom, type StageError } from "./preview-errors";
import { PreviewFailure, X2Preview, type FreshFrame } from "./x2-preview";
import { EMPTY_STATS, type LiveStats } from "./x2-stats";

export type SessionStatus = Extract<
  PreviewStatus,
  "idle" | "connecting" | "waiting_frames" | "live" | "updating" | "error"
>;

export interface SessionView {
  status: SessionStatus;
  error: StageError | null;
  /** One-line, non-error explanation (why the preview stopped, a declined correction, ...). */
  notice: string | null;
  /** Plan revision whose prompt the live output currently reflects. */
  activePlanId: string | null;
  /** A dropped or rotated X2 connection is being replaced; the preview resumes on its own. */
  reconnecting: boolean;
  /**
   * performance.now() of the first fresh frame showing the active plan in the current run. Null
   * while connecting, reconnecting, restarting or applying a new plan: clips start after it.
   */
  outputSince: number | null;
  /** performance.now() of the explicit Start; spans reconnects. Null while stopped. */
  startedAt: number | null;
  /** The tab is hidden (the preview stops after LIVE_POLICY.hiddenStopMs). */
  hidden: boolean;
  /** Measured numbers for the stage readout (null = not measured). */
  stats: LiveStats;
}

const STOPPED = {
  activePlanId: null,
  reconnecting: false,
  outputSince: null,
  startedAt: null,
  stats: EMPTY_STATS,
} as const satisfies Partial<SessionView>;

export const INITIAL_SESSION_VIEW: SessionView = {
  ...STOPPED,
  status: "idle",
  error: null,
  notice: null,
  hidden: false,
};

/** What clip capture borrows from the running preview (never its X2 session). */
export interface ActiveSession {
  video: HTMLVideoElement;
  still: ImageBitmap;
}

export interface PreviewProps {
  caseId: string;
  plan: PlanRevision | null;
  referenceImageUrl: string;
}

type StopReason = "user" | "case" | "unmount" | "lease" | "reference" | "hidden";

const STOP_NOTICE: Partial<Record<StopReason, string>> = {
  lease: STOP_NOTICES.lease,
  reference: STOP_NOTICES.reference,
  hidden: LIVE_COPY.hiddenStop,
};

type ReadyPlan = PlanRevision & { reactorPrompt: string };

/** One explicit Start until stop. Survives connection rotations and reconnects. */
interface Run {
  caseId: string;
  referenceUrl: string;
  video: HTMLVideoElement;
  still: ImageBitmap;
  referenceBlob: Blob;
  /** Plan whose prompt the output reflects; reapplied on reconnect. */
  activePlan: ReadyPlan | null;
  /** Consecutive unplanned drops; reset after LIVE_POLICY.stableAfterMs of output. */
  drops: number;
  /** First fresh frame of the current connection. */
  liveSince: number | null;
  reconnecting: boolean;
  /** Bumped per connection attempt so a stale token mint releases its lease and bails. */
  attempt: number;
  conn: Connection | null;
  watchdog: number;
  wake: number | null;
}

/** One token + lease + X2 session. */
interface Connection {
  preview: X2Preview;
  leaseId: string;
  openedAt: number;
  connected: boolean;
  fired: boolean;
  firstFrameSeen: boolean;
  /** Prompt X2 last accepted on this connection (Replay movement re-sends it). */
  prompt: string;
  pumping: boolean;
  heartbeatFailures: number;
  heartbeat: number;
  unsubs: Array<() => void>;
}

interface PendingPrompt {
  plan: ReadyPlan;
  prompt: string;
  action: SelectedAction | null;
  /** Replay movement: same plan, same prompt, as a fresh run on the same connection. */
  replay: boolean;
}

const CORRECTION_DECLINED =
  "Reactor X2 did not accept that update. The preview keeps the previous movement.";
const MODERATION_WARNING = "The provider flagged part of this request. Consider rephrasing it.";

/** The structured action that selects the motion sketch (null when the plan carries none). */
function actionOf(plan: PlanRevision | null): SelectedAction | null {
  const inner = (plan as { plan?: { selectedAction?: SelectedAction } } | null)?.plan;
  return inner?.selectedAction ?? null;
}

function isReadyPlan(plan: PlanRevision | null): plan is ReadyPlan {
  return plan !== null && plan.status === "ready" && typeof plan.reactorPrompt === "string";
}

/**
 * Imperative owner of the live X2 preview: explicit start only, then generation continues until
 * Stop, a case or reference change, lease loss, or a long-hidden tab. Connections rotate before the
 * server's lease cap and reconnect after provider drops, reapplying the current plan. React-free so
 * the hook stays thin; `onChange` receives a fresh view object on every change.
 */
export class PreviewController {
  private readonly onChange: (view: SessionView) => void;
  private view: SessionView = INITIAL_SESSION_VIEW;
  private props: PreviewProps | null = null;
  private run: Run | null = null;
  private seq = 0;
  private hiddenSince: number | null = null;
  private reference: { url: string; blob: Blob; still: ImageBitmap } | null = null;
  private pendingPrompt: PendingPrompt | null = null;
  private queuedPlanId: string | null = null;
  private frameWaiter: { accept: (f: FreshFrame) => boolean; resolve: () => void } | null = null;
  private readonly frameListeners = new Set<(frame: FreshFrame) => void>();

  constructor(onChange: (view: SessionView) => void) {
    this.onChange = onChange;
  }

  get current(): SessionView {
    return this.view;
  }

  setProps(next: PreviewProps): void {
    const prev = this.props;
    this.props = next;
    const run = this.run;
    if (!run) return;
    if (prev && next.caseId !== run.caseId) {
      void this.stop("case");
      return;
    }
    if (next.referenceImageUrl !== run.referenceUrl) {
      void this.stop("reference");
      return;
    }
    if (isReadyPlan(next.plan) && next.plan.id !== this.queuedPlanId) {
      this.queuedPlanId = next.plan.id;
      this.pendingPrompt = {
        plan: next.plan,
        prompt: next.plan.reactorPrompt,
        action: actionOf(next.plan),
        replay: false,
      };
      const conn = run.conn;
      if (conn?.fired) void this.pump(run, conn);
    }
  }

  /** Explicit user action only (never on mount). */
  async start(video: HTMLVideoElement): Promise<void> {
    const props = this.props;
    if (!props || this.run || this.view.status === "connecting") return;
    if (!isReadyPlan(props.plan)) return;
    const seq = ++this.seq;
    this.update({ ...STOPPED, status: "connecting", error: null, notice: null });
    let ref: { blob: Blob; still: ImageBitmap };
    try {
      ref = await this.referenceFor(props.referenceImageUrl);
    } catch {
      if (seq === this.seq) this.update({ status: "error", error: STAGE_ERRORS.referenceLoad });
      return;
    }
    if (seq !== this.seq) return;
    const run: Run = {
      caseId: props.caseId,
      referenceUrl: props.referenceImageUrl,
      video,
      still: ref.still,
      referenceBlob: ref.blob,
      activePlan: null,
      drops: 0,
      liveSince: null,
      reconnecting: false,
      attempt: 0,
      conn: null,
      watchdog: 0,
      wake: null,
    };
    run.watchdog = window.setInterval(() => this.checkPolicy(run), 1000);
    this.run = run;
    this.update({ startedAt: performance.now() });
    await this.open(run);
  }

  /** User Stop preview, and every automatic stop. */
  async stop(reason: StopReason = "user"): Promise<void> {
    this.seq += 1;
    const hadRun = this.run !== null || this.view.status === "connecting";
    await this.teardown();
    if (hadRun || reason === "user") {
      this.update({ ...STOPPED, status: "idle", error: null, notice: STOP_NOTICE[reason] ?? null });
    }
  }

  /**
   * Replays the active plan's movement on the running session (no new token): a fresh run on the
   * same connection, from the still pose.
   */
  replayMovement(): void {
    const run = this.run;
    const conn = run?.conn;
    if (!run || !conn?.fired || !run.activePlan || this.pendingPrompt) return;
    this.pendingPrompt = {
      plan: run.activePlan,
      prompt: conn.prompt,
      action: actionOf(run.activePlan),
      replay: true,
    };
    void this.pump(run, conn);
  }

  /** Page Visibility: a hidden tab stops the preview after LIVE_POLICY.hiddenStopMs. */
  setHidden(hidden: boolean): void {
    if (hidden && this.hiddenSince === null) this.hiddenSince = performance.now();
    if (!hidden) this.hiddenSince = null;
    if (this.view.hidden !== hidden) this.update({ hidden });
  }

  /** Fresh output frames of the current run (clip capture). Returns an unsubscribe. */
  onFrame(fn: (frame: FreshFrame) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  dismissNotice(): void {
    if (this.view.notice) this.update({ notice: null });
  }

  /** The running preview a clip can be recorded from. */
  getActive(): ActiveSession | null {
    const run = this.run;
    if (!run?.conn?.fired) return null;
    return { video: run.video, still: run.still };
  }

  /** Best-effort release when the page is going away (pagehide). */
  releaseOnPageHide(): void {
    const run = this.run;
    if (!run) return;
    if (run.conn) releaseLeaseKeepalive(run.caseId, run.conn.leaseId);
    void this.stop("unmount");
  }

  private update(patch: Partial<SessionView>): void {
    this.view = { ...this.view, ...patch };
    this.onChange(this.view);
  }

  private setStats(patch: Partial<LiveStats>): void {
    const prev = this.view.stats;
    const next = { ...prev, ...patch };
    const same = (Object.keys(next) as Array<keyof LiveStats>).every((k) => next[k] === prev[k]);
    if (!same) this.update({ stats: next });
  }

  private async referenceFor(url: string): Promise<{ blob: Blob; still: ImageBitmap }> {
    if (this.reference?.url === url) return this.reference;
    const loaded = await loadReference(url);
    this.reference = { url, ...loaded };
    return loaded;
  }

  /**
   * Token + lease, then connect -> reference -> prompt with the newest ready plan. While the current
   * plan waits on a clarification the server still accepts the plan on screen (its newest ready
   * ancestor), so rotations and reconnects keep using it.
   */
  private async open(run: Run): Promise<void> {
    const latest = this.props?.plan ?? null;
    const plan = isReadyPlan(latest) ? latest : run.activePlan;
    if (!plan) {
      // Nothing ever fired and no plan is ready: say so instead of waiting forever.
      await this.fail(STAGE_ERRORS.planNotReady);
      return;
    }
    const attempt = ++run.attempt;
    const current = () => this.run === run && run.attempt === attempt;
    const openedAt = performance.now();
    let token: ReactorTokenResponse;
    try {
      token = await createReactorToken(run.caseId, {
        planRevisionId: plan.id,
        clientRequestId: newClientRequestId(),
      });
    } catch (err) {
      if (current()) await this.openFailed(run, stageErrorFrom(err));
      return;
    }
    if (!current()) {
      releaseLease(run.caseId, token.leaseId);
      return;
    }

    const conn: Connection = {
      preview: new X2Preview(run.video),
      leaseId: token.leaseId,
      openedAt,
      connected: false,
      fired: false,
      firstFrameSeen: false,
      prompt: token.reactorPrompt,
      pumping: false,
      heartbeatFailures: 0,
      heartbeat: 0,
      unsubs: [],
    };
    run.conn = conn;
    this.queuedPlanId = plan.id;
    this.pendingPrompt = null;
    this.wire(run, conn);

    try {
      await conn.preview.connect(token.jwt, run.still, actionOf(plan), plan.purpose);
      if (run.conn !== conn) return;
      conn.connected = true;
      this.update({ status: "waiting_frames" });
      await conn.preview.prepareRun(run.referenceBlob);
      if (run.conn !== conn) return;
      await conn.preview.fire(token.reactorPrompt);
      if (run.conn !== conn) return;
      conn.fired = true;
      run.activePlan = plan;
      this.update({ activePlanId: plan.id });
      if (this.pendingPrompt) void this.pump(run, conn); // plan changed while connecting
    } catch (err) {
      if (run.conn !== conn) return;
      await this.openFailed(run, stageErrorFrom(err));
    }
  }

  /** The first connection of a Start fails visibly; a reconnect retries with backoff first. */
  private async openFailed(run: Run, error: StageError): Promise<void> {
    if (run.reconnecting) this.reconnect(run, "dropped", error);
    else await this.fail(error);
  }

  private wire(run: Run, conn: Connection): void {
    const { preview } = conn;
    const mine = () => run.conn === conn;
    conn.unsubs.push(
      preview.on("frame", (frame) => {
        if (mine()) this.onFreshFrame(run, conn, frame);
      }),
      preview.on("status", (status) => {
        if (mine() && conn.connected && status === "disconnected") this.reconnect(run, "dropped");
      }),
      preview.on("outputEnded", () => {
        if (mine() && conn.connected) this.reconnect(run, "dropped");
      }),
      preview.on("moderation", (action) => {
        if (!mine()) return;
        if (action === "terminate") void this.fail(STAGE_ERRORS.moderated);
        else this.update({ notice: MODERATION_WARNING });
      }),
      preview.on("stats", (link) => {
        if (mine()) this.setStats(link);
      }),
      preview.on("promptAck", ({ ms }) => {
        if (mine()) this.setStats({ appliedMs: ms });
      }),
    );
    conn.heartbeat = window.setInterval(
      () => void this.heartbeat(run, conn),
      LIMITS.previewHeartbeatMs,
    );
  }

  private onFreshFrame(run: Run, conn: Connection, frame: FreshFrame): void {
    if (frame.firstOfRun && !conn.firstFrameSeen) {
      conn.firstFrameSeen = true;
      run.reconnecting = false;
      run.liveSince = frame.at;
      this.update(
        this.view.status === "waiting_frames"
          ? { status: "live", reconnecting: false }
          : { reconnecting: false },
      );
    }
    const waiter = this.frameWaiter;
    if (waiter?.accept(frame)) {
      this.frameWaiter = null;
      waiter.resolve();
    }
    if (frame.runId === 0) return; // not attributable to the current run
    if (this.view.outputSince === null && this.view.status === "live") {
      this.update({ outputSince: frame.at });
    }
    for (const fn of [...this.frameListeners]) fn(frame);
  }

  private async heartbeat(run: Run, conn: Connection): Promise<void> {
    const result = await heartbeatLease(run.caseId, conn.leaseId);
    if (run.conn !== conn) return;
    conn.heartbeatFailures = result === "transient" ? conn.heartbeatFailures + 1 : 0;
    // Lost means another tab took the lease or the server ended it: stop, never fight over it.
    if (result === "lost" || conn.heartbeatFailures >= 2) void this.stop("lease");
  }

  private checkPolicy(run: Run): void {
    if (this.run !== run) return;
    const now = performance.now();
    if (
      run.drops > 0 &&
      run.liveSince !== null &&
      now - run.liveSince >= LIVE_POLICY.stableAfterMs
    ) {
      run.drops = 0;
    }
    const conn = run.conn;
    const verdict = evaluateLivePolicy({
      now,
      connectionOpenedAt: conn?.openedAt ?? null,
      hiddenSince: this.hiddenSince,
      reconnecting: run.reconnecting || !conn?.fired,
    });
    if (verdict.kind === "stop") void this.stop(verdict.reason);
    else if (verdict.kind === "rotate") this.reconnect(run, "rotate");
  }

  /**
   * Replaces the connection: close it and release its lease now, then mint a fresh token after the
   * backoff. Rotation (planned) waits 0 ms; repeated unplanned drops give up with `error`.
   */
  private reconnect(
    run: Run,
    cause: "rotate" | "dropped",
    error: StageError = STAGE_ERRORS.disconnected,
  ): void {
    if (this.run !== run) return;
    if (cause === "dropped") run.drops += 1;
    const delay = reconnectDelayMs(cause === "rotate" ? 0 : run.drops);
    if (delay === null) {
      void this.fail(error);
      return;
    }
    run.reconnecting = true;
    run.liveSince = null;
    run.attempt += 1;
    this.pendingPrompt = null;
    this.queuedPlanId = null;
    this.releaseWaiter();
    const old = run.conn;
    run.conn = null;
    if (run.wake !== null) window.clearTimeout(run.wake);
    this.update({
      status: "connecting",
      error: null,
      reconnecting: true,
      outputSince: null,
      stats: { ...EMPTY_STATS, appliedMs: this.view.stats.appliedMs },
    });
    // The reopen must not depend on the old session closing cleanly, or at all: after a network
    // drop the SDK's disconnect can hang behind its own connect.
    const closing = Promise.race([
      (old ? this.closeConnection(run, old) : Promise.resolve()).catch(() => undefined),
      new Promise<void>((resolve) => window.setTimeout(resolve, LIVE_POLICY.closeWaitMs)),
    ]);
    run.wake = window.setTimeout(() => {
      run.wake = null;
      void closing.then(() => {
        if (this.run === run && run.conn === null) void this.open(run);
      });
    }, delay);
  }

  private async closeConnection(run: Run, conn: Connection): Promise<void> {
    window.clearInterval(conn.heartbeat);
    for (const off of conn.unsubs.splice(0)) off();
    await conn.preview.close();
    releaseLease(run.caseId, conn.leaseId);
  }

  /** Serialized prompt updates: one in flight, newest wins, live again only after a fresh frame. */
  private async pump(run: Run, conn: Connection): Promise<void> {
    if (conn.pumping) return;
    conn.pumping = true;
    const mine = () => this.run === run && run.conn === conn;
    try {
      while (this.pendingPrompt && mine()) {
        const next = this.pendingPrompt;
        this.pendingPrompt = null;
        this.update({ status: "updating" });
        // Replay, and any change on a sketched product, starts a fresh run from the still.
        if (next.replay || conn.preview.sketches(next.action)) {
          if (!(await this.restartRun(run, conn, next))) return;
          continue;
        }
        const ok = await conn.preview.correct(next.prompt, next.action);
        if (!mine()) return;
        if (!ok) {
          this.update({ notice: CORRECTION_DECLINED });
          continue;
        }
        conn.prompt = next.prompt;
        if (!next.replay) {
          // Output before this point shows the previous plan: clips restart from the next frame.
          run.activePlan = next.plan;
          this.update({ activePlanId: next.plan.id, outputSince: null });
        }
        if (this.pendingPrompt) continue; // a newer revision is already waiting
        const threshold = conn.preview.lastMediaTime;
        await this.waitFrame((f) => f.mediaTime > threshold);
      }
    } finally {
      conn.pumping = false;
      if (mine() && this.view.status === "updating") {
        this.update({ status: conn.firstFrameSeen ? "live" : "waiting_frames" });
      }
    }
  }

  /**
   * A fresh run on the same connection (Replay, or a new plan on a sketched product). False when
   * the pump must end.
   */
  private async restartRun(run: Run, conn: Connection, next: PendingPrompt): Promise<boolean> {
    this.update({ outputSince: null });
    let runId: number;
    try {
      runId = await conn.preview.restartRun(run.referenceBlob, next.prompt, next.action);
    } catch (err) {
      if (run.conn !== conn) return false;
      const declined = err instanceof PreviewFailure && err.step === "prompt";
      if (declined && !next.replay && run.activePlan) {
        // X2 refused the new plan after the reset: bring the previous movement back.
        this.update({ notice: CORRECTION_DECLINED });
        this.pendingPrompt ??= {
          plan: run.activePlan,
          prompt: conn.prompt,
          action: actionOf(run.activePlan),
          replay: true,
        };
        return true;
      }
      // reset() already stopped generation: recover with a fresh connection.
      this.reconnect(run, "dropped");
      return false;
    }
    if (run.conn !== conn) return false;
    conn.prompt = next.prompt;
    if (!next.replay) {
      run.activePlan = next.plan;
      this.update({ activePlanId: next.plan.id });
    }
    if (!this.pendingPrompt) await this.waitFrame((f) => f.runId === runId);
    return true;
  }

  private waitFrame(accept: (f: FreshFrame) => boolean): Promise<void> {
    this.releaseWaiter();
    return new Promise<void>((resolve) => {
      this.frameWaiter = { accept, resolve };
    });
  }

  private releaseWaiter(): void {
    const waiter = this.frameWaiter;
    this.frameWaiter = null;
    waiter?.resolve();
  }

  private async fail(error: StageError): Promise<void> {
    this.seq += 1;
    await this.teardown();
    this.update({ ...STOPPED, status: "error", error });
  }

  /** Documented cleanup order, then lease release. Safe to call repeatedly. */
  private async teardown(): Promise<void> {
    const run = this.run;
    this.run = null;
    this.pendingPrompt = null;
    this.queuedPlanId = null;
    this.releaseWaiter();
    if (!run) return;
    window.clearInterval(run.watchdog);
    if (run.wake !== null) window.clearTimeout(run.wake);
    run.wake = null;
    run.attempt += 1;
    const conn = run.conn;
    run.conn = null;
    if (conn) await this.closeConnection(run, conn);
  }
}
