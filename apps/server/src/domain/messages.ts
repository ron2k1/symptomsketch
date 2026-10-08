// Conversation messages (spec 10 "Message"). The original account and actions tried are stored
// once as immutable messages; corrections/answers are user messages; the planner's concise
// understanding and clarification question are planner messages. Highlights are server-validated
// spans over the exact stored text (providers/spans.ts).
import {
  HighlightSpan,
  type Message,
  type MessageKind,
  type MessageRole,
  type Purpose,
} from "@symptomsketch/contracts";
import { type Db, allRows, fromJson, getRow, newId, toJson } from "../db/index.ts";
import { sanitizeStoredSpans } from "../providers/spans.ts";

export interface MessageRow {
  id: string;
  case_id: string;
  purpose: Purpose;
  role: MessageRole;
  kind: MessageKind;
  text: string;
  plan_revision_id: string | null;
  highlights_json: string;
  created_at: string;
}

function parseHighlights(row: MessageRow): HighlightSpan[] {
  const raw = fromJson<unknown[]>(row.highlights_json, []);
  const spans = raw.flatMap((s) => {
    const parsed = HighlightSpan.safeParse(s);
    return parsed.success && parsed.data.messageId === row.id ? [parsed.data] : [];
  });
  return sanitizeStoredSpans(row.text, spans);
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    caseId: row.case_id,
    purpose: row.purpose,
    role: row.role,
    kind: row.kind,
    text: row.text,
    planRevisionId: row.plan_revision_id,
    highlights: parseHighlights(row),
    createdAt: row.created_at,
  };
}

/** All messages of a case in conversation order (for CaseDetail). */
export function listMessages(db: Db, caseId: string): Message[] {
  return allRows<MessageRow>(
    db,
    "SELECT * FROM messages WHERE case_id = ? ORDER BY created_at, rowid",
    caseId,
  ).map(toMessage);
}

export function listMessagesForPlan(db: Db, planRevisionId: string): Message[] {
  return allRows<MessageRow>(
    db,
    "SELECT * FROM messages WHERE plan_revision_id = ? ORDER BY created_at, rowid",
    planRevisionId,
  ).map(toMessage);
}

/** The stored message of one kind for a purpose (account / actions_tried), if any. */
export function findMessageOfKind(
  db: Db,
  caseId: string,
  purpose: Purpose,
  kind: MessageKind,
): MessageRow | undefined {
  return getRow<MessageRow>(
    db,
    `SELECT * FROM messages WHERE case_id = ? AND purpose = ? AND kind = ?
     ORDER BY created_at, rowid LIMIT 1`,
    caseId,
    purpose,
    kind,
  );
}

/** User corrections and answers for a purpose, newest first. */
export function listUserCorrections(db: Db, caseId: string, purpose: Purpose): MessageRow[] {
  return allRows<MessageRow>(
    db,
    `SELECT * FROM messages WHERE case_id = ? AND purpose = ? AND role = 'user'
       AND kind IN ('correction','answer') ORDER BY created_at DESC, rowid DESC`,
    caseId,
    purpose,
  );
}

export interface NewMessage {
  id?: string;
  caseId: string;
  purpose: Purpose;
  role: MessageRole;
  kind: MessageKind;
  text: string;
  planRevisionId: string | null;
  highlights?: HighlightSpan[];
  createdAt: string;
}

/** Insert a message (call inside tx). Returns the stored row. */
export function insertMessage(db: Db, m: NewMessage): MessageRow {
  const row: MessageRow = {
    id: m.id ?? newId("msg"),
    case_id: m.caseId,
    purpose: m.purpose,
    role: m.role,
    kind: m.kind,
    text: m.text,
    plan_revision_id: m.planRevisionId,
    highlights_json: toJson(m.highlights ?? []),
    created_at: m.createdAt,
  };
  db.prepare(
    `INSERT INTO messages (id, case_id, purpose, role, kind, text, plan_revision_id,
       highlights_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.case_id,
    row.purpose,
    row.role,
    row.kind,
    row.text,
    row.plan_revision_id,
    row.highlights_json,
    row.created_at,
  );
  return row;
}

/** Replace a message's highlights (re-sanitized against its text). Text is never changed. */
export function setHighlights(db: Db, messageId: string, spans: readonly HighlightSpan[]): void {
  const row = getRow<MessageRow>(db, "SELECT * FROM messages WHERE id = ?", messageId);
  if (!row) return;
  const clean = sanitizeStoredSpans(
    row.text,
    spans.filter((s) => s.messageId === messageId),
  );
  db.prepare("UPDATE messages SET highlights_json = ? WHERE id = ?").run(toJson(clean), messageId);
}

/** Link a message (e.g. the reused account) to the plan revision that last interpreted it. */
export function linkMessageToPlan(db: Db, messageId: string, planRevisionId: string): void {
  db.prepare("UPDATE messages SET plan_revision_id = ? WHERE id = ?").run(
    planRevisionId,
    messageId,
  );
}

export function getMessage(db: Db, messageId: string): Message | null {
  const row = getRow<MessageRow>(db, "SELECT * FROM messages WHERE id = ?", messageId);
  return row ? toMessage(row) : null;
}
