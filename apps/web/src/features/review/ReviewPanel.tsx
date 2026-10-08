import { useState } from "react";
import { LoaderCircle, RotateCcw, X } from "lucide-react";
import {
  CAPTURE_REASON_LABELS,
  ERROR_COPY,
  PROCESSING_LABELS,
  REVIEW_ACTION_LABELS,
  REVIEW_STATE_LABELS,
  takeShelfLabel,
  type MediaAsset,
  type PlanRevision,
  type ReviewDecision,
  type Take,
} from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { errorMessage, getTake, retryExport } from "@/lib/api";
import { formatBytes, formatDuration, formatTakeNumber } from "@/lib/format";
import { newIdempotencyKey } from "@/lib/ids";
import { AssessmentPanel } from "./AssessmentPanel";
import { ExportPanel } from "./ExportPanel";
import { ReviewActions } from "./ReviewActions";
import { isTakeProcessing } from "./useTakePolling";

export interface ReviewPanelProps {
  take: Take;
  /** The take's own frozen plan (selecting an older take restores its explanation). */
  plan: PlanRevision | null;
  original: MediaAsset | null;
  onTakeUpdated(take: Take): void;
  onClose(): void;
  onTryCorrection(text: string): void;
  correctionDisabled: boolean;
  onDecision(decision: ReviewDecision): void;
  continueLabel: string;
  onContinue(): void;
  announce(text: string): void;
}

function ProcessingNotice({ take }: { take: Take }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
      <LoaderCircle className="size-4 animate-spin text-neon" aria-hidden />
      <span>
        {PROCESSING_LABELS[take.processingState]}. Your case stays available while the MP4 is
        prepared.
      </span>
    </div>
  );
}

function ExportFailed({ take, onTakeUpdated }: Pick<ReviewPanelProps, "take" | "onTakeUpdated">) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await retryExport(take.id, { idempotencyKey: newIdempotencyKey() });
      onTakeUpdated(res.take);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-destructive/50 p-3 text-sm">
      <p>{ERROR_COPY[take.errorCode ?? "EXPORT_FAILED"]}</p>
      {take.retryable ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={retry}
        >
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
          Retry export
        </Button>
      ) : (
        <p className="text-muted-foreground">
          This recording cannot be converted again. Record a new take.
        </p>
      )}
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}

/** Review and export state for the selected take (spec 6, 9, 12). */
export function ReviewPanel(props: ReviewPanelProps) {
  const { take, plan } = props;
  const review = take.latestReview;
  const ready = take.processingState === "ready" && take.captureStatus === "complete";

  async function refetch() {
    try {
      const res = await getTake(take.id);
      props.onTakeUpdated(res.take);
    } catch {
      // the poller or a manual refresh will catch up
    }
  }

  return (
    <section
      aria-labelledby={`review-${take.id}`}
      className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 id={`review-${take.id}`} className="text-lg font-semibold">
            {formatTakeNumber(take.number)}{" "}
            <span className="font-mono text-sm font-normal text-neon">{takeShelfLabel(take)}</span>
          </h3>
          <p className="text-sm text-muted-foreground">{take.caption}</p>
          {ready ? (
            <p className="font-mono text-[12px] text-muted-foreground">
              MP4 / {formatDuration(take.durationMs)} / {formatBytes(take.sizeBytes)}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="ghost" className="min-h-11" onClick={props.onClose}>
          <X aria-hidden />
          Back to live preview
        </Button>
      </div>

      {take.captureStatus === "incomplete" ? (
        <div role="alert" className="rounded-lg border border-warning/50 p-3 text-sm">
          <p>
            {take.captureReason ? CAPTURE_REASON_LABELS[take.captureReason] : "Capture incomplete"}.{" "}
            {ERROR_COPY.CAPTURE_INCOMPLETE}
          </p>
          <p className="text-muted-foreground">Record a new take to replace the missing footage.</p>
        </div>
      ) : null}
      {take.captureStatus === "complete" && isTakeProcessing(take) ? (
        <ProcessingNotice take={take} />
      ) : null}
      {take.captureStatus === "complete" && take.processingState === "failed" ? (
        <ExportFailed take={take} onTakeUpdated={props.onTakeUpdated} />
      ) : null}

      {ready ? (
        <>
          <AssessmentPanel
            take={take}
            plan={plan}
            onTakeUpdated={props.onTakeUpdated}
            onTryCorrection={props.onTryCorrection}
            correctionDisabled={props.correctionDisabled}
          />
          {review && take.reviewState !== "unreviewed" ? (
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <p>
                <span className="hud-label">Your review </span>
                {REVIEW_ACTION_LABELS[take.purpose][review.decision]} (
                {REVIEW_STATE_LABELS[review.resultingState]})
              </p>
              {review.uncertaintyNote ? (
                <p className="mt-1 text-muted-foreground">Note: {review.uncertaintyNote}</p>
              ) : null}
            </div>
          ) : null}
          {take.reviewState === "accepted" ? (
            <ExportPanel
              take={take}
              original={props.original}
              continueLabel={props.continueLabel}
              onContinue={props.onContinue}
              announce={props.announce}
            />
          ) : (
            <ReviewActions
              key={take.id}
              take={take}
              onTakeUpdated={props.onTakeUpdated}
              onDecision={props.onDecision}
              onConflict={refetch}
            />
          )}
        </>
      ) : null}
    </section>
  );
}
