import { useEffect, useId, useState } from "react";
import { CircleCheck, LoaderCircle, RefreshCw, Send } from "lucide-react";
import {
  ASSESSMENT_LABELS,
  LIMITS,
  PURPOSE_LABELS,
  REVIEW_ACTION_LABELS,
  SUPPORT_QUEUE_LABEL,
  type ProductRevision,
  type Take,
  type Ticket,
  type TicketSummary,
} from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTicket, errorMessage, getTakeMessage, isApiClientError } from "@/lib/api";
import { formatBytes, formatDuration, formatTakeNumber, formatTimestamp } from "@/lib/format";
import { ExportActions } from "./ExportActions";
import { SUPPORT_SEND_BUTTON_ID, shortHash } from "./labels";
import { emailText } from "./model";
import { useIdempotencyKey } from "./useIdempotencyKey";
import { useSessionDraft } from "./useSessionDraft";

interface TicketPrepPanelProps {
  caseId: string;
  take: Take;
  product: ProductRevision | null;
  /** Server-stored ticket already carrying this take, if any. */
  existingTicket: TicketSummary | null;
  onSent(ticket: Ticket): void;
}

type MessageLoad =
  | { status: "loading" }
  | { status: "ready"; subject: string; body: string; filename: string }
  | { status: "error"; error: string };

/**
 * Ticket preparation (spec 5, 6, 13): editable explanation prefilled from GET /api/takes/:id/message,
 * a confirmation naming both attachments, and an explicit Send to Demo Support.
 */
export function TicketPrepPanel(props: TicketPrepPanelProps) {
  const { caseId, take, product, existingTicket, onSent } = props;
  const ids = useId();
  const [load, setLoad] = useState<MessageLoad>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const draft = useSessionDraft(`ticket.${take.id}`);
  const [includeOriginal, setIncludeOriginal] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const key = useIdempotencyKey();

  useEffect(() => {
    key.rotate();
    setIncludeOriginal(false);
    setSendError(null);
  }, [take.id, key]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    getTakeMessage(take.id)
      .then((m) => {
        if (!cancelled) {
          setLoad({
            status: "ready",
            subject: m.subject,
            body: m.body,
            filename: m.attachmentFilename,
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ status: "error", error: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [take.id, reloadToken]);

  const suggested = load.status === "ready" ? load.body : "";
  const message = draft.value ?? suggested;
  const tooLong = message.length > LIMITS.ticketMessageMaxChars;
  const ready = load.status === "ready" || draft.value !== null;
  const canSend = ready && !sending && message.trim().length > 0 && !tooLong;
  const uncertaintyNote = take.latestReview?.uncertaintyNote ?? null;
  const subject = load.status === "ready" ? load.subject : "";
  const mp4Name = load.status === "ready" ? load.filename : `${formatTakeNumber(take.number)}.mp4`;

  async function onSend() {
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const { ticket } = await createTicket(caseId, {
        takeId: take.id,
        message,
        includeOriginal,
        idempotencyKey: key.get(),
      });
      key.rotate();
      onSent(ticket);
    } catch (err) {
      if (isApiClientError(err) && err.code === "TICKET_CONFLICT") key.rotate();
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-3 rounded-xl border bg-surface-2 p-3">
        {take.thumbnailUrl ? (
          <img
            src={take.thumbnailUrl}
            alt=""
            className="aspect-video w-28 shrink-0 rounded-md bg-background object-cover"
          />
        ) : null}
        <div className="min-w-0 text-sm">
          <p className="font-semibold">
            {formatTakeNumber(take.number)}{" "}
            <span className="font-normal text-muted-foreground">
              · {PURPOSE_LABELS[take.purpose]}
            </span>
          </p>
          <p className="truncate text-muted-foreground" title={take.caption}>
            {take.caption}
          </p>
          <p className="mt-1 text-xs">
            Visual check:{" "}
            {take.currentAssessment
              ? ASSESSMENT_LABELS[take.currentAssessment.uiStatus]
              : "Not run"}
            {" · "}Your review:{" "}
            {uncertaintyNote
              ? "Accepted with a review note"
              : REVIEW_ACTION_LABELS[take.purpose].accept}
          </p>
          {uncertaintyNote ? (
            <p className="mt-1 text-xs text-warning">Your review note: {uncertaintyNote}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${ids}-message`}>
            {existingTicket ? "Email explanation" : "Explanation message"}
          </Label>
          {draft.value !== null && load.status === "ready" && draft.value !== suggested ? (
            <Button type="button" variant="ghost" size="sm" onClick={draft.clear}>
              Use suggested text
            </Button>
          ) : null}
        </div>
        {load.status === "loading" && draft.value === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading the suggested explanation
          </p>
        ) : null}
        {load.status === "error" ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            {load.error}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReloadToken((n) => n + 1)}
            >
              <RefreshCw aria-hidden />
              Retry
            </Button>
          </div>
        ) : null}
        <Textarea
          id={`${ids}-message`}
          value={message}
          onChange={(e) => draft.setValue(e.target.value)}
          disabled={!ready}
          rows={10}
          className="min-h-48 font-mono text-sm"
          aria-invalid={tooLong ? true : undefined}
          aria-describedby={`${ids}-count`}
        />
        <p
          id={`${ids}-count`}
          className={tooLong ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        >
          {message.length} / {LIMITS.ticketMessageMaxChars} characters
        </p>
      </div>

      <ExportActions
        take={take}
        product={product}
        copyDisabled={!ready || message.trim().length === 0}
        getCopyText={() => emailText(subject, message, uncertaintyNote)}
      />

      {existingTicket ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-success/40 bg-surface-2 p-4"
        >
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold text-success">Received by Demo Support</p>
            <p className="text-muted-foreground">
              {formatTakeNumber(existingTicket.takeNumber)} was stored for {existingTicket.queue} on{" "}
              <time dateTime={existingTicket.createdAt}>
                {formatTimestamp(existingTicket.createdAt)}
              </time>
              . Replies appear in the thread.
            </p>
          </div>
        </div>
      ) : (
        <section
          aria-labelledby={`${ids}-confirm`}
          className="flex flex-col gap-4 rounded-xl border border-neon/40 bg-card p-4"
        >
          <h3 id={`${ids}-confirm`} className="hud-label text-neon">
            {SUPPORT_QUEUE_LABEL} will receive
          </h3>
          <ul className="flex flex-col gap-3 text-sm" id={`${ids}-attachments`}>
            <li className="flex items-center gap-3">
              {product ? (
                <img
                  src={product.normalized.mediaUrl}
                  alt=""
                  className="aspect-video w-20 shrink-0 rounded-md bg-background object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <p className="font-medium">1. Product reference (normalized)</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {product
                    ? [
                        product.normalized.filename ?? "normalized reference",
                        product.normalized.width && product.normalized.height
                          ? `${product.normalized.width}x${product.normalized.height}`
                          : null,
                        formatBytes(product.normalized.sizeBytes),
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "The canonical reference for this take"}
                </p>
              </div>
            </li>
            <li className="flex items-center gap-3">
              {take.thumbnailUrl ? (
                <img
                  src={take.thumbnailUrl}
                  alt=""
                  className="aspect-video w-20 shrink-0 rounded-md bg-background object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <p className="font-medium">2. Accepted MP4, {formatTakeNumber(take.number)}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {mp4Name} · {formatDuration(take.durationMs)} · {formatBytes(take.sizeBytes)}
                  {take.sha256 ? ` · sha ${shortHash(take.sha256)}` : ""}
                </p>
              </div>
            </li>
            {includeOriginal && product ? (
              <li className="flex items-center gap-3 pl-1">
                <div className="min-w-0">
                  <p className="font-medium">3. Untouched original photo</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {product.original.filename ?? "original"} ·{" "}
                    {formatBytes(product.original.sizeBytes)}
                  </p>
                </div>
              </li>
            ) : null}
          </ul>
          {product ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={includeOriginal}
                onChange={(e) => setIncludeOriginal(e.target.checked)}
              />
              Also include the untouched original photo (optional)
            </label>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Support receives only these files and the message above. To keep the reference private,
            use Download MP4 and Copy email explanation instead.
          </p>
          {sendError ? (
            <p role="alert" className="text-sm text-destructive">
              {sendError}
            </p>
          ) : null}
          <Button
            id={SUPPORT_SEND_BUTTON_ID}
            type="button"
            className="min-h-11 self-start"
            onClick={() => void onSend()}
            disabled={!canSend}
            aria-busy={sending || undefined}
            aria-describedby={`${ids}-attachments`}
          >
            {sending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            {sending ? "Sending" : "Send to Demo Support"}
          </Button>
        </section>
      )}
    </div>
  );
}
