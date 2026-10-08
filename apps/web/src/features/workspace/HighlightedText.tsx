import { Fragment, useMemo } from "react";
import type { HighlightField, HighlightSpan } from "@symptomsketch/contracts";
import { cn } from "@/lib/utils";
import { highlightFieldLabel, splitHighlights, validSpans } from "./highlight";

interface HighlightedTextProps {
  text: string;
  spans: readonly HighlightSpan[];
  /** Spans whose messageId differs from this are treated as stale and ignored. */
  messageId?: string | null;
  /** Selecting a highlight focuses the matching editable field (keyboard users use the fields). */
  onSelectField?: (field: HighlightField) => void;
}

/**
 * Renders message text as escaped React text nodes with <mark> around validated spans only.
 * Model output never reaches the DOM as HTML.
 */
export function HighlightedText({
  text,
  spans,
  messageId = null,
  onSelectField,
}: HighlightedTextProps) {
  const fragments = useMemo(
    () => splitHighlights(text, spans, messageId),
    [text, spans, messageId],
  );
  return (
    <>
      {fragments.map((fragment, i) => {
        const span = fragment.span;
        if (!span) return <Fragment key={i}>{fragment.text}</Fragment>;
        return (
          <mark
            key={i}
            className={cn(
              span.kind === "correction" ? "hl-correction" : "hl-established",
              onSelectField && "cursor-pointer",
            )}
            data-field={span.field}
            title={`${highlightFieldLabel(span)}${span.kind === "correction" ? " (newest correction)" : ""}`}
            onClick={onSelectField ? () => onSelectField(span.field) : undefined}
          >
            {fragment.text}
          </mark>
        );
      })}
    </>
  );
}

/** Field chips paired with the tints so color never carries meaning alone (spec 6). */
export function HighlightLegend({
  text,
  spans,
  messageId = null,
}: {
  text: string;
  spans: readonly HighlightSpan[];
  messageId?: string | null;
}) {
  const kept = useMemo(() => validSpans(text, spans, messageId), [text, spans, messageId]);
  if (kept.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Highlighted details">
      {kept.map((span, i) => (
        <li
          key={i}
          className={cn(
            "rounded-sm border px-1.5 py-0.5 font-mono text-[11px] leading-none",
            span.kind === "correction"
              ? "border-magenta/50 bg-magenta-soft text-foreground"
              : "border-neon/40 bg-neon-soft text-foreground",
          )}
        >
          <span className="text-muted-foreground">{highlightFieldLabel(span)}:</span>{" "}
          {text.slice(span.start, span.end)}
          {span.kind === "correction" ? (
            <span className="text-muted-foreground"> (new)</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
