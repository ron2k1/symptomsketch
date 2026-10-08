/** Permanent text burned into recorded pixels (spec 12). Frozen when Record next take starts. */
export interface RecordingLabels {
  /** PURPOSE_LABELS[purpose]: "AI-generated reenactment" | "AI-generated instructional illustration". */
  purposeLabel: string;
  /** The approved plan caption. */
  caption: string;
  productLabel: string;
  /** Next profile only; Quick Demo is always false. */
  generatedConcept: boolean;
}

/** Colors for canvas drawing, read from the theme tokens in index.css (no hex in components). */
export interface CanvasTheme {
  background: string;
  foreground: string;
  neon: string;
  magenta: string;
}

export function readCanvasTheme(): CanvasTheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: token("--background", "black"),
    foreground: token("--foreground", "white"),
    neon: token("--neon", "cyan"),
    magenta: token("--magenta", "magenta"),
  };
}

const FONT_FAMILY = '"Inter Variable", ui-sans-serif, system-ui, sans-serif';
export const labelFont = (weight: number, px: number) => `${weight} ${px}px ${FONT_FAMILY}`;

/**
 * Greedy word wrap. A single word wider than maxWidth stays on its own line (never cut mid-word),
 * so the caller can detect overflow and pick a smaller font instead of exporting a fragment.
 */
export function wrapWords(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface CaptionLayout {
  fontPx: number;
  lines: string[];
}

/** Largest font from `sizes` whose wrap fits in maxLines with no over-wide word; else the smallest. */
export function layoutCaption(
  text: string,
  maxWidth: number,
  maxLines: number,
  sizes: readonly number[],
  measureAt: (s: string, fontPx: number) => number,
): CaptionLayout {
  let last: CaptionLayout = { fontPx: sizes[sizes.length - 1] ?? 24, lines: [] };
  for (const fontPx of sizes) {
    const measure = (s: string) => measureAt(s, fontPx);
    const lines = wrapWords(text, maxWidth, measure);
    last = { fontPx, lines };
    if (lines.length <= maxLines && lines.every((l) => measure(l) <= maxWidth)) return last;
  }
  return last;
}

/** Shortens `text` with an ellipsis to fit maxWidth (product label metadata only, never the caption). */
export function fitSingleLine(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (measure(text) <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && measure(`${text.slice(0, end).trimEnd()}…`) > maxWidth) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}
