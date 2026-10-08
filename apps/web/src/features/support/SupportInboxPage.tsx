import { useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { Inbox, Paperclip, RefreshCw } from "lucide-react";
import {
  APP_PATHS,
  ASSESSMENT_LABELS,
  SUPPORT_QUEUE_LABEL,
  type SupportInboxRow,
} from "@symptomsketch/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage, listSupportTickets } from "@/lib/api";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STAFF_TICKET_STATUS_LABELS } from "./labels";
import { isAuthError } from "./model";
import { SupportChecking, SupportShell } from "./SupportShell";
import { SupportLoginCard } from "./SupportLoginCard";
import { usePolling } from "./usePolling";
import { useSupportSession } from "./useSupportSession";

/** Attachment count when the server provides it (optional field on the inbox row). */
function attachmentCount(row: SupportInboxRow): number | null {
  return typeof row.attachmentCount === "number" ? row.attachmentCount : null;
}

function InboxRow({ row }: { row: SupportInboxRow }) {
  const count = attachmentCount(row);
  const fresh = row.status === "submitted";
  return (
    <li>
      <Link
        to={APP_PATHS.supportTicket(row.id)}
        className={cn(
          "grid gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-neon/60 hover:bg-surface-2 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-center",
          fresh && "border-l-2 border-l-neon",
        )}
      >
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.productLabel}</p>
          <p className="truncate text-xs text-muted-foreground">{row.caseTitle}</p>
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm">{row.excerpt || "No summary provided"}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Check: {ASSESSMENT_LABELS[row.assessmentStatus]}
            {row.replyCount > 0
              ? ` · ${row.replyCount} repl${row.replyCount === 1 ? "y" : "ies"}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-end">
          <Badge
            variant="outline"
            className={fresh ? "border-neon/50 bg-neon-soft text-neon" : undefined}
          >
            {STAFF_TICKET_STATUS_LABELS[row.status]}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            <time dateTime={row.createdAt}>{formatTimestamp(row.createdAt)}</time>
          </span>
          {count !== null ? (
            <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
              <Paperclip className="size-3" aria-hidden />
              {count} attachment{count === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function InboxQueue({ onAuthLost }: { onAuthLost(): void }) {
  const fetchInbox = useCallback(
    (signal: AbortSignal) => listSupportTickets({ signal }).then((r) => r.tickets),
    [],
  );
  const poll = usePolling("inbox", fetchInbox, { enabled: true, stopOn: isAuthError });

  useEffect(() => {
    if (poll.stopped && isAuthError(poll.error)) onAuthLost();
  }, [poll.stopped, poll.error, onAuthLost]);

  const rows = poll.data ?? [];
  return (
    <section aria-labelledby="inbox-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="hud-label">{SUPPORT_QUEUE_LABEL}</p>
          <h1 id="inbox-title" className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <Inbox className="size-6 text-neon" aria-hidden />
            Submitted tickets
          </h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {poll.updatedAt ? (
            <span>Last checked {new Date(poll.updatedAt).toLocaleTimeString()}</span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            onClick={poll.refresh}
            aria-label="Refresh ticket queue"
          >
            <RefreshCw aria-hidden />
          </Button>
        </div>
      </div>

      {poll.error && !isAuthError(poll.error) ? (
        <p role="alert" className="text-sm text-warning">
          Could not refresh the queue: {errorMessage(poll.error)} Retrying.
        </p>
      ) : null}

      {poll.loading && !poll.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the queue
        </p>
      ) : null}

      {poll.data && rows.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          No submitted tickets yet. A ticket appears here after a customer selects Send to Demo
          Support.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label="Ticket queue">
          {rows.map((row) => (
            <InboxRow key={row.id} row={row} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Route "/support": staff login card, then the submitted-ticket queue (polled every 3 s). */
export function SupportInboxPage() {
  const session = useSupportSession();
  return (
    <SupportShell>
      {session.status === "checking" ? <SupportChecking /> : null}
      {session.status === "signed_out" ? (
        <SupportLoginCard
          signIn={session.signIn}
          customerSession={session.customerSession}
          expired={session.expired}
        />
      ) : null}
      {session.status === "support" ? <InboxQueue onAuthLost={session.markSignedOut} /> : null}
    </SupportShell>
  );
}
