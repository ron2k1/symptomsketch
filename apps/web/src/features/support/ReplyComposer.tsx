import { useId, useState } from "react";
import { LoaderCircle, RefreshCw, Send } from "lucide-react";
import { ASSESSMENT_LABELS, LIMITS, type Ticket } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createReply, errorMessage, isApiClientError } from "@/lib/api";
import { formatBytes, formatDuration, formatTakeNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useIdempotencyKey } from "./useIdempotencyKey";
import { useSessionDraft } from "./useSessionDraft";
import type { WorkCaseTake } from "./useWorkCaseTakes";

interface ReplyComposerProps {
  ticket: Ticket;
  onReplied(ticket: Ticket): void;
  workCaseTakes: readonly WorkCaseTake[];
  takesLoading: boolean;
  takesError: unknown;
  onRefreshTakes(): void;
}

/**
 * A real text reply (spec 5), optionally carrying one accepted solution take from this ticket's
 * work case. Only the explicit Send reply click transmits; the draft survives navigation.
 */
export function ReplyComposer(props: ReplyComposerProps) {
  const { ticket, onReplied, workCaseTakes, takesLoading, takesError, onRefreshTakes } = props;
  const ids = useId();
  const draft = useSessionDraft(`reply.${ticket.id}`);
  const [attachTakeId, setAttachTakeId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState("");
  const key = useIdempotencyKey();

  const text = draft.value ?? "";
  const tooLong = text.length > LIMITS.replyTextMaxChars;
  const revoked = ticket.status === "revoked";
  const selected = workCaseTakes.find((w) => w.take.id === attachTakeId) ?? null;
  const canSend = !revoked && !sending && text.trim().length > 0 && !tooLong;
  const sentHashes = new Set(
    ticket.replies.flatMap((r) => (r.attachment ? [r.attachment.sha256] : [])),
  );

  async function onSend() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    setSentNotice("");
    try {
      const res = await createReply(ticket.id, {
        text,
        attachTakeId: selected ? selected.take.id : null,
        idempotencyKey: key.get(),
      });
      key.rotate();
      draft.clear();
      setAttachTakeId(null);
      setSentNotice("Reply saved to the ticket.");
      onReplied(res.ticket);
    } catch (err) {
      if (isApiClientError(err) && err.code === "TICKET_CONFLICT") key.rotate();
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <h2 id={`${ids}-title`} className="hud-label text-neon">
        Reply to the customer
      </h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${ids}-text`}>Reply text</Label>
        <Textarea
          id={`${ids}-text`}
          value={text}
          onChange={(e) => draft.setValue(e.target.value)}
          rows={5}
          disabled={revoked}
          className="min-h-32 text-sm"
          aria-invalid={tooLong ? true : undefined}
          aria-describedby={`${ids}-count`}
        />
        <p
          id={`${ids}-count`}
          className={cn("text-xs", tooLong ? "text-destructive" : "text-muted-foreground")}
        >
          {text.length} / {LIMITS.replyTextMaxChars} characters
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 flex w-full items-center justify-between gap-2 text-sm font-medium">
          Attach an accepted demonstration (optional)
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefreshTakes}
            aria-label="Refresh accepted demonstration takes"
          >
            <RefreshCw aria-hidden className={takesLoading ? "animate-spin" : undefined} />
          </Button>
        </legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="radio"
            name={`${ids}-attach`}
            className="size-4 accent-primary"
            checked={selected === null}
            onChange={() => setAttachTakeId(null)}
          />
          Text only
        </label>
        {workCaseTakes.map(({ take }) => (
          <label
            key={take.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-2 text-sm",
              attachTakeId === take.id && "border-neon/60 bg-neon-soft",
            )}
          >
            <input
              type="radio"
              name={`${ids}-attach`}
              className="mt-1 size-4 accent-primary"
              checked={attachTakeId === take.id}
              onChange={() => setAttachTakeId(take.id)}
            />
            {take.thumbnailUrl ? (
              <img
                src={take.thumbnailUrl}
                alt=""
                className="aspect-video w-24 shrink-0 rounded-md bg-background object-cover"
              />
            ) : null}
            <span className="min-w-0">
              <span className="block font-medium">
                {formatTakeNumber(take.number)} · {take.caption}
              </span>
              <span className="block font-mono text-xs text-muted-foreground">
                {formatDuration(take.durationMs)} · {formatBytes(take.sizeBytes)} · check:{" "}
                {take.currentAssessment
                  ? ASSESSMENT_LABELS[take.currentAssessment.uiStatus]
                  : "not run"}
              </span>
              {take.sha256 && sentHashes.has(take.sha256) ? (
                <span className="block text-xs text-warning">Already attached to a reply</span>
              ) : null}
            </span>
          </label>
        ))}
        {!takesLoading && workCaseTakes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {ticket.workCaseIds.length === 0
              ? "No demonstration yet. Use Reply with a demonstration to create one."
              : "No accepted solution take in the work case yet. Accept one in its Recreate tab."}
          </p>
        ) : null}
        {takesError && workCaseTakes.length === 0 ? (
          <p className="text-xs text-destructive">{errorMessage(takesError)}</p>
        ) : null}
        {selected?.take.mediaUrl ? (
          <video
            className="aspect-video w-full rounded-lg bg-background object-contain"
            src={selected.take.mediaUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={`Preview of ${formatTakeNumber(selected.take.number)}`}
          />
        ) : null}
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p role="status" className="min-h-5 text-sm text-success">
        {sentNotice}
      </p>
      <Button
        type="button"
        className="min-h-11 self-start"
        onClick={() => void onSend()}
        disabled={!canSend}
        aria-busy={sending || undefined}
      >
        {sending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        {sending ? "Sending" : selected ? "Send reply with clip" : "Send reply"}
      </Button>
    </section>
  );
}
