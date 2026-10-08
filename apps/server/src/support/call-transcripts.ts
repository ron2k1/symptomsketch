import {
  LIMITS,
  SupportCallTranscriptLine,
  type CreateSupportCallTranscriptRequest,
  type SupportCallTranscript,
} from "@symptomsketch/contracts";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { allRows, fromJson, getRow, newId, now, toJson, type Db } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import type { TicketRow } from "./rows.ts";

/**
 * Final transcripts of live AI support agent calls, stored on the ticket so Demo Support sees what
 * the agent and the customer said ("AI support agent call transcript"). The browser reports the
 * settled lines after end_call + disconnect; the same idempotency key returns the same record.
 */

interface TranscriptRow {
  id: string;
  ticket_id: string;
  session_id: string;
  lines_json: string;
  duration_seconds: number;
  end_reason: string | null;
  idempotency_key: string;
  created_at: string;
}

const Lines = z.array(SupportCallTranscriptLine);

function toDto(row: TranscriptRow): SupportCallTranscript {
  const parsed = Lines.safeParse(fromJson<unknown>(row.lines_json, []));
  return {
    id: row.id,
    ticketId: row.ticket_id,
    lines: parsed.success ? parsed.data : [],
    durationSeconds: row.duration_seconds,
    endReason: row.end_reason,
    createdAt: row.created_at,
  };
}

export function listCallTranscripts(db: Db, ticketId: string): SupportCallTranscript[] {
  return allRows<TranscriptRow>(
    db,
    "SELECT * FROM support_call_transcripts WHERE ticket_id = ? ORDER BY created_at, id",
    ticketId,
  ).map(toDto);
}

export function saveCallTranscript(
  ctx: AppContext,
  session: SessionInfo,
  ticket: TicketRow,
  input: CreateSupportCallTranscriptRequest,
): { transcript: SupportCallTranscript; created: boolean } {
  const existing = getRow<TranscriptRow>(
    ctx.db,
    `SELECT * FROM support_call_transcripts
       WHERE ticket_id = ? AND session_id = ? AND idempotency_key = ?`,
    ticket.id,
    session.id,
    input.idempotencyKey,
  );
  if (existing) return { transcript: toDto(existing), created: false };
  // The browser writes these, so bound what one ticket can collect.
  const stored = getRow<{ n: number }>(
    ctx.db,
    "SELECT COUNT(*) AS n FROM support_call_transcripts WHERE ticket_id = ?",
    ticket.id,
  );
  if ((stored?.n ?? 0) >= LIMITS.supportCallTranscriptsPerTicket) {
    throw new AppError("RATE_LIMITED");
  }
  const id = newId("sct");
  ctx.db
    .prepare(
      `INSERT INTO support_call_transcripts (id, ticket_id, session_id, lines_json,
         duration_seconds, end_reason, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ticket.id,
      session.id,
      toJson(input.lines),
      Math.round(input.durationSeconds),
      input.endReason,
      input.idempotencyKey,
      now(),
    );
  console.log(
    `[support-call] transcript stored ticket=${ticket.id} lines=${input.lines.length} ` +
      `seconds=${Math.round(input.durationSeconds)}`,
  );
  const row = getRow<TranscriptRow>(
    ctx.db,
    "SELECT * FROM support_call_transcripts WHERE id = ?",
    id,
  )!;
  return { transcript: toDto(row), created: true };
}
