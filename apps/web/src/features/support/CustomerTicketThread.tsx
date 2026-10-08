import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Ticket, TicketSummary } from "@symptomsketch/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage, getTicket } from "@/lib/api";
import { formatTakeNumber, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AttachmentCard } from "./AttachmentCard";
import { CUSTOMER_TICKET_STATUS_LABELS } from "./labels";
import { isTerminalError, sortAttachments } from "./model";
import { ReplyThread } from "./ReplyThread";
import { usePolling } from "./usePolling";

interface CustomerTicketThreadProps {
  tickets: readonly TicketSummary[];
  activeTicketId: string | null;
  onSelectTicket(ticketId: string): void;
  /** A freshly created ticket to show before the first poll returns. */
  seed: Ticket | null;
}

/** Announces new replies once through a polite live region (never on the first load). */
function useReplyAnnouncement(ticket: Ticket | null): string {
  const seen = useRef(new Map<string, number>());
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!ticket) return;
    const prev = seen.current.get(ticket.id);
    const count = ticket.replies.length;
    seen.current.set(ticket.id, count);
    if (prev !== undefined && count > prev) {
      const n = count - prev;
      setMessage(`${n} new ${n === 1 ? "reply" : "replies"} from Demo Support`);
    }
  }, [ticket]);
  return message;
}

/**
 * The customer's own thread (spec 5): stored snapshot summary plus actual replies, re-read every
 * 3 s while visible. No presence, typing or wait-time indicators exist here by design.
 */
export function CustomerTicketThread(props: CustomerTicketThreadProps) {
  const { tickets, activeTicketId, onSelectTicket, seed } = props;
  const fetchTicket = useCallback(
    (signal: AbortSignal) => getTicket(activeTicketId ?? "", { signal }).then((r) => r.ticket),
    [activeTicketId],
  );
  const poll = usePolling(activeTicketId, fetchTicket, {
    enabled: activeTicketId !== null,
    stopOn: isTerminalError,
  });
  const ticket = poll.data ?? (seed && seed.id === activeTicketId ? seed : null);
  const announcement = useReplyAnnouncement(ticket);

  if (tickets.length === 0 || activeTicketId === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has been sent yet. When you send an accepted take, the stored ticket and any replies
        from Demo Support show here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {tickets.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Sent tickets">
          {tickets.map((t) => (
            <Button
              key={t.id}
              type="button"
              size="sm"
              variant={t.id === activeTicketId ? "secondary" : "ghost"}
              aria-pressed={t.id === activeTicketId}
              onClick={() => onSelectTicket(t.id)}
              className={cn("min-h-11", t.id === activeTicketId && "text-neon")}
            >
              {formatTakeNumber(t.takeNumber)} · {formatTimestamp(t.createdAt)}
              {t.replyCount > 0 ? ` · ${t.replyCount} repl${t.replyCount === 1 ? "y" : "ies"}` : ""}
            </Button>
          ))}
        </div>
      ) : null}

      {poll.error && !ticket ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          {errorMessage(poll.error)}
          <Button type="button" variant="outline" size="sm" onClick={poll.refresh}>
            <RefreshCw aria-hidden />
            Retry
          </Button>
        </div>
      ) : null}
      {!ticket && !poll.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the ticket
        </p>
      ) : null}

      {ticket ? (
        <article className="flex flex-col gap-4" aria-label="Ticket thread">
          <header className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  ticket.status === "revoked"
                    ? "border-destructive/50 text-destructive"
                    : "border-success/50 bg-surface-2 text-success"
                }
              >
                {CUSTOMER_TICKET_STATUS_LABELS[ticket.status]}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{ticket.queue}</span>
            </div>
            <p className="text-sm">
              {formatTakeNumber(ticket.snapshot.takeNumber)} · {ticket.snapshot.caption}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              Sent{" "}
              <time dateTime={ticket.snapshot.submittedAt}>
                {formatTimestamp(ticket.snapshot.submittedAt)}
              </time>
            </p>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Message and attachments you sent
              </summary>
              <p className="mt-2 whitespace-pre-wrap break-words">{ticket.snapshot.message}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {sortAttachments(
                  ticket.attachments.filter((a) => a.purpose !== "support_reply_take"),
                ).map((a) => (
                  <AttachmentCard key={a.id} ticketId={ticket.id} attachment={a} />
                ))}
              </div>
            </details>
          </header>

          <section aria-labelledby="customer-replies-title" className="flex flex-col gap-3">
            <h3 id="customer-replies-title" className="hud-label">
              Replies ({ticket.replies.length})
            </h3>
            <ReplyThread
              ticketId={ticket.id}
              replies={ticket.replies}
              emptyText="No replies yet. A reply appears here after a Demo Support teammate writes one."
            />
          </section>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {poll.updatedAt ? (
              <span>Last checked {new Date(poll.updatedAt).toLocaleTimeString()}</span>
            ) : null}
            {poll.error ? (
              <span className="text-warning">
                Could not refresh: {errorMessage(poll.error)}
                {poll.stopped ? "" : " Retrying."}
              </span>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={poll.refresh}>
              <RefreshCw aria-hidden />
              Refresh
            </Button>
          </div>
        </article>
      ) : null}
    </div>
  );
}
