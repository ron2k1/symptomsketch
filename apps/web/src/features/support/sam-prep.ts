import type { SupportCallPortraitSource } from "@symptomsketch/contracts";

/**
 * Background avatar prep for Sam (Reactor Vidu S2 Avatar). create_avatar takes 18-55 s on a live
 * session while attach_avatar takes about 1 s, so once a ticket exists the browser builds Sam's
 * avatar ahead of the click on a hidden session of its own, saves the avatar id with the portrait
 * it was built from, and disconnects. The real call then re-attaches the saved avatar.
 *
 * Every step is the same real provider work the call would do (Gemini brief, Nano Banana
 * portrait, Reactor create_avatar); prep only moves it earlier. One prep session at a time across
 * the page, and a real call stops it.
 */
export type SamPrepPhase = "idle" | "preparing" | "ready" | "failed" | "stopped";

export type SamPrepStep = "brief" | "portrait" | "building" | "rebuilding" | "waiting_composite";

export interface SamPrepView {
  ticketId: string | null;
  phase: SamPrepPhase;
  step: SamPrepStep | null;
  /** performance-style ms timestamp the current run started; the UI shows real elapsed time. */
  startedAt: number | null;
  /** When phase became "ready" (same clock as startedAt). */
  readyAt: number | null;
  /** The portrait the saved avatar was built from. */
  portraitSource: SupportCallPortraitSource | null;
  /** Measured create_avatar time of the last build. */
  avatarMs: number | null;
  error: string | null;
}

export const IDLE_PREP: SamPrepView = {
  ticketId: null,
  phase: "idle",
  step: null,
  startedAt: null,
  readyAt: null,
  portraitSource: null,
  avatarMs: null,
  error: null,
};

export interface PrepPortrait {
  blob: Blob;
  source: SupportCallPortraitSource;
}

export interface SamPrepDeps {
  /** Gemini call brief (cached per ticket server side); says which avatar is saved. */
  getBrief(
    ticketId: string,
    signal: AbortSignal,
  ): Promise<{ avatarId: string | null; avatarPortraitSource: SupportCallPortraitSource | null }>;
  /** Nano Banana composite when ready within the server's wait, else the base portrait. */
  getPortrait(ticketId: string, signal: AbortSignal): Promise<PrepPortrait>;
  /** Hidden Reactor session: token, connect, upload, create_avatar, avatar_ready, disconnect. */
  buildAvatar(
    ticketId: string,
    portrait: PrepPortrait,
    signal: AbortSignal,
  ): Promise<{ avatarId: string; avatarMs: number }>;
  saveAvatar(ticketId: string, avatarId: string, source: SupportCallPortraitSource): Promise<void>;
  now(): number;
  /** Resolves after ms, or rejects once the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

/** How often, and how many times, a base-portrait avatar re-checks for the composite. */
export const COMPOSITE_RECHECK_MS = 5_000;
export const COMPOSITE_RECHECKS = 2;

class Stopped extends Error {}

export class SamPrep {
  private view: SamPrepView = IDLE_PREP;
  private listeners = new Set<(view: SamPrepView) => void>();
  private abort: AbortController | null = null;
  /** Tickets whose prep a real call stopped: prep never restarts for them on this page. */
  private stoppedTickets = new Set<string>();

  constructor(private readonly deps: SamPrepDeps) {}

  get current(): SamPrepView {
    return this.view;
  }

  subscribe(listener: (view: SamPrepView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SamPrepView>): void {
    this.view = { ...this.view, ...patch };
    for (const l of [...this.listeners]) l(this.view);
  }

  /**
   * Start prep for a ticket the viewer can call on. Single flight: a run already going (for any
   * ticket), a ticket already prepared, and a ticket whose prep a real call stopped are no-ops.
   */
  start(ticketId: string): void {
    if (this.abort) return;
    if (this.stoppedTickets.has(ticketId)) return;
    if (this.view.ticketId === ticketId && this.view.phase === "ready") return;
    const abort = new AbortController();
    this.abort = abort;
    this.view = { ...IDLE_PREP, ticketId };
    this.set({ phase: "preparing", step: "brief", startedAt: this.deps.now() });
    void this.run(ticketId, abort.signal).finally(() => {
      if (this.abort === abort) this.abort = null;
    });
  }

  /** A real call is starting on this ticket: stop prep (its session disconnects) for good. */
  stop(ticketId: string): void {
    this.stoppedTickets.add(ticketId);
    if (this.view.ticketId !== ticketId) return;
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
      if (this.view.phase === "preparing") this.set({ phase: "stopped", step: null });
    }
  }

  private ensure(signal: AbortSignal): void {
    if (signal.aborted) throw new Stopped();
  }

  private async run(ticketId: string, signal: AbortSignal): Promise<void> {
    try {
      const brief = await this.deps.getBrief(ticketId, signal);
      this.ensure(signal);
      this.set({ step: "portrait" });
      let portrait = await this.deps.getPortrait(ticketId, signal);
      this.ensure(signal);
      if (brief.avatarId && brief.avatarPortraitSource === portrait.source) {
        this.ready(portrait.source, null);
      } else {
        await this.build(ticketId, portrait, "building", signal);
      }
      // Built from the base portrait because the composite was not ready yet: re-check a couple
      // of times and rebuild once if it lands.
      for (let i = 0; i < COMPOSITE_RECHECKS && portrait.source === "base"; i += 1) {
        await this.deps.sleep(COMPOSITE_RECHECK_MS, signal);
        this.ensure(signal);
        portrait = await this.deps.getPortrait(ticketId, signal);
        this.ensure(signal);
        if (portrait.source === "composite") {
          this.set({ phase: "preparing", step: "rebuilding", startedAt: this.deps.now() });
          await this.build(ticketId, portrait, "rebuilding", signal);
        }
      }
    } catch (err) {
      if (err instanceof Stopped || signal.aborted) return;
      const message = err instanceof Error && err.message ? err.message : "Prep failed.";
      this.set({ phase: "failed", step: null, error: message });
    }
  }

  private async build(
    ticketId: string,
    portrait: PrepPortrait,
    step: "building" | "rebuilding",
    signal: AbortSignal,
  ): Promise<void> {
    this.set({ phase: "preparing", step });
    const built = await this.deps.buildAvatar(ticketId, portrait, signal);
    this.ensure(signal);
    await this.deps.saveAvatar(ticketId, built.avatarId, portrait.source);
    this.ensure(signal);
    this.ready(portrait.source, built.avatarMs);
  }

  private ready(source: SupportCallPortraitSource, avatarMs: number | null): void {
    this.set({
      phase: "ready",
      step: null,
      portraitSource: source,
      readyAt: this.deps.now(),
      avatarMs: avatarMs ?? this.view.avatarMs,
      error: null,
    });
  }
}

/** The status line under "Talk to support now"; null hides it. */
export function prepStatusText(view: SamPrepView, now: number, agent: string): string | null {
  const clock = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const elapsed = view.startedAt === null ? "" : ` (${clock(now - view.startedAt)})`;
  switch (view.phase) {
    case "preparing": {
      const what =
        view.step === "brief"
          ? "reading the ticket"
          : view.step === "portrait"
            ? "getting the portrait"
            : view.step === "rebuilding"
              ? "rebuilding with your product"
              : "building avatar";
      return `Preparing ${agent} on Reactor: ${what}${elapsed}`;
    }
    case "ready":
      return `${agent} is ready`;
    case "failed":
      return `Could not prepare ${agent} in advance (${view.error ?? "error"}). Talk still works and builds the avatar when you call.`;
    default:
      return null;
  }
}
