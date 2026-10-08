import { useCallback, useEffect, useRef, useState } from "react";
import {
  LIMITS,
  PURPOSE_LABELS,
  type CreateTakeMeta,
  type PlanRevision,
  type Take,
} from "@symptomsketch/contracts";
import { errorMessage, uploadTake } from "@/lib/api";
import { newIdempotencyKey, newRunId } from "@/lib/ids";
import type { PreviewController, SessionView } from "@/features/preview/preview-controller";
import { STAGE_ERRORS, type StageError } from "@/features/preview/preview-errors";
import { clipReadiness, type ClipReadiness } from "./clip-window";
import type { RecordingSupport } from "./recorder";
import { createRollingRecorder, type RollingRecorder } from "./rolling-recorder";

export type ClipPhase = "idle" | "uploading" | "failed";

export interface ClipView {
  phase: ClipPhase;
  /** Null while nothing is recorded (preview not live, tab hidden, plan not current, take shown). */
  readiness: ClipReadiness | null;
  /** Length of the clip being saved, whole seconds. */
  savingSeconds: number | null;
  error: StageError | null;
  notice: string | null;
  canRetryUpload: boolean;
}

type ClipState = Omit<ClipView, "readiness">;

const IDLE: ClipState = {
  phase: "idle",
  savingSeconds: null,
  error: null,
  notice: null,
  canRetryUpload: false,
};

const SAVE_FAILED = "The clip could not be saved";
const EMPTY_CLIP = "Nothing was recorded for that clip. Try again in a few seconds.";
const TICK_MS = 250;

interface PendingUpload {
  caseId: string;
  blob: Blob;
  meta: CreateTakeMeta;
  seconds: number;
}

function sameReadiness(a: ClipReadiness | null, b: ClipReadiness | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "ready" && b.kind === "ready") return a.seconds === b.seconds;
  if (a.kind === "warming" && b.kind === "warming") return a.secondsLeft === b.secondsLeft;
  return true;
}

/**
 * Retroactive clips of the live preview. While the preview shows the current plan, the labelled
 * recording canvas records continuously (RollingRecorder); clip() saves the last N seconds, tagged
 * with the plan active at the click, and uploads it as a take. The X2 session is never reset,
 * replayed or stopped by clipping.
 */
export function useClipCapture(opts: {
  caseId: string;
  controller: PreviewController;
  session: SessionView;
  plan: PlanRevision | null;
  productLabel: string;
  generatedConcept: boolean;
  support: RecordingSupport;
  /** Recording allowed here: the case accepts takes and the stage is not showing a saved take. */
  enabled: boolean;
  onTakeUploaded(take: Take): void;
}): {
  view: ClipView;
  clip(): Promise<void>;
  retryUpload(): void;
  dismiss(): void;
  clearNotice(): void;
} {
  const { caseId, controller, session, plan, productLabel, generatedConcept } = opts;
  const [state, setState] = useState<ClipState>(IDLE);
  const [readiness, setReadiness] = useState<ClipReadiness | null>(null);
  const recRef = useRef<RollingRecorder | null>(null);
  const pendingRef = useRef<PendingUpload | null>(null);
  const busyRef = useRef(false);
  const onUploadedRef = useRef(opts.onTakeUploaded);
  const latest = useRef({ plan, session });
  useEffect(() => {
    onUploadedRef.current = opts.onTakeUploaded;
    latest.current = { plan, session };
  });

  const mimeType = opts.support.supported ? opts.support.mimeType : null;
  const current =
    plan !== null && plan.status === "ready" && plan.id === session.activePlanId ? plan : null;
  const recording =
    opts.enabled &&
    mimeType !== null &&
    current !== null &&
    session.outputSince !== null &&
    !session.hidden &&
    (session.status === "live" || session.status === "updating");
  // Each of these starts a fresh recording: new output epoch, new plan, or new burned-in labels.
  const outputSince = recording ? session.outputSince : null;
  const planId = recording && current ? current.id : null;
  const caption = current?.caption ?? "";
  const purpose = current?.purpose ?? null;

  useEffect(() => {
    if (outputSince === null || planId === null || mimeType === null || purpose === null) return;
    const active = controller.getActive();
    if (!active) return;
    let rec: RollingRecorder;
    try {
      rec = createRollingRecorder({
        video: active.video,
        still: active.still,
        labels: { purposeLabel: PURPOSE_LABELS[purpose], caption, productLabel, generatedConcept },
        mimeType,
        epoch: performance.now(),
      });
    } catch {
      return; // no 2d canvas: Clip stays unavailable rather than recording something unlabelled
    }
    recRef.current = rec;
    const off = controller.onFrame((frame) => rec.frame(frame.at));
    const timer = window.setInterval(() => {
      rec.tick();
      const next = clipReadiness(rec.availability());
      setReadiness((prev) => (sameReadiness(prev, next) ? prev : next));
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
      off();
      rec.dispose();
      if (recRef.current === rec) recRef.current = null;
      setReadiness(null);
    };
  }, [controller, outputSince, planId, caption, purpose, productLabel, generatedConcept, mimeType]);

  const upload = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    setState({ ...IDLE, phase: "uploading", savingSeconds: pending.seconds });
    try {
      const { take } = await uploadTake(pending.caseId, pending.blob, pending.meta);
      pendingRef.current = null;
      setState(IDLE);
      onUploadedRef.current(take);
    } catch (err) {
      // Same blob + same idempotency key on retry, so a lost response cannot duplicate the take.
      setState({
        ...IDLE,
        phase: "failed",
        error: { title: SAVE_FAILED, detail: errorMessage(err) },
        canRetryUpload: true,
      });
    }
  }, []);

  const clip = useCallback(async () => {
    const rec = recRef.current;
    // The plan whose output is on screen at the click; the clip is tagged with it.
    const { plan: tagged, session: at } = latest.current;
    if (!rec || busyRef.current || pendingRef.current) return;
    if (!tagged || tagged.status !== "ready" || tagged.id !== at.activePlanId) return;
    busyRef.current = true;
    try {
      const saved = await rec.clip();
      if (!saved) return;
      if (saved.blob.size === 0) {
        setState({ ...IDLE, notice: EMPTY_CLIP });
        return;
      }
      if (saved.blob.size > LIMITS.recordingMaxBytes) {
        setState({ ...IDLE, phase: "failed", error: STAGE_ERRORS.recordingTooLarge });
        return;
      }
      pendingRef.current = {
        caseId,
        blob: saved.blob,
        seconds: Math.round((saved.recordedDurationMs - saved.firstOutputOffsetMs) / 1000),
        meta: {
          purpose: tagged.purpose,
          planRevisionId: tagged.id,
          productRevisionId: tagged.productRevisionId,
          procedureRevisionId: tagged.procedureRevisionId,
          runId: newRunId(),
          captureStatus: "complete",
          captureReason: null,
          firstOutputOffsetMs: saved.firstOutputOffsetMs,
          recordedDurationMs: saved.recordedDurationMs,
          mimeType: saved.mimeType,
          caption: tagged.caption,
          idempotencyKey: newIdempotencyKey(),
        },
      };
    } finally {
      busyRef.current = false;
    }
    await upload();
  }, [caseId, upload]);

  const retryUpload = useCallback(() => void upload(), [upload]);
  const clearNotice = useCallback(() => setState((s) => ({ ...s, notice: null })), []);
  const dismiss = useCallback(() => {
    pendingRef.current = null;
    setState(IDLE);
  }, []);

  return { view: { ...state, readiness }, clip, retryUpload, dismiss, clearNotice };
}
