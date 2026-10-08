import { LoaderCircle, Play, Repeat, RotateCcw, Scissors, Square, X } from "lucide-react";
import type { PreviewStatus } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import type { ClipView } from "@/features/capture/useClipCapture";
import { StageStats, type StageStatsProps } from "./StageStats";

const BTN = "h-11 px-4";

export interface StageControlsProps {
  status: PreviewStatus;
  /** A dropped or rotated connection is being replaced (Stop still ends the whole preview). */
  reconnecting: boolean;
  statusText: string;
  detail: string | null;
  takeMode: boolean;
  /** A preview session is running (connecting, reconnecting, live or updating). */
  sessionActive: boolean;
  canStart: boolean;
  startHint: string | null;
  clip: ClipView;
  /** Why clipping is unavailable right now (null when the Clip button explains itself). */
  clipHint: string | null;
  canReplay: boolean;
  notice: string | null;
  /** Why the product is not moved on the source (motion guide); `onRetry` asks Gemini again. */
  guideNotice?: { text: string; onRetry: (() => void) | null } | null;
  /** Live Reactor X2 readout; null hides it. */
  readout: StageStatsProps | null;
  onStart(): void;
  onStop(): void;
  onClip(): void;
  onReplay(): void;
  onRetryUpload(): void;
  onDismissNotice(): void;
  onDiscard(): void;
  onExitTake?: () => void;
}

/** Stage controls under the 16:9 player (spec 6 desktop composition + copy table). */
export function StageControls(p: StageControlsProps) {
  const { status } = p;
  const spinning =
    status === "connecting" ||
    status === "waiting_frames" ||
    status === "updating" ||
    status === "uploading";
  const hint = p.takeMode ? null : p.sessionActive ? p.clipHint : p.startHint;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-medium text-foreground">
            {spinning && <LoaderCircle className="size-4 animate-spin text-neon" aria-hidden />}
            <span className={p.takeMode ? "tabular-nums" : "font-reactor tabular-nums"}>
              {p.statusText}
            </span>
          </p>
          {p.detail && <p className="mt-0.5 text-[13px] text-muted-foreground">{p.detail}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{renderActions(p)}</div>
      </div>

      {p.readout && <StageStats {...p.readout} />}

      {p.notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-muted-foreground">
          <span>{p.notice}</span>
          <button
            type="button"
            className="shrink-0 rounded text-muted-foreground hover:text-foreground"
            onClick={p.onDismissNotice}
            aria-label="Dismiss"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {p.guideNotice && (
        <div
          data-motion-guide-notice=""
          className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-muted-foreground"
        >
          <span>{p.guideNotice.text}</span>
          {p.guideNotice.onRetry && (
            <button
              type="button"
              className="shrink-0 rounded font-medium text-foreground underline-offset-2 hover:underline"
              onClick={p.guideNotice.onRetry}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {p.clip.phase === "idle" && hint && (
        <p className="text-[13px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function clipLabel(clip: ClipView): string {
  const r = clip.readiness;
  if (r?.kind === "ready") return `Clip last ${r.seconds} s`;
  if (r?.kind === "warming") return `Clip in ${r.secondsLeft} s`;
  return "Clip";
}

function stopButton(p: StageControlsProps) {
  return (
    <Button className={BTN} variant="outline" onClick={p.onStop} data-stage-action="stop">
      <Square aria-hidden />{" "}
      {p.status === "connecting" && !p.reconnecting ? "Cancel" : "Stop preview"}
    </Button>
  );
}

function renderActions(p: StageControlsProps) {
  const { clip } = p;
  if (p.takeMode) {
    return (
      <>
        {p.onExitTake && (
          <Button className={BTN} variant="secondary" onClick={p.onExitTake}>
            Back to live preview
          </Button>
        )}
        {p.sessionActive && stopButton(p)}
      </>
    );
  }
  if (clip.phase === "failed" && clip.canRetryUpload) {
    return (
      <>
        <Button className={BTN} onClick={p.onRetryUpload}>
          <RotateCcw aria-hidden /> Retry saving
        </Button>
        <Button className={BTN} variant="outline" onClick={p.onDiscard}>
          Discard clip
        </Button>
        {p.sessionActive && stopButton(p)}
      </>
    );
  }
  if (p.sessionActive) {
    const canClip = clip.phase === "idle" && clip.readiness?.kind === "ready";
    return (
      <>
        <Button
          className={`${BTN} min-w-36 tabular-nums shadow-[var(--glow-magenta)]`}
          onClick={p.onClip}
          disabled={!canClip}
          data-stage-action="clip"
          title="Saves the last seconds of live output as a take, ending now. The preview keeps running."
        >
          {clip.phase === "uploading" ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Scissors aria-hidden />
          )}
          {clip.phase === "uploading" ? "Saving clip" : clipLabel(clip)}
        </Button>
        <Button
          className={BTN}
          variant="secondary"
          onClick={p.onReplay}
          disabled={!p.canReplay}
          data-stage-action="replay"
        >
          <Repeat aria-hidden /> Replay movement
        </Button>
        {stopButton(p)}
      </>
    );
  }
  const retry = p.status === "error";
  return (
    <Button
      className={`${BTN} shadow-[var(--glow)]`}
      onClick={p.onStart}
      disabled={!p.canStart}
      data-stage-action="start"
    >
      {retry ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
      {retry ? "Retry" : "Start preview"}
    </Button>
  );
}
