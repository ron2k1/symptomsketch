import {
  SUPPORT_REPLY_AUTHOR_LABEL,
  paths,
  type SupportInboxRow,
  type Ticket,
  type TicketAttachment,
  type TicketReply,
  type TicketSnapshot,
  type TicketSummary,
} from "@symptomsketch/contracts";
import { allRows, fromJson, getRow } from "../db/index.ts";
import type { Db } from "../db/index.ts";
import { listCallTranscripts } from "./call-transcripts.ts";
import type { AttachmentRow, ReplyRow, TicketRow } from "./rows.ts";

/** Row -> DTO mapping for tickets. Read-only; every query here hits an index (polled every 3 s). */

const CUSTOMER_PURPOSES = "('customer_reference','customer_take','customer_original')";

interface AttachmentMediaRow extends AttachmentRow {
  mime: string;
  size_bytes: number;
  duration_ms: number | null;
}

const ATTACHMENT_SELECT = `SELECT ta.*, a.mime, a.size_bytes, a.duration_ms
  FROM ticket_attachments ta JOIN assets a ON a.id = ta.asset_id`;

export function parseSnapshot(row: Pick<TicketRow, "snapshot_json">): TicketSnapshot {
  return fromJson<TicketSnapshot>(row.snapshot_json, {} as TicketSnapshot);
}

function attachmentDto(row: AttachmentMediaRow): TicketAttachment {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    assetId: row.asset_id,
    purpose: row.purpose,
    mime: row.mime,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    filename: row.filename,
    durationMs: row.duration_ms,
    mediaUrl: paths.ticketAttachmentMedia(row.ticket_id, row.asset_id),
    downloadUrl: paths.ticketAttachmentDownload(row.ticket_id, row.asset_id),
    createdAt: row.created_at,
  };
}

/** Customer-submitted grants (reference, accepted take, optional original), oldest first. */
export function listCustomerAttachments(db: Db, ticketId: string): TicketAttachment[] {
  return allRows<AttachmentMediaRow>(
    db,
    `${ATTACHMENT_SELECT}
     WHERE ta.ticket_id = ? AND ta.revoked_at IS NULL AND a.deleted_at IS NULL
       AND ta.purpose IN ${CUSTOMER_PURPOSES}
     ORDER BY ta.created_at, ta.rowid`,
    ticketId,
  ).map(attachmentDto);
}

function getAttachmentDto(db: Db, attachmentId: string): TicketAttachment | null {
  const row = getRow<AttachmentMediaRow>(
    db,
    `${ATTACHMENT_SELECT} WHERE ta.id = ? AND ta.revoked_at IS NULL AND a.deleted_at IS NULL`,
    attachmentId,
  );
  return row ? attachmentDto(row) : null;
}

/** Actual persisted replies, chronological, with author role + timestamp. */
export function listReplies(db: Db, ticketId: string): TicketReply[] {
  return allRows<ReplyRow>(
    db,
    "SELECT * FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at, rowid",
    ticketId,
  ).map((r) => ({
    id: r.id,
    ticketId: r.ticket_id,
    authorRole: "support",
    authorLabel: SUPPORT_REPLY_AUTHOR_LABEL,
    text: r.text,
    attachment: r.attachment_id ? getAttachmentDto(db, r.attachment_id) : null,
    createdAt: r.created_at,
  }));
}

/** Work cases this support session created from the ticket (customers always get []). */
export function listWorkCaseIds(db: Db, ticketId: string, supportSessionId: string): string[] {
  return allRows<{ id: string }>(
    db,
    `SELECT id FROM cases
     WHERE source_ticket_id = ? AND owner_session_id = ? AND owner_role = 'support'
       AND status = 'active'
     ORDER BY created_at`,
    ticketId,
    supportSessionId,
  ).map((r) => r.id);
}

export function ticketDto(
  db: Db,
  row: TicketRow,
  viewer: { supportSessionId: string | null },
): Ticket {
  return {
    id: row.id,
    queue: row.queue,
    status: row.status,
    snapshot: parseSnapshot(row),
    attachments: listCustomerAttachments(db, row.id),
    replies: listReplies(db, row.id),
    workCaseIds: viewer.supportSessionId
      ? listWorkCaseIds(db, row.id, viewer.supportSessionId)
      : [],
    ...(viewer.supportSessionId ? { aiCallTranscripts: listCallTranscripts(db, row.id) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface SummaryRow extends TicketRow {
  reply_count: number;
  last_reply_at: string | null;
}

const SUMMARY_COLUMNS = `t.*,
    (SELECT COUNT(*) FROM ticket_replies r WHERE r.ticket_id = t.id) AS reply_count,
    (SELECT MAX(r.created_at) FROM ticket_replies r WHERE r.ticket_id = t.id) AS last_reply_at`;

const SUMMARY_SELECT = `SELECT ${SUMMARY_COLUMNS} FROM tickets t`;

function summaryDto(row: SummaryRow): TicketSummary {
  const snap = parseSnapshot(row);
  return {
    id: row.id,
    status: row.status,
    queue: row.queue,
    takeId: row.take_id,
    takeNumber: snap.takeNumber,
    replyCount: row.reply_count,
    lastReplyAt: row.last_reply_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The case's own tickets for the owner (newest first). server-core may call this to fill
 * CaseDetail.tickets; ownership of the case must already be checked by the caller.
 */
export function listTicketSummariesForCase(db: Db, caseId: string): TicketSummary[] {
  return allRows<SummaryRow>(
    db,
    `${SUMMARY_SELECT} WHERE t.case_id = ? AND t.status != 'revoked' ORDER BY t.created_at DESC, t.rowid DESC`,
    caseId,
  ).map(summaryDto);
}

const EXCERPT_CHARS = 160;

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_CHARS ? flat : `${flat.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
}

const INBOX_ATTACHMENT_COUNT = `(SELECT COUNT(*) FROM ticket_attachments ta
      JOIN assets a ON a.id = ta.asset_id
      WHERE ta.ticket_id = t.id AND ta.revoked_at IS NULL AND a.deleted_at IS NULL
        AND ta.purpose IN ${CUSTOMER_PURPOSES}) AS attachment_count`;

/** Submitted queue only: non-revoked tickets whose source case is still live. Newest first. */
export function listInbox(db: Db, at: string, limit = 200): SupportInboxRow[] {
  return allRows<SummaryRow & { attachment_count: number }>(
    db,
    `SELECT ${SUMMARY_COLUMNS}, ${INBOX_ATTACHMENT_COUNT}
     FROM tickets t JOIN cases c ON c.id = t.case_id
     WHERE t.status IN ('submitted','replied') AND c.status = 'active' AND c.expires_at > ?
     ORDER BY t.created_at DESC, t.rowid DESC
     LIMIT ?`,
    at,
    limit,
  ).map((row) => {
    const snap = parseSnapshot(row);
    return {
      id: row.id,
      status: row.status,
      queue: row.queue,
      caseTitle: snap.caseTitle,
      productLabel: snap.productLabel,
      purpose: snap.purpose,
      excerpt: excerpt(snap.message),
      assessmentStatus: snap.assessmentStatus,
      reviewState: snap.reviewState,
      replyCount: row.reply_count,
      attachmentCount: row.attachment_count,
      lastReplyAt: row.last_reply_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
