import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAPTURE_REASON_LABELS,
  ERROR_COPY,
  LIMITS,
  type CreateTakeMeta,
  type PlanRevision,
  type Take,
} from "@symptomsketch/contracts";
import { errorMessage, uploadTake } from "@/lib/api";
import { newIdempotencyKey, newRunId } from "@/lib/ids";
import type { PreviewController } from "@/features/preview/preview-controller";
import { STAGE_ERRORS, stageErrorFrom, type StageError } from "@/features/preview/preview-errors";
import type { CaptureSnapshot } from "./capture-machine";
import type { RecordingLabels } from "./labels";
import type { RecordingSupport } from "./recorder";
import { TakeCapture } from "./take-capture";

export type CapturePhase = "idle" | "armed" | "recording" | "uploading" | "failed";

export interface CaptureView {
  phase: CapturePhase;
  /** Whole seconds since the recorder started. */
  elapsedSec: number;
  /** Whole seconds of generated output recorded so far. */
  outputSec: number;
  waitingForOutput: boolean;
  canStopEarly: boolean;
  /** The take being saved is incomplete (no MP4 will be produced). */
  savingIncomplete: boolean;
  error: StageError | null;
  notice: string | null;
  canRetryUpload: boolean;
}

const IDLE_VIEW: CaptureView = {
  phase: "idle",
  elapsedSec: 0,
  outputSec: 0,
  waitingForOutput: false,
  canStopEarly: false,
  savingIncomplete: false,
  error: null,
  notice: null,
  canRetryUpload: false,
};

const SAVE_FAILED = "The take could not be saved";
const EMPTY_RECORDING = "Nothing was recorded. Start the preview and record another take.";

/** Plan + labels frozen at the moment Record next take is pressed (spec 12). */
export interface FrozenTake {
  plan: PlanRevision & { reactorPrompt: string };
  labels: RecordingLabels;
}

interface PendingUpload {
  caseId: string;
  blob: Blob;
  meta: CreateTakeMeta;
}

export function useTakeCapture(opts: {
  caseId: string;
  controller: PreviewController;
  support: RecordingSupport;
  onTakeUploaded(take: Take): void;
}) {
  const { caseId, controller, support } = opts;
  const [view, setView] = useState<CaptureView>(IDLE_VIEW);
  const captureRef = useRef<TakeCapture | null>(null);
  const pendingRef = useRef<PendingUpload | null>(null);
  const onUploadedRef = useRef(opts.onTakeUploaded);
  useEffect(() => {
    onUploadedRef.current = opts.onTakeUploaded;
  });

  const patch = useCallback((p: Partial<CaptureView>) => setView((v) => ({ ...v, ...p })), []);

  const onProgress = useCallback((snap: CaptureSnapshot) => {
    const next = {
      elapsedSec: Math.floor(snap.elapsedMs / 1000),
      outputSec: Math.floor(snap.outputMs / 1000),
      waitingForOutput: snap.phase === "waiting_output",
      canStopEarly: snap.canStopEarly,
    };
    setView((v) =>
      v.elapsedSec === next.elapsedSec &&
      v.outputSec === next.outputSec &&
      v.waitingForOutput === next.waitingForOutput &&
      v.canStopEarly === next.canStopEarly
        ? v
        : { ...v, ...next },
    );
  }, []);

  const upload = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    const incomplete = pending.meta.captureStatus === "incomplete";
    setView({ ...IDLE_VIEW, phase: "uploading", savingIncomplete: incomplete });
    try {
      const { take } = await uploadTake(pending.caseId, pending.blob, pending.meta);
      pendingRef.current = null;
      const reason = pending.meta.captureReason;
      setView({
        ...IDLE_VIEW,
        notice:
          incomplete && reason
            ? `${CAPTURE_REASON_LABELS[reason]}. ${ERROR_COPY.CAPTURE_INCOMPLETE}`
            : null,
      });
      onUploadedRef.current(take);
    } catch (err) {
      // Same blob + same idempotency key on retry, so a lost response cannot duplicate the take.
      setView({
        ...IDLE_VIEW,
        phase: "failed",
        error: { title: SAVE_FAILED, detail: errorMessage(err) },
        canRetryUpload: true,
      });
    }
  }, []);

  const record = useCallback(
    async (frozen: FrozenTake) => {
      if (captureRef.current || !support.supported || !support.mimeType) return;
      const active = controller.getActive();
      if (!active || active.activePlanId !== frozen.plan.id) return;
      const runId = newRunId();
      controller.setBusy(true);
      const capture = new TakeCapture({
        preview: active.preview,
        video: active.video,
        still: active.still,
        referenceBlob: active.referenceBlob,
        prompt: frozen.plan.reactorPrompt,
        labels: frozen.labels,
        mimeType: support.mimeType,
        onPhase: (phase) => setView({ ...IDLE_VIEW, phase, waitingForOutput: true }),
        onProgress,
      });
      captureRef.current = capture;

      let result: Awaited<ReturnType<TakeCapture["run"]>>;
      try {
        result = await capture.run();
      } catch (err) {
        captureRef.current = null;
        await controller.stop("captured");
        setView({ ...IDLE_VIEW, phase: "failed", error: stageErrorFrom(err) });
        return;
      }
      captureRef.current = null;
      if (result.kind === "recorded") patch({ phase: "uploading" });
      await controller.stop("captured"); // spec 8: stop the preview after capture

      if (result.kind === "cancelled") {
        setView({ ...IDLE_VIEW, notice: CAPTURE_REASON_LABELS.user_cancelled });
        return;
      }
      if (result.blob.size === 0) {
        setView({ ...IDLE_VIEW, notice: EMPTY_RECORDING });
        return;
      }
      if (result.blob.size > LIMITS.recordingMaxBytes) {
        setView({ ...IDLE_VIEW, phase: "failed", error: STAGE_ERRORS.recordingTooLarge });
        return;
      }
      const { outcome } = result;
      pendingRef.current = {
        caseId,
        blob: result.blob,
        meta: {
          purpose: frozen.plan.purpose,
          planRevisionId: frozen.plan.id,
          productRevisionId: frozen.plan.productRevisionId,
          procedureRevisionId: frozen.plan.procedureRevisionId,
          runId,
          captureStatus: outcome.status,
          captureReason: outcome.status === "incomplete" ? outcome.reason : null,
          firstOutputOffsetMs: result.firstOutputOffsetMs,
          recordedDurationMs: result.recordedDurationMs,
          mimeType: result.mimeType,
          caption: frozen.plan.caption,
          idempotencyKey: newIdempotencyKey(),
        },
      };
      await upload();
    },
    [caseId, controller, support, onProgress, patch, upload],
  );

  const stopEarly = useCallback(() => captureRef.current?.stopEarly() ?? false, []);
  const cancel = useCallback(() => captureRef.current?.cancel(), []);
  const retryUpload = useCallback(() => void upload(), [upload]);
  const clearNotice = useCallback(() => patch({ notice: null }), [patch]);
  const dismiss = useCallback(() => {
    pendingRef.current = null;
    setView(IDLE_VIEW);
  }, []);

  // Leaving Recreate / unmount mid-capture cancels it (an in-flight upload still completes).
  useEffect(() => () => captureRef.current?.cancel(), []);

  return { view, record, stopEarly, cancel, retryUpload, dismiss, clearNotice };
}
