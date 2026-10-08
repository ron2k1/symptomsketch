import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Clapperboard, Send, Video } from "lucide-react";
import {
  APP_PATHS,
  REVIEW_ACTION_LABELS,
  SUPPORT_CALL_AGENT_NAME,
  storyPaths,
  takeShelfLabel,
  type CaseDetail,
  type Take,
  type Ticket,
} from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { formatTakeNumber } from "@/lib/format";
import { CustomerTicketThread } from "./CustomerTicketThread";
import { SUPPORT_NOTICE, SUPPORT_SEND_BUTTON_ID } from "./labels";
import {
  mergeTickets,
  productForTake,
  resolveSupportTake,
  takeToReview,
  ticketForTake,
  type SupportTakeResolution,
} from "./model";
import { SupportCall } from "./SupportCall";
import { TicketPrepPanel } from "./TicketPrepPanel";

export interface CustomerSupportTabProps {
  caseId: string;
  caseData: CaseDetail;
  selectedTakeId: string | null;
  onSelectTake(id: string): void;
  /** Optional: lets the workspace refetch the case after a ticket is stored. */
  onTicketCreated?(ticket: Ticket): void;
}

function TakeChooser(props: {
  accepted: readonly Take[];
  selectedTakeId: string | null;
  onSelectTake(id: string): void;
}) {
  if (props.accepted.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Accepted takes">
      {props.accepted.map((t) => (
        <Button
          key={t.id}
          type="button"
          size="sm"
          variant={t.id === props.selectedTakeId ? "secondary" : "outline"}
          aria-pressed={t.id === props.selectedTakeId}
          className="min-h-11"
          onClick={() => props.onSelectTake(t.id)}
        >
          Use {formatTakeNumber(t.number)}
        </Button>
      ))}
    </div>
  );
}

/** Recreate with the take to review already open (its card there has Send to support). */
function RecreateLink({ caseId, take }: { caseId: string; take: Take | null }) {
  const path = APP_PATHS.caseTab(caseId, "recreate");
  return (
    <Button asChild className="min-h-11">
      <Link to={take ? `${path}?take=${encodeURIComponent(take.id)}` : path}>
        <Clapperboard aria-hidden />
        {take ? `Open ${formatTakeNumber(take.number)} in Recreate` : "Go to Recreate"}
      </Link>
    </Button>
  );
}

function RecreatePrompt(props: { caseId: string; text: string; take: Take | null }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed bg-surface-2 p-4">
      <p className="text-sm text-muted-foreground">{props.text}</p>
      <RecreateLink caseId={props.caseId} take={props.take} />
    </div>
  );
}

/**
 * The call slot before any ticket exists: Sam only joins a stored ticket, so this says why and
 * offers the next step right here (send, pick a take, open the take to review, or Story mode).
 */
function CallNeedsTicket(props: {
  caseData: CaseDetail;
  resolution: SupportTakeResolution;
  reviewTake: Take | null;
  onSelectTake(id: string): void;
}) {
  const { caseData, resolution, reviewTake } = props;
  const newestAccepted = resolution.kind === "choose" ? resolution.accepted[0] : undefined;
  const canTellStory =
    caseData.mode === "problem" &&
    caseData.product !== null &&
    caseData.originalAccount.trim().length > 0;
  return (
    <section
      aria-labelledby="support-call-title"
      className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4"
    >
      <h3 id="support-call-title" className="flex items-center gap-2 text-base font-semibold">
        <Video className="size-4" aria-hidden />
        Talk to {SUPPORT_CALL_AGENT_NAME}, an AI support agent
      </h3>
      <p className="text-sm text-muted-foreground">
        {SUPPORT_CALL_AGENT_NAME} reads your ticket and watches your clip before talking, so the
        call opens as soon as this case has a ticket with Demo Support.
        {canTellStory ? " Sending a story opens the ticket too." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {resolution.kind === "selected" ? (
          <Button
            type="button"
            className="min-h-11"
            onClick={() => document.getElementById(SUPPORT_SEND_BUTTON_ID)?.focus()}
          >
            <Send aria-hidden />
            Review and send {formatTakeNumber(resolution.take.number)}
          </Button>
        ) : newestAccepted ? (
          <Button
            type="button"
            className="min-h-11"
            onClick={() => props.onSelectTake(newestAccepted.id)}
          >
            Use {formatTakeNumber(newestAccepted.number)}
          </Button>
        ) : (
          <RecreateLink caseId={caseData.id} take={reviewTake} />
        )}
        {canTellStory ? (
          <Button asChild variant="outline" className="min-h-11">
            <Link to={storyPaths.page(caseData.id)}>Tell it as a story</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** Agent work cases are attached from the ticket page, not sent as customer tickets. */
function WorkCaseNotice({ caseData }: { caseData: CaseDetail }) {
  return (
    <section className="flex flex-col items-start gap-3 p-4">
      <p className="hud-label">Demonstration work case</p>
      <p className="max-w-prose text-sm text-muted-foreground">
        This case belongs to Demo Support. Record and accept a solution take in Recreate, then
        attach it to a reply from the ticket page.
      </p>
      {caseData.sourceTicketId ? (
        <Button asChild variant="outline" className="min-h-11">
          <Link to={APP_PATHS.supportTicket(caseData.sourceTicketId)}>
            <ArrowLeft aria-hidden />
            Back to ticket
          </Link>
        </Button>
      ) : null}
    </section>
  );
}

/**
 * The customer's Support tab (spec 5, 6, 13): ticket preparation for the selected accepted take,
 * manual email handoff, and the thread of this case's stored tickets.
 */
export function CustomerSupportTab(props: CustomerSupportTabProps) {
  const { caseId, caseData, selectedTakeId, onSelectTake, onTicketCreated } = props;
  const [created, setCreated] = useState<Ticket[]>([]);
  const [viewTicketId, setViewTicketId] = useState<string | null>(null);

  if (caseData.ownerRole === "support") return <WorkCaseNotice caseData={caseData} />;

  const resolution = resolveSupportTake(caseData, selectedTakeId);
  const tickets = mergeTickets(caseData.tickets, created);
  const take = resolution.kind === "selected" ? resolution.take : null;
  const reviewTake = takeToReview(caseData, selectedTakeId);
  const existingTicket = take ? ticketForTake(tickets, take.id) : null;
  const activeTicketId =
    (viewTicketId && tickets.some((t) => t.id === viewTicketId) ? viewTicketId : null) ??
    existingTicket?.id ??
    tickets[0]?.id ??
    null;

  function handleSent(ticket: Ticket) {
    setCreated((prev) => [...prev.filter((t) => t.id !== ticket.id), ticket]);
    setViewTicketId(ticket.id);
    onTicketCreated?.(ticket);
  }

  return (
    <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section aria-labelledby="support-prep-title" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="support-prep-title" className="text-xl font-semibold">
            Send to Demo Support
          </h2>
          <p className="font-mono text-xs text-muted-foreground">{SUPPORT_NOTICE}</p>
        </div>

        {resolution.kind === "selected" ? (
          <>
            <TakeChooser
              accepted={resolution.accepted}
              selectedTakeId={selectedTakeId}
              onSelectTake={onSelectTake}
            />
            <TicketPrepPanel
              caseId={caseId}
              take={resolution.take}
              product={productForTake(caseData, resolution.take)}
              existingTicket={existingTicket}
              onSent={handleSent}
            />
          </>
        ) : null}

        {resolution.kind === "not_accepted" ? (
          <>
            <p className="text-sm">
              {formatTakeNumber(resolution.selected.number)} status:{" "}
              <span className="font-medium">{takeShelfLabel(resolution.selected)}</span>. Only a
              take you accepted with {REVIEW_ACTION_LABELS.problem.accept} can be sent or downloaded
              here.
            </p>
            {resolution.accepted.length > 0 ? (
              <TakeChooser
                accepted={resolution.accepted}
                selectedTakeId={selectedTakeId}
                onSelectTake={onSelectTake}
              />
            ) : (
              <RecreatePrompt
                caseId={caseId}
                take={reviewTake}
                text="Review it in Recreate first: accept it there, or use Send to support on its card."
              />
            )}
          </>
        ) : null}

        {resolution.kind === "choose" ? (
          <>
            <p className="text-sm text-muted-foreground">Choose the accepted take to send.</p>
            <TakeChooser
              accepted={resolution.accepted}
              selectedTakeId={selectedTakeId}
              onSelectTake={onSelectTake}
            />
          </>
        ) : null}

        {resolution.kind === "none" ? (
          <RecreatePrompt
            caseId={caseId}
            take={reviewTake}
            text={
              reviewTake
                ? `No accepted take yet. ${formatTakeNumber(reviewTake.number)} is saved: open it in Recreate to review it, or use Send to support on its card.`
                : "No accepted take yet. Clip a take in Recreate and choose Matches my description to attach it here."
            }
          />
        ) : null}
      </section>

      <section aria-labelledby="support-thread-title" className="flex min-w-0 flex-col gap-4">
        <h2 id="support-thread-title" className="text-xl font-semibold">
          Your support thread
        </h2>
        {activeTicketId ? (
          <SupportCall key={activeTicketId} ticketId={activeTicketId} />
        ) : (
          <CallNeedsTicket
            caseData={caseData}
            resolution={resolution}
            reviewTake={reviewTake}
            onSelectTake={onSelectTake}
          />
        )}
        <CustomerTicketThread
          tickets={tickets}
          activeTicketId={activeTicketId}
          onSelectTicket={setViewTicketId}
          seed={created.find((t) => t.id === activeTicketId) ?? null}
        />
      </section>
    </div>
  );
}
