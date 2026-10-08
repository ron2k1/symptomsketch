// Keyword highlight validation (spec 6 "Highlighted words and visible reasoning").
// The planner proposes candidate spans; only spans that match the EXACT stored message text survive.
// Offsets are UTF-16 code units, half-open [start, end), i.e. `text.slice(start, end)`.
import {
  HIGHLIGHT_FIELD_LABELS,
  LIMITS,
  type HighlightField,
  type HighlightKind,
  type HighlightSpan,
} from "@symptomsketch/contracts";

/** Which stored message a planner span points at. */
export type SpanMessageRef = "account" | "correction";

/** A span exactly as the planner proposed it (untrusted). */
export interface CandidateSpan {
  messageRef: SpanMessageRef;
  quote: string;
  start: number;
  end: number;
  field: HighlightField;
  label: string;
}

/** A stored message a span may anchor to, with the tint its spans receive. */
export interface SpanTarget {
  ref: SpanMessageRef;
  messageId: string;
  text: string;
  kind: HighlightKind;
}

export type SpanRejectReason =
  | "stale"
  | "empty"
  | "too_long"
  | "out_of_range"
  | "not_found"
  | "ambiguous"
  | "split_surrogate"
  | "overlap"
  | "limit";

export interface SpanValidationResult {
  accepted: HighlightSpan[];
  rejected: { index: number; reason: SpanRejectReason }[];
}

/** Highlights are short action-defining phrases, never whole paragraphs. */
export const SPAN_MAX_CHARS = 60;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** True when [start, end) would cut a surrogate pair in half. */
function splitsSurrogate(text: string, start: number, end: number): boolean {
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) return true;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) {
    return isHighSurrogate(text.charCodeAt(end - 1));
  }
  return false;
}

function occurrences(text: string, quote: string): number[] {
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(quote, from);
    if (at < 0) return found;
    found.push(at);
    from = at + 1;
  }
}

function labelFor(field: HighlightField, modelLabel: string): string {
  if (field !== "other") return HIGHLIGHT_FIELD_LABELS[field];
  const cleaned = modelLabel.replace(/\s+/g, " ").trim().slice(0, 40);
  return cleaned || HIGHLIGHT_FIELD_LABELS.other;
}

/** Resolve one candidate to exact offsets in `text`, or a reject reason. */
function anchor(
  text: string,
  candidate: CandidateSpan,
): { start: number; end: number } | SpanRejectReason {
  const quote = candidate.quote.trim();
  if (!quote) return "empty";
  if (quote.length > SPAN_MAX_CHARS) return "too_long";
  const { start, end } = candidate;
  const offsetsUsable =
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= text.length;
  let range: { start: number; end: number } | null = null;
  if (offsetsUsable && text.slice(start, end) === quote) {
    range = { start, end };
  } else {
    // Offsets are wrong (or point at a different substring): re-anchor only when unambiguous.
    const hits = occurrences(text, quote);
    if (hits.length === 0) return offsetsUsable ? "not_found" : "out_of_range";
    if (hits.length > 1) return "ambiguous";
    range = { start: hits[0]!, end: hits[0]! + quote.length };
  }
  if (splitsSurrogate(text, range.start, range.end)) return "split_surrogate";
  return range;
}

/**
 * Validate planner spans against the exact stored texts. A span whose `messageRef` has no target
 * in this request is stale. Per message, spans are taken in the planner's order: overlaps with an
 * earlier accepted span are rejected, and at most `maxPerMessage` (3) survive.
 */
export function validateSpans(
  candidates: readonly CandidateSpan[],
  targets: readonly SpanTarget[],
  opts: { maxPerMessage?: number } = {},
): SpanValidationResult {
  const max = opts.maxPerMessage ?? LIMITS.maxHighlightsPerMessage;
  const byRef = new Map<SpanMessageRef, SpanTarget>();
  for (const t of targets) byRef.set(t.ref, t);
  const perMessage = new Map<string, HighlightSpan[]>();
  const rejected: SpanValidationResult["rejected"] = [];

  candidates.forEach((candidate, index) => {
    const target = byRef.get(candidate.messageRef);
    if (!target) {
      rejected.push({ index, reason: "stale" });
      return;
    }
    const range = anchor(target.text, candidate);
    if (typeof range === "string") {
      rejected.push({ index, reason: range });
      return;
    }
    const kept = perMessage.get(target.messageId) ?? [];
    if (kept.some((s) => range.start < s.end && s.start < range.end)) {
      rejected.push({ index, reason: "overlap" });
      return;
    }
    if (kept.length >= max) {
      rejected.push({ index, reason: "limit" });
      return;
    }
    kept.push({
      messageId: target.messageId,
      start: range.start,
      end: range.end,
      field: candidate.field,
      label: labelFor(candidate.field, candidate.label),
      kind: target.kind,
    });
    perMessage.set(target.messageId, kept);
  });

  const accepted = [...perMessage.values()]
    .flat()
    .sort((a, b) =>
      a.messageId === b.messageId ? a.start - b.start : a.messageId < b.messageId ? -1 : 1,
    );
  return { accepted, rejected };
}

/**
 * Re-check stored spans against their message text (used when restoring or re-tagging older
 * messages). Drops anything out of range, overlapping, or beyond the per-message limit.
 */
export function sanitizeStoredSpans(
  text: string,
  spans: readonly HighlightSpan[],
  max: number = LIMITS.maxHighlightsPerMessage,
): HighlightSpan[] {
  const kept: HighlightSpan[] = [];
  for (const s of spans) {
    const inRange =
      Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start;
    if (!inRange || s.end > text.length || splitsSurrogate(text, s.start, s.end)) continue;
    if (kept.some((k) => s.start < k.end && k.start < s.end)) continue;
    if (kept.length >= max) break;
    kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * When a newer correction arrives, older correction highlights become established details,
 * except fields the newest correction just changed (those older phrases are stale).
 */
export function supersedeSpans(
  older: readonly HighlightSpan[],
  newestFields: ReadonlySet<HighlightField>,
): HighlightSpan[] {
  return older
    .filter((s) => !newestFields.has(s.field))
    .map((s) => ({ ...s, kind: "established" as const }));
}
