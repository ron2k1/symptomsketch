import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HighlightSpan } from "@symptomsketch/contracts";
import { splitHighlights, validSpans } from "./highlight";
import { HighlightedText } from "./HighlightedText";

const MSG = "msg_1";

function span(start: number, end: number, extra: Partial<HighlightSpan> = {}): HighlightSpan {
  return {
    messageId: MSG,
    start,
    end,
    field: "movement",
    label: "Movement",
    kind: "established",
    ...extra,
  };
}

afterEach(cleanup);

describe("splitHighlights", () => {
  const text = "The vacuum stops and then jerks backward once.";
  const backward = text.indexOf("backward");
  const once = text.indexOf("once");

  it("splits text into plain and highlighted fragments that rejoin exactly", () => {
    const fragments = splitHighlights(
      text,
      [span(once, once + 4, { field: "count", kind: "correction" }), span(backward, backward + 8)],
      MSG,
    );
    expect(fragments.map((f) => f.text).join("")).toBe(text);
    const marked = fragments.filter((f) => f.span).map((f) => f.text);
    expect(marked).toEqual(["backward", "once"]);
  });

  it("drops out-of-bounds, overlapping, stale and surrogate-splitting spans", () => {
    const emoji = "Moves \u{1F916} back";
    expect(validSpans(text, [span(0, text.length + 1)], MSG)).toEqual([]);
    expect(validSpans(text, [span(5, 3)], MSG)).toEqual([]);
    expect(validSpans(text, [span(1.5, 4)], MSG)).toEqual([]);
    expect(validSpans(text, [span(0, 3, { messageId: "msg_other" })], MSG)).toEqual([]);
    expect(validSpans(emoji, [span(7, 9)], MSG)).toEqual([]);
    const overlapping = validSpans(text, [span(backward, backward + 8), span(backward + 2, once)]);
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0]?.start).toBe(backward);
  });

  it("keeps at most three highlights per message", () => {
    const spans = [span(0, 3), span(4, 10), span(11, 16), span(17, 20)];
    expect(validSpans(text, spans, MSG)).toHaveLength(3);
  });

  it("returns the whole text as one fragment when there are no spans", () => {
    expect(splitHighlights("plain", [], MSG)).toEqual([{ text: "plain", span: null }]);
    expect(splitHighlights("", [], MSG)).toEqual([{ text: "", span: null }]);
  });
});

describe("HighlightedText", () => {
  it("renders markup-like text as escaped text, never as HTML", () => {
    const text = 'It went <img src=x onerror="alert(1)"> <b>backward</b> & stopped';
    const start = text.indexOf("backward");
    const { container } = render(
      <p>
        <HighlightedText text={text} spans={[span(start, start + 8)]} messageId={MSG} />
      </p>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe(text);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("backward");
  });

  it("uses semantic marks with the established / correction classes", () => {
    const text = "jerks backward once immediately";
    const { container } = render(
      <p>
        <HighlightedText
          text={text}
          messageId={MSG}
          spans={[
            span(6, 14),
            span(15, 19, { field: "count", label: "Count", kind: "correction" }),
          ]}
        />
      </p>,
    );
    const marks = Array.from(container.querySelectorAll("mark"));
    expect(marks.map((m) => m.className)).toEqual(["hl-established", "hl-correction"]);
    expect(marks.map((m) => m.dataset.field)).toEqual(["movement", "count"]);
    expect(marks.map((m) => m.textContent)).toEqual(["backward", "once"]);
  });

  it("ignores spans from another message", () => {
    const { container } = render(
      <p>
        <HighlightedText text="backward" messageId={MSG} spans={[span(0, 8, { messageId: "x" })]} />
      </p>,
    );
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("backward");
  });
});
