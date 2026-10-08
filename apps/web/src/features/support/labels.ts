import type { ReviewState, TicketAttachmentPurpose, TicketStatus } from "@symptomsketch/contracts";

/** Shown on the customer Support tab (spec 5): honest scope of the demo queue. */
export const SUPPORT_NOTICE = "Demo support inbox · No manufacturer is contacted.";

/** Staff header on /support and /support/tickets/:id (next to the BrandLogo wordmark). */
export const STAFF_HEADER_AREA = "Demo Support workspace";

/** Status copy the customer sees. "Received" only ever renders from a server-returned ticket. */
export const CUSTOMER_TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  submitted: "Received by Demo Support",
  replied: "Demo Support replied",
  revoked: "No longer available",
};

/** Status copy staff see in the queue and on the ticket page. */
export const STAFF_TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  submitted: "Awaiting reply",
  replied: "Replied",
  revoked: "Revoked",
};

export const ATTACHMENT_PURPOSE_LABELS: Record<TicketAttachmentPurpose, string> = {
  customer_reference: "Product reference (normalized)",
  customer_take: "Reviewed MP4",
  customer_original: "Untouched original photo",
  support_reply_take: "Instructional reply clip",
};

/** Order attachments read in: reference, reviewed clip, optional original, then replies. */
export const ATTACHMENT_ORDER: Record<TicketAttachmentPurpose, number> = {
  customer_reference: 0,
  customer_take: 1,
  customer_original: 2,
  support_reply_take: 3,
};

/** How staff read the customer's human review of the submitted clip. */
export const STAFF_REVIEW_LABELS: Record<ReviewState, string> = {
  accepted: "Accepted by the customer",
  uncertain: "Customer marked it unsure",
  rejected: "Customer asked to keep refining",
  unreviewed: "Not reviewed",
};

/** First 12 hex chars of a SHA-256, for display next to the full value in a title attribute. */
export function shortHash(sha256: string): string {
  return sha256.slice(0, 12);
}
