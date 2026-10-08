import { z } from "zod";
import { Id, Purpose, Timestamp } from "./common.ts";
import { LIMITS } from "./limits.ts";

export const HighlightField = z.enum([
  "movement",
  "count",
  "timing",
  "magnitude",
  "start",
  "end",
  "other",
]);
export type HighlightField = z.infer<typeof HighlightField>;

/** established = pale green (kept detail); correction = pale terracotta/magenta (newest change). */
export const HighlightKind = z.enum(["established", "correction"]);
export type HighlightKind = z.infer<typeof HighlightKind>;

/**
 * Server-validated keyword span over the EXACT stored message text (spec 6).
 * Offsets are UTF-16 code units, half-open [start, end), i.e. `text.slice(start, end)`.
 */
export const HighlightSpan = z
  .object({
    messageId: Id,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    field: HighlightField,
    label: z.string().min(1).max(40),
    kind: HighlightKind,
  })
  .refine((s) => s.end > s.start, { message: "end must be greater than start" });
export type HighlightSpan = z.infer<typeof HighlightSpan>;

/** Who wrote a conversation message. `planner` = Gemini's user-facing final explanation. */
export const MessageRole = z.enum(["user", "planner"]);
export type MessageRole = z.infer<typeof MessageRole>;

/**
 * account = original "What happened" (immutable), actions_tried = "What I tried" (immutable),
 * correction = later refinement, answer = reply to a clarification question,
 * understanding / clarification = planner output shown in the conversation.
 */
export const MessageKind = z.enum([
  "account",
  "actions_tried",
  "correction",
  "answer",
  "understanding",
  "clarification",
]);
export type MessageKind = z.infer<typeof MessageKind>;

export const Message = z.object({
  id: Id,
  caseId: Id,
  purpose: Purpose,
  role: MessageRole,
  kind: MessageKind,
  text: z.string(),
  planRevisionId: Id.nullable(),
  highlights: z.array(HighlightSpan).max(LIMITS.maxHighlightsPerMessage),
  createdAt: Timestamp,
});
export type Message = z.infer<typeof Message>;

/** Returns true when `span` is a valid, in-bounds span of `text` (no overlap check). */
export function isSpanInBounds(text: string, span: { start: number; end: number }): boolean {
  return (
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start &&
    span.end <= text.length
  );
}
