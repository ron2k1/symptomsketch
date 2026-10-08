import type { StillImage } from "@/features/preview/geometry";
import {
  CLIP_WINDOW,
  ClipSchedule,
  clipOffsetMs,
  type ClipAvailability,
  type ClipWindowConfig,
  type SlotRestart,
} from "./clip-window";
import { RecordingCompositor } from "./compositor";
import type { RecordingLabels } from "./labels";
import { startCanvasRecorder, type CanvasRecorder } from "./recorder";

/** A finished clip, ready for uploadTake. */
export interface SavedClip {
  blob: Blob;
  mimeType: string;
  firstOutputOffsetMs: number;
  recordedDurationMs: number;
}

export interface RollingDeps {
  compositor: Pick<RecordingCompositor, "canvas" | "start" | "drawOutputFrame" | "stop">;
  startRecorder(canvas: HTMLCanvasElement, mimeType: string): CanvasRecorder;
  now(): number;
}

/**
 * Continuous recording of the labelled recording canvas while the preview is live. Recorders roll
 * on the ClipSchedule grid; clip() stops the longest valid one (a complete WebM ending now) and
 * restarts its slot. It never touches the X2 session: no reset, no replay, no stop.
 */
export class RollingRecorder {
  private readonly schedule: ClipSchedule;
  private readonly live: Array<{ generation: number; recorder: CanvasRecorder } | null>;
  private disposed = false;

  constructor(
    private readonly deps: RollingDeps,
    private readonly mimeType: string,
    epoch: number,
    config: ClipWindowConfig = CLIP_WINDOW,
  ) {
    this.schedule = new ClipSchedule(epoch, config);
    this.live = Array.from({ length: config.recorders }, () => null);
    deps.compositor.start();
    deps.compositor.drawOutputFrame(); // the preview is already live: output, not the reference
    this.tick();
  }

  /** A fresh X2 output frame: paint it into the recording canvas now and note when. */
  frame(at: number): void {
    if (this.disposed) return;
    this.deps.compositor.drawOutputFrame();
    this.schedule.frame(at);
  }

  /** Restarts the recorders that are due. Call a few times per second. */
  tick(): void {
    if (this.disposed) return;
    for (const due of this.schedule.due(this.deps.now())) {
      const old = this.replace(due);
      if (old) void old.stop(); // expired segment: its blob is dropped
    }
  }

  availability(): ClipAvailability {
    return this.schedule.availability(this.deps.now());
  }

  /** The last N seconds as one playable file, or null when no segment is ready. */
  async clip(): Promise<SavedClip | null> {
    if (this.disposed) return null;
    const pick = this.schedule.take(this.deps.now());
    if (!pick) return null;
    const old = this.replace(pick.restart);
    if (!old) return null;
    const { blob, stoppedAt } = await old.stop();
    return {
      blob,
      mimeType: old.mimeType,
      firstOutputOffsetMs: clipOffsetMs(pick),
      recordedDurationMs: Math.max(0, Math.round(stoppedAt - pick.startedAt)),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deps.compositor.stop();
    for (const entry of this.live.splice(0)) if (entry) void entry.recorder.stop();
  }

  /** Starts a new recorder in the slot and returns the one it replaces (still recording). */
  private replace(r: SlotRestart): CanvasRecorder | null {
    const old = this.live[r.slot]?.recorder ?? null;
    let recorder: CanvasRecorder;
    try {
      recorder = this.deps.startRecorder(this.deps.compositor.canvas, this.mimeType);
    } catch {
      this.live[r.slot] = null; // retried at the slot's next restart
      return old;
    }
    this.live[r.slot] = { generation: r.generation, recorder };
    recorder.started.then(
      (at) => {
        if (!this.disposed) this.schedule.started(r.slot, r.generation, at);
      },
      () => undefined, // never started: the slot stays unready until its next restart
    );
    return old;
  }
}

export function createRollingRecorder(opts: {
  video: HTMLVideoElement;
  still: StillImage;
  labels: RecordingLabels;
  mimeType: string;
  epoch: number;
}): RollingRecorder {
  const compositor = new RecordingCompositor(opts.video, opts.still, opts.labels);
  return new RollingRecorder(
    { compositor, startRecorder: startCanvasRecorder, now: () => performance.now() },
    opts.mimeType,
    opts.epoch,
  );
}
