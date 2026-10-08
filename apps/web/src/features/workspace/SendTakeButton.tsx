import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import type { Take } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { createTicket, errorMessage, getTakeMessage, reviewTake } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/ids";
import { useWorkspace } from "./WorkspaceProvider";

interface SendTakeButtonProps {
  caseId: string;
  take: Take;
  /** The take already has a live ticket: the button opens it instead of sending again. */
  sent: boolean;
}

/**
 * One click from a saved take to Demo Support: accepts the clip (a Gemini-flagged one through the
 * same override as Send anyway, so support still sees the flag), sends the MP4 with the server's
 * suggested message, then opens the Support tab where the ticket and the call with Sam are.
 */
export function SendTakeButton({ caseId, take, sent }: SendTakeButtonProps) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = take.currentAssessment?.uiStatus ?? null;
  const accepted = take.reviewState === "accepted";

  if (take.purpose !== "problem") return null;

  function openSupport() {
    ws.selectTake(take.id);
    ws.goTab("support");
  }

  async function send() {
    if (!take.sha256) return;
    setError(null);
    if (!accepted && (status === "uncertain" || status === "unavailable")) {
      ws.selectTake(take.id);
      setError(
        "Gemini could not verify this clip. Add a review note below the stage, then accept.",
      );
      return;
    }
    setBusy(true);
    try {
      if (!accepted) {
        await reviewTake(take.id, {
          decision: "accept",
          finalSha256: take.sha256,
          assessmentId: take.currentAssessment?.id ?? null,
          uncertaintyNote: null,
          idempotencyKey: newIdempotencyKey(),
          ...(status === "needs_revision" ? { overrideCriticFlag: true } : {}),
        });
      }
      const message = await getTakeMessage(take.id);
      await createTicket(caseId, {
        takeId: take.id,
        message: message.body,
        includeOriginal: false,
        idempotencyKey: newIdempotencyKey(),
      });
      ws.selectTake(take.id);
      await ws.reload();
      ws.goTab("support");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const waiting = !take.sha256 || status === null || status === "pending";
  return (
    <div className="mt-1.5 space-y-1">
      <Button
        type="button"
        size="sm"
        className="min-h-9 w-full"
        disabled={busy || (!sent && waiting)}
        onClick={sent ? openSupport : () => void send()}
      >
        {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        {sent ? "Open ticket" : waiting ? "Checking the clip" : "Send to support"}
      </Button>
      {error ? (
        <p role="alert" className="text-[12px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
