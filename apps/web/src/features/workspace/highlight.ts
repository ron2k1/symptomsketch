import { HIGHLIGHT_FIELD_LABELS, LIMITS, type HighlightSpan } from "@symptomsketch/contracts";

/** One piece of a message: plain text, or the exact substring a validated span covers. */
export interface TextFragment {
  text: string;
  span: HighlightSpan | null;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** True when cutting `text` at UTF-16 index `i` would split a surrogate pair. */
function splitsSurrogatePair(text: string, i: number): boolean {
  if (i <= 0 || i >= text.length) return false;
  return isHighSurrogate(text.charCodeAt(i - 1)) && isLowSurrogate(text.charCodeAt(i));
}

/**
 * Client-side defence for server-validated spans (spec 6): keep only integer, in-bounds,
 * non-overlapping half-open UTF-16 spans that belong to this exact message, never more than
 * the per-message maximum. The first span wins an overlap; later overlapping spans are dropped.
 */
export function validSpans(
  text: string,
  spans: readonly HighlightSpan[],
  messageId: string | null = null,
): HighlightSpan[] {
  const candidates = spans
    .filter(
      (s) =>
        (messageId === null || s.messageId === messageId) &&
        Number.isInteger(s.start) &&
        Number.isInteger(s.end) &&
        s.start >= 0 &&
        s.end > s.start &&
        s.end <= text.length &&
        !splitsSurrogatePair(text, s.start) &&
        !splitsSurrogatePair(text, s.end),
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const kept: HighlightSpan[] = [];
  let lastEnd = 0;
  for (const span of candidates) {
    if (span.start < lastEnd) continue;
    kept.push(span);
    lastEnd = span.end;
    if (kept.length >= LIMITS.maxHighlightsPerMessage) break;
  }
  return kept;
}

/** Splits `text` into ordered fragments. Concatenating every fragment's text yields `text`. */
export function splitHighlights(
  text: string,
  spans: readonly HighlightSpan[],
  messageId: string | null = null,
): TextFragment[] {
  const fragments: TextFragment[] = [];
  let cursor = 0;
  for (const span of validSpans(text, spans, messageId)) {
    if (span.start > cursor) fragments.push({ text: text.slice(cursor, span.start), span: null });
    fragments.push({ text: text.slice(span.start, span.end), span });
    cursor = span.end;
  }
  if (cursor < text.length || fragments.length === 0) {
    fragments.push({ text: text.slice(cursor), span: null });
  }
  return fragments;
}

/** Field label paired with the tint ("Movement", "Count", ...). Never color alone. */
export function highlightFieldLabel(span: HighlightSpan): string {
  return HIGHLIGHT_FIELD_LABELS[span.field];
}
