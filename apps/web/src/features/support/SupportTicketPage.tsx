import { useCallback, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { APP_PATHS, type Ticket } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { errorMessage, getTicket, isApiClientError } from "@/lib/api";
import { useDocumentTitle } from "@/lib/document-title";
import { CallTranscripts } from "./CallTranscripts";
import { DemonstrationPanel } from "./DemonstrationPanel";
import { TicketStorySection } from "@/features/story/TicketStorySection";
import { isAuthError, isTerminalError } from "./model";
import { ReplyComposer } from "./ReplyComposer";
import { ReplyThread } from "./ReplyThread";
import { SupportChecking, SupportShell } from "./SupportShell";
import { SupportLoginCard } from "./SupportLoginCard";
import { TicketSnapshotPanel } from "./TicketSnapshotPanel";
import { usePolling } from "./usePolling";
import { useSupportSession } from "./useSupportSession";
import { useWorkCaseTakes } from "./useWorkCaseTakes";

function TicketWorkspace({ ticketId, onAuthLost }: { ticketId: string; onAuthLost(): void }) {
  const fetchTicket = useCallback(
    (signal: AbortSignal) => getTicket(ticketId, { signal }).then((r) => r.ticket),
    [ticketId],
  );
  const poll = usePolling<Ticket>(ticketId, fetchTicket, {
    enabled: true,
    stopOn: isTerminalError,
  });
  const ticket = poll.data;
  // Adds the product once the ticket loads; SupportTicketPage sets the base title.
  useDocumentTitle("Support ticket", ticket?.snapshot.productLabel);
  const work = useWorkCaseTakes(ticket?.workCaseIds ?? [], ticket !== null);

  useEffect(() => {
    if (poll.stopped && isAuthError(poll.error)) onAuthLost();
  }, [poll.stopped, poll.error, onAuthLost]);

  if (!ticket) {
    if (poll.error) {
      const notFound = isApiClientError(poll.error) && poll.error.code === "NOT_FOUND";
      return (
        <div role="alert" className="flex flex-col items-start gap-3 py-10">
          <p className="text-sm text-destructive">
            {notFound
              ? "This ticket does not exist or is no longer available."
              : errorMessage(poll.error)}
          </p>
          {!poll.stopped ? (
            <Button type="button" variant="outline" onClick={poll.refresh}>
              <RefreshCw aria-hidden />
              Retry now
            </Button>
          ) : null}
        </div>
      );
    }
    return (
      <p role="status" className="hud-label py-16 text-center">
        Loading ticket
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <TicketSnapshotPanel ticket={ticket} />
        <TicketStorySection ticketId={ticket.id} />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <section aria-labelledby="staff-thread-title" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="staff-thread-title" className="hud-label">
              Thread ({ticket.replies.length} repl{ticket.replies.length === 1 ? "y" : "ies"})
            </h2>
            <span className="text-xs text-muted-foreground">
              {poll.updatedAt
                ? `Last checked ${new Date(poll.updatedAt).toLocaleTimeString()}`
                : ""}
              {poll.error ? ` · refresh failed: ${errorMessage(poll.error)}` : ""}
            </span>
          </div>
          <ReplyThread
            ticketId={ticket.id}
            replies={ticket.replies}
            emptyText="No replies yet. The customer sees each reply in their Support tab."
          />
        </section>
        <CallTranscripts transcripts={ticket.aiCallTranscripts} />
        <ReplyComposer
          ticket={ticket}
          onReplied={poll.setData}
          workCaseTakes={work.takes}
          takesLoading={work.loading}
          takesError={work.error}
          onRefreshTakes={work.refresh}
        />
        <DemonstrationPanel ticket={ticket} />
      </div>
    </div>
  );
}

/** Route "/support/tickets/:ticketId": snapshot, attachments, thread, reply + demonstration. */
export function SupportTicketPage() {
  const { ticketId = "" } = useParams();
  const session = useSupportSession();
  useDocumentTitle("Support ticket");
  return (
    <SupportShell
      headerAction={
        <Button asChild variant="ghost" className="min-h-11">
          <Link to={APP_PATHS.supportInbox()}>
            <ArrowLeft aria-hidden />
            Back to inbox
          </Link>
        </Button>
      }
    >
      {session.status === "checking" ? <SupportChecking /> : null}
      {session.status === "signed_out" ? (
        <SupportLoginCard
          signIn={session.signIn}
          customerSession={session.customerSession}
          expired={session.expired}
        />
      ) : null}
      {session.status === "support" && ticketId ? (
        <TicketWorkspace key={ticketId} ticketId={ticketId} onAuthLost={session.markSignedOut} />
      ) : null}
    </SupportShell>
  );
}
