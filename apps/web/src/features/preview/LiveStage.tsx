import { useEffect, useMemo, useRef, useState } from "react";
import {
  ERROR_COPY,
  LIMITS,
  PREVIEW_STATUS_COPY,
  PURPOSE_LABELS,
  takeShelfLabel,
  type PlanRevision,
  type PreviewStatus,
  type Purpose,
  type Take,
} from "@symptomsketch/contracts";
import { formatDuration, formatTakeNumber } from "@/lib/format";
import { checkRecordingSupport } from "@/features/capture/recorder";
import { useTakeCapture, type CapturePhase } from "@/features/capture/useTakeCapture";
import type { SessionStatus } from "./preview-controller";
import { StageControls } from "./StageControls";
import { StageScreen, type StageScreenProps } from "./StageScreen";
import { useX2Session } from "./useX2Session";

export type { PreviewStatus };

export interface LiveStageProps {
  caseId: string;
  purpose: Purpose;
  /** The plan whose reactorPrompt drives the preview (null until a ready plan exists). */
  plan: PlanRevision | null;
  /** Authorized media URL of the normalized product reference (source canvas input). */
  referenceImageUrl: string;
  productLabel: string;
  /** Quick Demo never uses generated concepts. */
  isGeneratedConcept: false;
  canRecord: boolean;
  onTakeUploaded(take: Take): void;
  onStatusChange?(status: PreviewStatus): void;
  /** When set, the stage shows that saved MP4 instead of the live preview. */
  selectedTake: Take | null;
  /** Temporarily show the real source image instead of generated output. */
  compareOriginal: boolean;
  /** Optional (additive): clears selectedTake so the stage returns to the live preview controls. */
  onExitTake?(): void;
}

const UNSUPPORTED = `${ERROR_COPY.RECORDING_UNSUPPORTED} Recording takes needs current desktop Chrome.`;
const NEEDS_PLAN = "The preview starts from a ready movement plan.";
const NEEDS_CURRENT_PLAN = "Recording unlocks once the preview shows the current plan.";
const RECORD_UNAVAILABLE = "Recording is not available for this case right now.";

function combineStatus(session: SessionStatus, capture: CapturePhase): PreviewStatus {
  if (capture === "armed" || capture === "recording" || capture === "uploading") return capture;
  if (capture === "failed") return "error";
  return session;
}

/**
 * Owner: web-preview. Live Reactor X2 preview (explicit Start preview only) + armed Record next
 * take (spec 6, 8, 12). Saved takes replace the live player; Compare original overlays the source.
 */
export function LiveStage(props: LiveStageProps) {
  const { caseId, plan, referenceImageUrl, selectedTake, productLabel } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const support = useMemo(() => checkRecordingSupport(), []);
  const { view: session, controller } = useX2Session({ caseId, plan, referenceImageUrl });
  const capture = useTakeCapture({
    caseId,
    controller,
    support,
    onTakeUploaded: props.onTakeUploaded,
  });
  const cv = capture.view;
  const [started, setStarted] = useState(false);

  const status = combineStatus(session.status, cv.phase);
  const statusCb = useRef(props.onStatusChange);
  useEffect(() => {
    statusCb.current = props.onStatusChange;
  });
  useEffect(() => {
    statusCb.current?.(status);
  }, [status]);

  // A selected saved take replaces live playback: end the (billed) live session.
  const takeId = selectedTake?.id ?? null;
  const capturing = cv.phase === "armed" || cv.phase === "recording";
  useEffect(() => {
    if (takeId && !capturing) void controller.stop("user");
    // `capturing` is read, not a dependency: only a take selection change stops the preview.
  }, [takeId, controller]);

  const planReady = plan !== null && plan.status === "ready" && plan.reactorPrompt !== null;
  const takeMode = selectedTake !== null;
  const sessionActive =
    status === "connecting" ||
    status === "waiting_frames" ||
    status === "live" ||
    status === "updating";
  const canStart =
    planReady &&
    support.canPreview &&
    !takeMode &&
    (status === "idle" || status === "error") &&
    !(cv.phase === "failed" && cv.canRetryUpload);
  const canRecord =
    status === "live" &&
    planReady &&
    plan.id === session.activePlanId &&
    props.canRecord &&
    support.supported &&
    cv.phase === "idle";

  const startHint = !support.canPreview
    ? UNSUPPORTED
    : !planReady
      ? NEEDS_PLAN
      : !support.supported
        ? UNSUPPORTED
        : null;
  const recordHint = canRecord
    ? null
    : !support.supported
      ? UNSUPPORTED
      : !planReady || plan.id !== session.activePlanId || status === "updating"
        ? NEEDS_CURRENT_PLAN
        : !props.canRecord
          ? RECORD_UNAVAILABLE
          : null;

  const error = cv.error ?? session.error;
  const statusText = takeMode
    ? `${formatTakeNumber(selectedTake.number)} · ${takeShelfLabel(selectedTake)}`
    : status === "recording"
      ? `Recording ${formatDuration(cv.elapsedSec * 1000)}`
      : status === "uploading" && cv.savingIncomplete
        ? "Saving the incomplete take"
        : status === "error"
          ? (error?.title ?? PREVIEW_STATUS_COPY.error)
          : status === "idle" && !started
            ? "Preview is off"
            : PREVIEW_STATUS_COPY[status];
  const detail =
    takeMode || status !== "recording"
      ? status === "error" && !takeMode
        ? (error?.detail ?? null)
        : null
      : cv.waitingForOutput
        ? "Waiting for the first generated frame"
        : `Generated output ${formatDuration(cv.outputSec * 1000)} of ${formatDuration(
            LIMITS.defaultCaptureSeconds * 1000,
          )}`;

  const showLiveVideo =
    status === "live" || status === "updating" || (status === "recording" && !cv.waitingForOutput);
  const overlay: StageScreenProps["overlay"] =
    status === "error" && error
      ? { kind: "error", title: error.title, detail: error.detail }
      : status === "connecting" || status === "waiting_frames" || status === "armed"
        ? { kind: "busy", title: PREVIEW_STATUS_COPY[status] }
        : status === "recording" && cv.waitingForOutput
          ? { kind: "busy", title: "Waiting for the first generated frame" }
          : status === "uploading"
            ? { kind: "busy", title: statusText }
            : null;

  const onStart = () => {
    const video = videoRef.current;
    if (!video || !canStart) return;
    setStarted(true);
    capture.dismiss();
    void controller.start(video);
  };
  const onRecord = () => {
    if (!canRecord || plan.reactorPrompt === null) return;
    controller.touch();
    void capture.record({
      plan: { ...plan, reactorPrompt: plan.reactorPrompt },
      labels: {
        purposeLabel: PURPOSE_LABELS[plan.purpose],
        caption: plan.caption,
        productLabel,
        generatedConcept: props.isGeneratedConcept,
      },
    });
  };

  return (
    <section
      aria-label="Stage"
      className="holo-tray flex flex-col gap-3 p-3 sm:p-4"
      data-case-id={caseId}
      data-purpose={props.purpose}
      data-plan-id={plan?.id ?? ""}
      data-status={status}
    >
      <StageScreen
        videoRef={videoRef}
        referenceImageUrl={referenceImageUrl}
        productLabel={productLabel}
        purposeLabel={PURPOSE_LABELS[selectedTake?.purpose ?? props.purpose]}
        showLiveVideo={showLiveVideo}
        isLive={showLiveVideo}
        take={
          selectedTake
            ? {
                id: selectedTake.id,
                number: selectedTake.number,
                mediaUrl: selectedTake.mediaUrl,
                stateLabel: takeShelfLabel(selectedTake),
              }
            : null
        }
        compareOriginal={props.compareOriginal}
        recordingSec={status === "recording" ? cv.elapsedSec : null}
        updating={status === "updating"}
        overlay={overlay}
      />
      <p className="sr-only" aria-live="polite">
        {takeMode
          ? `Showing ${formatTakeNumber(selectedTake.number)}`
          : PREVIEW_STATUS_COPY[status]}
      </p>
      <StageControls
        status={status}
        statusText={statusText}
        detail={detail}
        takeMode={takeMode}
        canStart={canStart}
        startHint={sessionActive ? null : startHint}
        canRecord={canRecord}
        recordHint={recordHint}
        capture={cv}
        idleMsLeft={session.idleMsLeft}
        notice={cv.notice ?? session.notice}
        onStart={onStart}
        onStop={() => void controller.stop("user")}
        onRecord={onRecord}
        onStopEarly={() => void capture.stopEarly()}
        onCancel={capture.cancel}
        onContinue={() => controller.continuePreview()}
        onRetryUpload={capture.retryUpload}
        onDismissNotice={() => {
          capture.clearNotice();
          controller.dismissNotice();
        }}
        onDiscard={capture.dismiss}
        onExitTake={props.onExitTake}
      />
    </section>
  );
}
