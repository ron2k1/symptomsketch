import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  LIMITS,
  REVIEW_ACTION_LABELS,
  type ReviewDecision,
  type Take,
} from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, isApiClientError, reviewTake } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/ids";

interface ReviewActionsProps {
  take: Take;
  onTakeUpdated(take: Take): void;
  onDecision(decision: ReviewDecision): void;
  /** Refetch the take after a REVIEW_CONFLICT so the user reviews the current binding. */
  onConflict(): void;
}

/**
 * Purpose-specific human review of the exact MP4 (spec 1, 6, 9). A favorable check never decides
 * for the user; needs_revision cannot be accepted, except a customer clip sent through the explicit
 * "Send anyway" confirmation (the verdict stays and support sees why); a customer accepting an uncertain or
 * unavailable check must leave a note; an instructional take is accepted only when consistent.
 */
export function ReviewActions({ take, onTakeUpdated, onDecision, onConflict }: ReviewActionsProps) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingOverride, setConfirmingOverride] = useState(false);
  const labels = REVIEW_ACTION_LABELS[take.purpose];
  const uiStatus = take.currentAssessment?.uiStatus ?? null;
  const checking = uiStatus === "pending";
  const isSolution = take.purpose === "solution";
  const noteRequired =
    !isSolution && (uiStatus === "uncertain" || uiStatus === "unavailable" || uiStatus === null);
  const trimmedNote = note.trim();

  let acceptBlocked: string | null = null;
  if (!take.sha256) acceptBlocked = "This take is not ready yet.";
  else if (checking) acceptBlocked = "Wait for the visual check to finish.";
  else if (uiStatus === "needs_revision") {
    acceptBlocked = "The check found a mismatch. Keep refining, then clip a new take.";
  } else if (isSolution && uiStatus !== "matches") {
    acceptBlocked =
      "An instructional take can be confirmed only when every required step appears consistent.";
  } else if (noteRequired && !trimmedNote) {
    acceptBlocked = "Play the saved clip, then note what remains uncertain before accepting.";
  }
  // A customer may send a flagged clip only through the explicit confirmation below.
  const canSendFlagged =
    !isSolution && uiStatus === "needs_revision" && !!take.sha256 && !!take.currentAssessment;

  async function decide(decision: ReviewDecision, overrideCriticFlag = false) {
    if (!take.sha256) return;
    setPending(decision);
    setError(null);
    try {
      const res = await reviewTake(take.id, {
        decision,
        finalSha256: take.sha256,
        assessmentId: take.currentAssessment?.id ?? null,
        uncertaintyNote: trimmedNote ? trimmedNote.slice(0, LIMITS.reviewNoteMaxChars) : null,
        idempotencyKey: newIdempotencyKey(),
        ...(overrideCriticFlag ? { overrideCriticFlag: true } : {}),
      });
      onTakeUpdated(res.take);
      onDecision(decision);
    } catch (err) {
      if (isApiClientError(err) && err.code === "REVIEW_CONFLICT") onConflict();
      setError(errorMessage(err));
    } finally {
      setPending(null);
      setConfirmingOverride(false);
    }
  }

  const spinner = (d: ReviewDecision) =>
    pending === d ? <LoaderCircle className="animate-spin" aria-hidden /> : null;

  return (
    <div className="space-y-3">
      <p className="hud-label">{isSolution ? "Review statement" : "Your review"}</p>
      {!isSolution ? (
        <div className="space-y-1.5">
          <Label htmlFor={`review-note-${take.id}`}>
            Review note{" "}
            <span className="text-muted-foreground">
              {noteRequired ? "(required to accept an unverified clip)" : "(optional)"}
            </span>
          </Label>
          <Textarea
            id={`review-note-${take.id}`}
            rows={2}
            value={note}
            maxLength={LIMITS.reviewNoteMaxChars}
            placeholder="What still looks uncertain, if anything"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="min-h-11 whitespace-normal text-left"
          disabled={pending !== null || acceptBlocked !== null}
          onClick={() => decide("accept")}
        >
          {spinner("accept")}
          {labels.accept}
        </Button>
        <Button
          type="button"
          variant={canSendFlagged ? "default" : "outline"}
          className="min-h-11"
          disabled={pending !== null}
          onClick={() => decide("refine")}
        >
          {spinner("refine")}
          {labels.refine}
        </Button>
        {!isSolution ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending !== null || checking}
            onClick={() => decide("unsure")}
          >
            {spinner("unsure")}
            {labels.unsure}
          </Button>
        ) : null}
      </div>
      {acceptBlocked ? <p className="text-[13px] text-muted-foreground">{acceptBlocked}</p> : null}
      {canSendFlagged && !confirmingOverride ? (
        <Button
          type="button"
          className="min-h-11"
          disabled={pending !== null}
          onClick={() => setConfirmingOverride(true)}
        >
          Send anyway
        </Button>
      ) : null}
      {canSendFlagged && confirmingOverride ? (
        <div
          role="alertdialog"
          aria-labelledby={`send-flagged-${take.id}`}
          className="space-y-2 rounded-lg border border-magenta/60 bg-magenta-soft p-3"
        >
          <p id={`send-flagged-${take.id}`} className="text-sm text-foreground">
            Gemini flagged this clip as needing revision. If you send it, support will see that it
            was flagged and why. The check result does not change.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={pending !== null}
              onClick={() => decide("accept", true)}
            >
              {spinner("accept")}
              Send flagged clip to support
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={pending !== null}
              onClick={() => setConfirmingOverride(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
