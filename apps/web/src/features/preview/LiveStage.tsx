import { useEffect, useMemo, useRef, useState } from "react";
import {
  ERROR_COPY,
  PREVIEW_STATUS_COPY,
  PURPOSE_LABELS,
  takeShelfLabel,
  type PlanRevision,
  type PreviewStatus,
  type Purpose,
  type Take,
} from "@symptomsketch/contracts";
import { formatTakeNumber } from "@/lib/format";
import { checkRecordingSupport } from "@/features/capture/recorder";
import { useClipCapture } from "@/features/capture/useClipCapture";
import { LIVE_COPY } from "./live-policy";
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

const UNSUPPORTED = `${ERROR_COPY.RECORDING_UNSUPPORTED} Clipping needs current desktop Chrome.`;
const NEEDS_PLAN = "The preview starts from a ready movement plan.";
const NEEDS_CURRENT_PLAN = "Clipping unlocks once the preview shows the current plan.";
const RECORD_UNAVAILABLE = "Clipping is not available for this case right now.";
const WAITING_OUTPUT = "Waiting for fresh Reactor X2 output before clipping.";
const SAVING_CLIP = "Saving the clip";

/**
 * Owner: web-preview. Live Reactor X2 preview (explicit Start preview only) that keeps generating
 * until stopped, with retroactive "Clip last N s" takes (spec 6, 8, 12). Saved takes replace the
 * live player while the session keeps running; Compare original overlays the source.
 */
export function LiveStage(props: LiveStageProps) {
  const { caseId, plan, referenceImageUrl, selectedTake, productLabel } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const support = useMemo(() => checkRecordingSupport(), []);
  const { view: session, controller } = useX2Session({ caseId, plan, referenceImageUrl });
  const takeMode = selectedTake !== null;
  const capture = useClipCapture({
    caseId,
    controller,
    session,
    plan,
    productLabel,
    generatedConcept: props.isGeneratedConcept,
    support,
    enabled: props.canRecord && !takeMode,
    onTakeUploaded: props.onTakeUploaded,
  });
  const cv = capture.view;
  const [started, setStarted] = useState(false);

  // Clipping never interrupts the session, so the stage reports the save on top of it.
  const status: PreviewStatus = cv.phase === "uploading" ? "uploading" : session.status;
  const statusCb = useRef(props.onStatusChange);
  useEffect(() => {
    statusCb.current = props.onStatusChange;
  });
  useEffect(() => {
    statusCb.current?.(status);
  }, [status]);

  const planReady = plan !== null && plan.status === "ready" && plan.reactorPrompt !== null;
  const planCurrent = planReady && plan.id === session.activePlanId;
  const sessionActive =
    session.status === "connecting" ||
    session.status === "waiting_frames" ||
    session.status === "live" ||
    session.status === "updating";
  const canStart =
    planReady &&
    support.canPreview &&
    !takeMode &&
    (session.status === "idle" || session.status === "error");
  const canReplay = session.status === "live" && planCurrent && !session.reconnecting;

  const startHint = !support.canPreview
    ? UNSUPPORTED
    : !planReady
      ? NEEDS_PLAN
      : !support.supported
        ? UNSUPPORTED
        : null;
  const clipHint = !support.supported
    ? UNSUPPORTED
    : !props.canRecord
      ? RECORD_UNAVAILABLE
      : session.reconnecting || session.status === "connecting"
        ? null
        : !planCurrent
          ? NEEDS_CURRENT_PLAN
          : cv.readiness?.kind === "stalled"
            ? WAITING_OUTPUT
            : null;

  const error = session.error;
  const statusText = takeMode
    ? `${formatTakeNumber(selectedTake.number)} · ${takeShelfLabel(selectedTake)}`
    : cv.phase === "uploading"
      ? cv.savingSeconds !== null
        ? `${SAVING_CLIP} (${cv.savingSeconds} s)`
        : SAVING_CLIP
      : session.status === "error"
        ? (error?.title ?? PREVIEW_STATUS_COPY.error)
        : session.reconnecting
          ? LIVE_COPY.reconnecting
          : session.status === "idle" && !started
            ? "Preview is off"
            : PREVIEW_STATUS_COPY[session.status];
  const detail = takeMode
    ? null
    : cv.phase === "failed" && cv.error
      ? `${cv.error.title}. ${cv.error.detail}`
      : session.status === "error"
        ? (error?.detail ?? null)
        : session.reconnecting
          ? LIVE_COPY.reconnectingDetail
          : null;

  const showLiveVideo = session.status === "live" || session.status === "updating";
  const overlay: StageScreenProps["overlay"] =
    session.status === "error" && error
      ? { kind: "error", title: error.title, detail: error.detail }
      : session.status === "connecting" || session.status === "waiting_frames"
        ? session.reconnecting
          ? { kind: "busy", title: LIVE_COPY.reconnecting, detail: LIVE_COPY.reconnectingDetail }
          : { kind: "busy", title: PREVIEW_STATUS_COPY[session.status] }
        : null;
  // The Rec pill shows how much live output a clip would save right now.
  const recordingSec = !takeMode && cv.readiness?.kind === "ready" ? cv.readiness.seconds : null;

  const onStart = () => {
    const video = videoRef.current;
    if (!video || !canStart) return;
    setStarted(true);
    void controller.start(video);
  };

  return (
    <section
      aria-label="Stage"
      className="holo-tray flex flex-col gap-3 p-3 sm:p-4"
      data-case-id={caseId}
      data-purpose={props.purpose}
      data-plan-id={plan?.id ?? ""}
      data-status={status}
      data-reconnecting={session.reconnecting ? "true" : undefined}
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
        recordingSec={recordingSec}
        updating={session.status === "updating"}
        overlay={overlay}
      />
      <p className="sr-only" aria-live="polite">
        {takeMode
          ? `Showing ${formatTakeNumber(selectedTake.number)}`
          : session.reconnecting
            ? LIVE_COPY.reconnecting
            : PREVIEW_STATUS_COPY[status]}
      </p>
      <StageControls
        status={status}
        statusText={statusText}
        detail={detail}
        takeMode={takeMode}
        sessionActive={sessionActive}
        canStart={canStart}
        startHint={sessionActive ? null : startHint}
        clip={cv}
        clipHint={clipHint}
        canReplay={canReplay}
        notice={cv.notice ?? session.notice}
        onStart={onStart}
        onStop={() => void controller.stop("user")}
        onClip={() => void capture.clip()}
        onReplay={() => controller.replayMovement()}
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
