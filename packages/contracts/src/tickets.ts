import { z } from "zod";
import {
  AssessmentUiStatus,
  ClientRequestId,
  Id,
  Purpose,
  ReviewState,
  Sha256,
  SourceType,
  Timestamp,
} from "./common.ts";
import { LIMITS } from "./limits.ts";

export const TicketStatus = z.enum(["submitted", "replied", "revoked"]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const TicketAttachmentPurpose = z.enum([
  "customer_reference",
  "customer_take",
  "customer_original",
  "support_reply_take",
]);
export type TicketAttachmentPurpose = z.infer<typeof TicketAttachmentPurpose>;

/** Exact allowed media + hash granted through a ticket (spec 5 "Thread attachment permissions"). */
export const TicketAttachment = z.object({
  id: Id,
  ticketId: Id,
  /** Opaque media id used in /api/tickets/:id/attachments/:assetId/{media,download}. */
  assetId: Id,
  purpose: TicketAttachmentPurpose,
  mime: z.string(),
  sha256: Sha256,
  sizeBytes: z.number().int().nonnegative(),
  filename: z.string(),
  durationMs: z.number().nonnegative().nullable(),
  mediaUrl: z.string(),
  downloadUrl: z.string(),
  createdAt: Timestamp,
});
export type TicketAttachment = z.infer<typeof TicketAttachment>;

/** Immutable snapshot frozen at submission. Later case edits never change it. */
export const TicketSnapshot = z.object({
  caseTitle: z.string(),
  purpose: Purpose,
  purposeLabel: z.string(),
  productLabel: z.string(),
  sourceType: SourceType,
  modelLabel: z.string().nullable(),
  originalAccount: z.string(),
  actionsTried: z.string(),
  unresolved: z.array(z.string()),
  takeId: Id,
  takeNumber: z.number().int().positive(),
  finalSha256: Sha256,
  caption: z.string(),
  durationMs: z.number().nonnegative().nullable(),
  assessmentStatus: AssessmentUiStatus,
  assessmentSummary: z.string().nullable(),
  reviewState: ReviewState,
  uncertaintyNote: z.string().nullable(),
  /** The customer's edited message as sent. */
  message: z.string(),
  submittedAt: Timestamp,
});
export type TicketSnapshot = z.infer<typeof TicketSnapshot>;

export const TicketReply = z.object({
  id: Id,
  ticketId: Id,
  authorRole: z.literal("support"),
  authorLabel: z.string(),
  text: z.string(),
  attachment: TicketAttachment.nullable(),
  createdAt: Timestamp,
});
export type TicketReply = z.infer<typeof TicketReply>;

/** GET /api/tickets/:id (owner customer or support). */
export const Ticket = z.object({
  id: Id,
  queue: z.string(),
  status: TicketStatus,
  snapshot: TicketSnapshot,
  attachments: z.array(TicketAttachment),
  replies: z.array(TicketReply),
  /** Agent work cases created from this ticket (visible to support only; [] for customers). */
  workCaseIds: z.array(Id),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Ticket = z.infer<typeof Ticket>;

/** Compact ticket row inside CaseDetail (customer's own tickets). */
export const TicketSummary = z.object({
  id: Id,
  status: TicketStatus,
  queue: z.string(),
  takeId: Id,
  takeNumber: z.number().int().positive(),
  replyCount: z.number().int().nonnegative(),
  lastReplyAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type TicketSummary = z.infer<typeof TicketSummary>;

/** GET /api/support/tickets row (submitted queue only). */
export const SupportInboxRow = z.object({
  id: Id,
  status: TicketStatus,
  queue: z.string(),
  caseTitle: z.string(),
  productLabel: z.string(),
  purpose: Purpose,
  excerpt: z.string(),
  assessmentStatus: AssessmentUiStatus,
  reviewState: ReviewState,
  replyCount: z.number().int().nonnegative(),
  /** Live customer attachments (reference, take, optional original). Optional: additive field. */
  attachmentCount: z.number().int().nonnegative().optional(),
  lastReplyAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type SupportInboxRow = z.infer<typeof SupportInboxRow>;

export const SupportInboxResponse = z.object({ tickets: z.array(SupportInboxRow) });
export type SupportInboxResponse = z.infer<typeof SupportInboxResponse>;

/** GET /api/cases/:caseId/tickets (owner customer): the case's own tickets, newest first. */
export const CaseTicketsResponse = z.object({ tickets: z.array(TicketSummary) });
export type CaseTicketsResponse = z.infer<typeof CaseTicketsResponse>;

/** Author label shown on support replies (never a fabricated agent name or presence). */
export const SUPPORT_REPLY_AUTHOR_LABEL = "Demo Support";

/**
 * POST /api/cases/:id/tickets. The canonical normalized reference and the accepted take are always
 * attached (named in the confirmation panel); the untouched original is optional.
 * Same idempotencyKey -> same ticket.
 */
export const CreateTicketRequest = z.object({
  takeId: Id,
  message: z.string().min(1).max(LIMITS.ticketMessageMaxChars),
  includeOriginal: z.boolean(),
  idempotencyKey: ClientRequestId,
});
export type CreateTicketRequest = z.infer<typeof CreateTicketRequest>;

export const TicketResponse = z.object({ ticket: Ticket });
export type TicketResponse = z.infer<typeof TicketResponse>;

/** POST /api/tickets/:id/replies (support). attachTakeId must be an accepted solution take of this ticket's work case. */
export const CreateReplyRequest = z.object({
  text: z.string().min(1).max(LIMITS.replyTextMaxChars),
  attachTakeId: Id.nullable(),
  idempotencyKey: ClientRequestId,
});
export type CreateReplyRequest = z.infer<typeof CreateReplyRequest>;

/** POST /api/tickets/:id/work-case (support): agent-owned solution case copied from the submitted reference. */
export const CreateWorkCaseRequest = z.object({
  idempotencyKey: ClientRequestId,
  title: z.string().max(LIMITS.titleMaxChars).optional(),
});
export type CreateWorkCaseRequest = z.infer<typeof CreateWorkCaseRequest>;

export const CreateWorkCaseResponse = z.object({ caseId: Id });
export type CreateWorkCaseResponse = z.infer<typeof CreateWorkCaseResponse>;
