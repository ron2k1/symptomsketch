import type {
  CaseDetail,
  ErrorCode,
  ProductRevision,
  Purpose,
  Take,
  Ticket,
  TicketAttachment,
  TicketSummary,
} from "@symptomsketch/contracts";
import { isApiClientError } from "@/lib/api";
import { ATTACHMENT_ORDER } from "./labels";

/** A take that may be attached to a ticket or reply: accepted, exported, complete, hashed. */
export function isAcceptedTake(take: Take): boolean {
  return (
    take.reviewState === "accepted" &&
    take.processingState === "ready" &&
    take.captureStatus === "complete" &&
    take.sha256 !== null
  );
}

/** Accepted takes of one purpose, newest take number first. */
export function acceptedTakes(takes: readonly Take[], purpose: Purpose): Take[] {
  return takes
    .filter((t) => t.purpose === purpose && isAcceptedTake(t))
    .sort((a, b) => b.number - a.number);
}

export type SupportTakeResolution =
  | { kind: "selected"; take: Take; accepted: Take[] }
  | { kind: "not_accepted"; selected: Take; accepted: Take[] }
  | { kind: "choose"; accepted: Take[] }
  | { kind: "none" };

/**
 * Which take the customer Support tab works with. Only the selected take is ever used for the
 * ticket, download and copied explanation; nothing is auto-selected behind the user's back.
 */
export function resolveSupportTake(
  caseData: Pick<CaseDetail, "takes">,
  selectedTakeId: string | null,
): SupportTakeResolution {
  const accepted = acceptedTakes(caseData.takes, "problem");
  const selected = selectedTakeId ? caseData.takes.find((t) => t.id === selectedTakeId) : undefined;
  if (selected && selected.purpose === "problem" && isAcceptedTake(selected)) {
    return { kind: "selected", take: selected, accepted };
  }
  if (selected) return { kind: "not_accepted", selected, accepted };
  if (accepted.length > 0) return { kind: "choose", accepted };
  return { kind: "none" };
}

/**
 * The take to open in Recreate when nothing can be sent yet: the selected one, else the newest
 * saved problem take that finished exporting. Null when there is nothing saved to review.
 */
export function takeToReview(
  caseData: Pick<CaseDetail, "takes">,
  selectedTakeId: string | null,
): Take | null {
  const selected = selectedTakeId ? caseData.takes.find((t) => t.id === selectedTakeId) : undefined;
  if (selected) return selected;
  const saved = caseData.takes.filter(
    (t) =>
      t.purpose === "problem" && t.captureStatus === "complete" && t.processingState === "ready",
  );
  return saved.sort((a, b) => b.number - a.number)[0] ?? null;
}

/** The product revision frozen on a take (older takes keep their own reference). */
export function productForTake(
  caseData: Pick<CaseDetail, "products" | "product">,
  take: Take,
): ProductRevision | null {
  const match = caseData.products.find((p) => p.id === take.productRevisionId);
  if (match) return match;
  return caseData.product?.id === take.productRevisionId ? caseData.product : null;
}

export function ticketToSummary(ticket: Ticket): TicketSummary {
  const last = ticket.replies.at(-1);
  return {
    id: ticket.id,
    status: ticket.status,
    queue: ticket.queue,
    takeId: ticket.snapshot.takeId,
    takeNumber: ticket.snapshot.takeNumber,
    replyCount: ticket.replies.length,
    lastReplyAt: last ? last.createdAt : null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

/** Server summaries plus tickets created in this view, de-duplicated by id, newest first. */
export function mergeTickets(
  summaries: readonly TicketSummary[],
  created: readonly Ticket[],
): TicketSummary[] {
  const byId = new Map<string, TicketSummary>();
  for (const s of summaries) byId.set(s.id, s);
  for (const t of created) {
    const existing = byId.get(t.id);
    const fresh = ticketToSummary(t);
    if (!existing || existing.updatedAt < fresh.updatedAt) byId.set(t.id, fresh);
  }
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Newest non-revoked ticket that carries this take. */
export function ticketForTake(
  tickets: readonly TicketSummary[],
  takeId: string,
): TicketSummary | null {
  return tickets.find((t) => t.takeId === takeId && t.status !== "revoked") ?? null;
}

/**
 * Text placed on the clipboard for an external email: subject line, blank line, edited body. An
 * uncertainty note from the customer's review is kept (spec 4) when the edit dropped it.
 */
export function emailText(
  subject: string,
  body: string,
  uncertaintyNote: string | null = null,
): string {
  const s = subject.trim();
  const note = uncertaintyNote?.trim();
  const fullBody = note && !body.includes(note) ? `${body}\n\nMy review note: ${note}` : body;
  return s ? `Subject: ${s}\n\n${fullBody}` : fullBody;
}

export function sortAttachments(attachments: readonly TicketAttachment[]): TicketAttachment[] {
  return [...attachments].sort((a, b) => ATTACHMENT_ORDER[a.purpose] - ATTACHMENT_ORDER[b.purpose]);
}

const AUTH_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "SESSION_EXPIRED",
  "ACCESS_REQUIRED",
  "SUPPORT_FORBIDDEN",
  "FORBIDDEN",
]);

/** The staff session is missing, expired or not a support role: show the login card again. */
export function isAuthError(err: unknown): boolean {
  return isApiClientError(err) && err.code !== "NETWORK_ERROR" && AUTH_CODES.has(err.code);
}

/** Errors that polling should not retry: the resource is gone or access was lost. */
export function isTerminalError(err: unknown): boolean {
  if (isAuthError(err)) return true;
  return isApiClientError(err) && (err.code === "NOT_FOUND" || err.code === "CASE_INACTIVE");
}
