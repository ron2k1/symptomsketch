import { useState } from "react";
import {
  CircleCheck,
  CircleHelp,
  CircleSlash,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import {
  ASSESSMENT_LABELS,
  CHECK_RESULT_LABELS,
  type AssessmentUiStatus,
  type CheckResult,
  type PlanRevision,
  type Take,
} from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { errorMessage, requestAssessment } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/ids";
import { cn } from "@/lib/utils";

const CHIP_STYLE: Record<AssessmentUiStatus, string> = {
  pending: "border-neon/50 bg-neon-soft text-neon",
  matches: "border-success/50 bg-success/10 text-success",
  needs_revision: "border-magenta/60 bg-magenta-soft text-magenta",
  uncertain: "border-warning/50 bg-warning/10 text-warning",
  unavailable: "border-border bg-muted text-muted-foreground",
};

const RESULT_STYLE: Record<CheckResult, string> = {
  supported: "text-success",
  contradicted: "text-magenta",
  not_observable: "text-warning",
};

function ChipIcon({ status }: { status: AssessmentUiStatus }) {
  if (status === "pending") return <LoaderCircle className="size-4 animate-spin" aria-hidden />;
  if (status === "matches") return <CircleCheck className="size-4" aria-hidden />;
  if (status === "needs_revision") return <TriangleAlert className="size-4" aria-hidden />;
  if (status === "uncertain") return <CircleHelp className="size-4" aria-hidden />;
  return <CircleSlash className="size-4" aria-hidden />;
}

export function AssessmentChip({ status }: { status: AssessmentUiStatus }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 font-mono text-[13px]",
        CHIP_STYLE[status],
      )}
    >
      <ChipIcon status={status} />
      {status === "pending" ? "Checking..." : ASSESSMENT_LABELS[status]}
    </span>
  );
}

function formatRange(range: [number, number] | null): string | null {
  if (!range) return null;
  return `${range[0].toFixed(1)}-${range[1].toFixed(1)} s`;
}

interface AssessmentPanelProps {
  take: Take;
  plan: PlanRevision | null;
  onTakeUpdated(take: Take): void;
  /** Explicit "Try suggested correction": revises the plan; the user records a new take. */
  onTryCorrection(text: string): void;
  correctionDisabled: boolean;
}

/** Visual check result for one ready take (spec 9 "Correction and review behavior"). */
export function AssessmentPanel({
  take,
  plan,
  onTakeUpdated,
  onTryCorrection,
  correctionDisabled,
}: AssessmentPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assessment = take.currentAssessment;

  async function runCheck(retry: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await requestAssessment(take.id, { idempotencyKey: newIdempotencyKey(), retry });
      onTakeUpdated(res.take);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!assessment) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">The visual check has not started yet.</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={() => runCheck(false)}
        >
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Run visual check
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  const status = assessment.uiStatus;
  const result = assessment.result;
  const constraints = new Map(plan?.plan.requiredConstraints.map((c) => [c.id, c]) ?? []);
  const suggestions = result?.suggestedPresentationChanges ?? [];
  const canSuggest =
    suggestions.length > 0 && (status === "needs_revision" || status === "uncertain");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AssessmentChip status={status} />
        {status === "pending" ? (
          <span className="text-sm text-muted-foreground">{ASSESSMENT_LABELS.pending}</span>
        ) : null}
      </div>
      {assessment.summary ? <p className="text-sm">{assessment.summary}</p> : null}
      {status === "unavailable" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            The check could not run. This is not a favorable result. Your take is saved.
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => runCheck(true)}
          >
            {busy ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <RotateCcw aria-hidden />
            )}
            Retry check
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {result && result.checks.length > 0 ? (
        <details className="rounded-lg border border-border bg-surface-2 p-3">
          <summary className="min-h-8 cursor-pointer text-sm font-medium">
            Constraint checks ({result.checks.length})
          </summary>
          <ul className="mt-2 space-y-2.5">
            {result.checks.map((check) => {
              const constraint = constraints.get(check.constraintId);
              const range = formatRange(check.timeRangeSeconds);
              return (
                <li key={check.constraintId} className="space-y-0.5 text-sm">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[12px] text-muted-foreground">
                      {check.constraintId}
                    </span>
                    <span className={cn("font-mono text-[12px]", RESULT_STYLE[check.result])}>
                      {CHECK_RESULT_LABELS[check.result]}
                    </span>
                    {range ? (
                      <span className="font-mono text-[12px] text-muted-foreground">{range}</span>
                    ) : null}
                  </p>
                  {constraint ? (
                    <p className="text-[13px] text-muted-foreground">
                      Expected: {constraint.expected}
                    </p>
                  ) : null}
                  <p>{check.observation}</p>
                </li>
              );
            })}
          </ul>
          {result.limitations.length > 0 ? (
            <div className="mt-3 space-y-1 border-t border-border pt-2">
              <p className="hud-label">Limitations</p>
              <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground">
                {result.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.inputCoverage.requestedFps ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Checked from the final MP4 sampled at {result.inputCoverage.requestedFps} frames per
              second. Very brief movements can fall between samples.
            </p>
          ) : null}
        </details>
      ) : null}

      {canSuggest ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="hud-label">Suggested correction</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={correctionDisabled}
            onClick={() => onTryCorrection(suggestions.join(" "))}
          >
            <WandSparkles aria-hidden />
            Try suggested correction
          </Button>
          <p className="text-[12px] text-muted-foreground">
            Updates the preview description. Your original requirements stay; record a new take
            afterwards.
          </p>
        </div>
      ) : null}
    </div>
  );
}
