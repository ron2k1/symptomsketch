import { describe, expect, it } from "vitest";
import { fitSingleLine, layoutCaption, wrapWords } from "./labels";

/** Monospace stand-in for canvas measureText: every char is `px * 0.5` wide. */
const mono = (px: number) => (s: string) => s.length * px * 0.5;

describe("recording label layout", () => {
  it("wraps on word boundaries without cutting words", () => {
    expect(wrapWords("The robot vacuum moves backward once", 100, mono(14))).toEqual([
      "The robot",
      "vacuum moves",
      "backward once",
    ]);
    expect(wrapWords("  ", 100, mono(10))).toEqual([]);
  });

  it("picks the largest caption size that fits in two lines", () => {
    const caption = "Robot vacuum reverses about one body length, then stops";
    const layout = layoutCaption(caption, 400, 2, [32, 28, 24], (s, px) => mono(px)(s));
    expect(layout.fontPx).toBe(28);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines.join(" ")).toBe(caption);
  });

  it("never truncates the caption: falls back to the smallest size with all words kept", () => {
    const caption = "word ".repeat(40).trim();
    const layout = layoutCaption(caption, 200, 2, [32, 24], (s, px) => mono(px)(s));
    expect(layout.fontPx).toBe(24);
    expect(layout.lines.join(" ")).toBe(caption);
  });

  it("shortens only the product label with an ellipsis", () => {
    expect(fitSingleLine("Desk fan", 100, mono(10))).toBe("Desk fan");
    const fitted = fitSingleLine("SymptomSketch Demo Robot Vacuum RV-01", 100, mono(10));
    expect(fitted.endsWith("…")).toBe(true);
    expect(mono(10)(fitted)).toBeLessThanOrEqual(100);
  });
});
