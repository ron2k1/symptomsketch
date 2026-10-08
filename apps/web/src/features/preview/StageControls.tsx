import { Circle, CircleStop, LoaderCircle, Play, RotateCcw, Square, X } from "lucide-react";
import type { PreviewStatus } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import type { CaptureView } from "@/features/capture/useTakeCapture";

const ACTIVE: ReadonlySet<PreviewStatus> = new Set([
  "connecting",
  "waiting_frames",
  "live",
  "updating",
]);
const BTN = "h-11 px-4";

export interface StageControlsProps {
  status: PreviewStatus;
  statusText: string;
  detail: string | null;
  takeMode: boolean;
  canStart: boolean;
  startHint: string | null;
  canRecord: boolean;
  recordHint: string | null;
  capture: CaptureView;
  idleMsLeft: number | null;
  notice: string | null;
  onStart(): void;
  onStop(): void;
  onRecord(): void;
  onStopEarly(): void;
  onCancel(): void;
  onContinue(): void;
  onRetryUpload(): void;
  onDismissNotice(): void;
  onDiscard(): void;
  onExitTake?: () => void;
}

/** Stage controls under the 16:9 player (spec 6 desktop composition + copy table). */
export function StageControls(p: StageControlsProps) {
  const { status, capture } = p;
  const busy = status === "connecting" || status === "waiting_frames" || status === "updating";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-medium text-foreground">
            {(busy || status === "armed" || status === "uploading") && (
              <LoaderCircle className="size-4 animate-spin text-neon" aria-hidden />
            )}
            {status === "recording" && (
              <Circle className="size-3 fill-magenta text-magenta" aria-hidden />
            )}
            <span className="font-mono tabular-nums">{p.statusText}</span>
          </p>
          {p.detail && <p className="mt-0.5 text-[13px] text-muted-foreground">{p.detail}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{renderActions(p)}</div>
      </div>

      {p.idleMsLeft !== null && ACTIVE.has(status) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-[13px] text-foreground">
          <span>Preview stops in {Math.ceil(p.idleMsLeft / 1000)} s without activity.</span>
          <Button size="sm" variant="secondary" onClick={p.onContinue}>
            Continue preview
          </Button>
        </div>
      )}

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

      {capture.phase === "idle" && !p.takeMode && (p.startHint || p.recordHint) && (
        <p className="text-[13px] text-muted-foreground">
          {ACTIVE.has(status) ? p.recordHint : p.startHint}
        </p>
      )}
    </div>
  );
}

function renderActions(p: StageControlsProps) {
  const { status, capture } = p;
  if (p.takeMode) {
    return p.onExitTake ? (
      <Button className={BTN} variant="secondary" onClick={p.onExitTake}>
        Back to live preview
      </Button>
    ) : null;
  }
  if (capture.phase === "armed") {
    return (
      <Button className={BTN} variant="outline" onClick={p.onCancel}>
        <X aria-hidden /> Cancel
      </Button>
    );
  }
  if (capture.phase === "recording") {
    return (
      <>
        <Button
          className={BTN}
          onClick={p.onStopEarly}
          disabled={!capture.canStopEarly}
          title={capture.canStopEarly ? undefined : "Available after 4 seconds of generated output"}
        >
          <CircleStop aria-hidden /> Stop and review
        </Button>
        <Button className={BTN} variant="outline" onClick={p.onCancel}>
          <X aria-hidden /> Cancel
        </Button>
      </>
    );
  }
  if (capture.phase === "uploading") return null;
  if (capture.phase === "failed" && capture.canRetryUpload) {
    return (
      <>
        <Button className={BTN} onClick={p.onRetryUpload}>
          <RotateCcw aria-hidden /> Retry saving
        </Button>
        <Button className={BTN} variant="outline" onClick={p.onDiscard}>
          Discard take
        </Button>
      </>
    );
  }
  if (ACTIVE.has(status)) {
    return (
      <>
        <Button
          className={`${BTN} shadow-[var(--glow-magenta)]`}
          variant="default"
          onClick={p.onRecord}
          disabled={!p.canRecord}
        >
          <Circle className="fill-current" aria-hidden /> Record next take
        </Button>
        <Button className={BTN} variant="outline" onClick={p.onStop}>
          <Square aria-hidden /> {status === "connecting" ? "Cancel" : "Stop preview"}
        </Button>
      </>
    );
  }
  const retry = status === "error" || capture.phase === "failed";
  return (
    <Button className={`${BTN} shadow-[var(--glow)]`} onClick={p.onStart} disabled={!p.canStart}>
      {retry ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
      {retry ? "Retry" : "Start preview"}
    </Button>
  );
}
