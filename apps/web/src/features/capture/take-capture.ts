import type { StillImage } from "@/features/preview/geometry";
import type { X2Preview } from "@/features/preview/x2-preview";
import {
  CaptureMachine,
  DEFAULT_CAPTURE_TIMINGS,
  startCaptureTicker,
  type CaptureOutcome,
  type CaptureSnapshot,
  type CaptureTimings,
} from "./capture-machine";
import { RecordingCompositor } from "./compositor";
import type { RecordingLabels } from "./labels";
import { startCanvasRecorder, type CanvasRecorder } from "./recorder";

export interface TakeCaptureInput {
  /** The live, connected preview. The capture resets its run but never changes its source track. */
  preview: X2Preview;
  /** The <video> decoding main_video. */
  video: HTMLVideoElement;
  /** Canonical reference, drawn while waiting for this run's first output. */
  still: StillImage;
  referenceBlob: Blob;
  /** Frozen plan prompt. */
  prompt: string;
  /** Frozen burned-in labels. */
  labels: RecordingLabels;
  mimeType: string;
  timings?: CaptureTimings;
  onPhase(phase: "armed" | "recording"): void;
  onProgress(snapshot: CaptureSnapshot): void;
}

export interface RecordedTake {
  kind: "recorded";
  blob: Blob;
  mimeType: string;
  outcome: CaptureOutcome;
  firstOutputOffsetMs: number | null;
  recordedDurationMs: number;
}

export type TakeCaptureResult = RecordedTake | { kind: "cancelled" };

/**
 * Record next take (spec 12, docs/providers/reactor-x2.md section 8):
 * reset -> re-apply reference -> START recorder (canvas shows the reference) -> THEN setPrompt ->
 * first fresh frame of the new run sets the offset -> 8 s of output (early stop after 4 s, max 12 s),
 * with the 20 s output-start deadline, 2 s stall, track-ended and 35 s hard-cap rules.
 */
export class TakeCapture {
  private readonly input: TakeCaptureInput;
  private readonly machine: CaptureMachine;
  private cancelled = false;
  private settle: ((outcome: CaptureOutcome) => void) | null = null;

  constructor(input: TakeCaptureInput) {
    this.input = input;
    this.machine = new CaptureMachine(input.timings ?? DEFAULT_CAPTURE_TIMINGS);
  }

  /** Early "Stop and review". False until 4 s of fresh output exist. */
  stopEarly(): boolean {
    const outcome = this.machine.requestStop(performance.now());
    if (!outcome) return false;
    this.settle?.(outcome);
    return true;
  }

  cancel(): void {
    this.cancelled = true;
    this.settle?.(this.machine.cancel());
  }

  async run(): Promise<TakeCaptureResult> {
    const { preview, video, still, labels, mimeType } = this.input;
    const compositor = new RecordingCompositor(video, still, labels);
    const unsubs: Array<() => void> = [];
    let stopTicker: () => void = () => undefined;
    let recorder: CanvasRecorder | null = null;
    let recorderStopped = false;
    try {
      this.input.onPhase("armed");
      compositor.start(); // reference + labels while the run is prepared
      await preview.reset(); // old output freezes; it is never drawn onto the recording canvas
      if (this.cancelled) return { kind: "cancelled" };
      await preview.prepareRun(this.input.referenceBlob);
      if (this.cancelled) return { kind: "cancelled" };

      recorder = startCanvasRecorder(compositor.canvas, mimeType);
      const startedAt = await recorder.started;
      if (this.cancelled) return { kind: "cancelled" };
      this.machine.start(startedAt);

      const outcomePromise = new Promise<CaptureOutcome>((resolve) => {
        this.settle = resolve;
      });
      const report = (outcome: CaptureOutcome | null) => {
        if (outcome) this.settle?.(outcome);
      };
      const baselineRun = preview.currentRunId;
      unsubs.push(
        preview.on("frame", (frame) => {
          if (frame.runId <= baselineRun) return; // stale or unattributed output
          compositor.drawOutputFrame();
          report(this.machine.frame(performance.now())); // timestamp at the actual draw
        }),
        preview.on("outputEnded", () => report(this.machine.trackEnded())),
        preview.on("status", (s) => {
          if (s === "disconnected") report(this.machine.trackEnded());
        }),
      );
      stopTicker = startCaptureTicker(
        this.machine,
        () => performance.now(),
        report,
        this.input.onProgress,
      );

      // The recorder is running; only now dispatch the action prompt.
      this.input.onPhase("recording");
      try {
        await preview.fire(this.input.prompt);
      } catch (err) {
        if (this.cancelled) return { kind: "cancelled" };
        throw err;
      }

      const outcome = await outcomePromise;
      stopTicker();
      if (outcome.status === "incomplete" && outcome.reason === "user_cancelled") {
        return { kind: "cancelled" };
      }
      const { blob, stoppedAt } = await recorder.stop();
      recorderStopped = true;
      return {
        kind: "recorded",
        blob,
        mimeType: recorder.mimeType,
        outcome,
        firstOutputOffsetMs: this.machine.firstOutputOffsetMs,
        recordedDurationMs: Math.max(0, Math.round(stoppedAt - startedAt)),
      };
    } finally {
      stopTicker();
      for (const off of unsubs) off();
      if (recorder && !recorderStopped) await recorder.stop().catch(() => undefined);
      compositor.stop();
      this.settle = null;
    }
  }
}
