import assert from "node:assert/strict";
import { test } from "node:test";
import { HighlightSpan } from "@symptomsketch/contracts";
import {
  type CandidateSpan,
  type SpanTarget,
  sanitizeStoredSpans,
  supersedeSpans,
  validateSpans,
} from "./spans.ts";

const ACCOUNT = "The vacuum stops and then jerks backward once. It only happens sometimes.";
const CORRECTION = "The backward movement is smaller and happens immediately.";

const targets: SpanTarget[] = [
  { ref: "account", messageId: "msg_account", text: ACCOUNT, kind: "established" },
  { ref: "correction", messageId: "msg_corr", text: CORRECTION, kind: "correction" },
];

function at(text: string, quote: string): { start: number; end: number } {
  const start = text.indexOf(quote);
  assert.ok(start >= 0, `fixture quote missing: ${quote}`);
  return { start, end: start + quote.length };
}

function span(
  messageRef: CandidateSpan["messageRef"],
  quote: string,
  field: CandidateSpan["field"],
  offsets?: { start: number; end: number },
): CandidateSpan {
  const text = messageRef === "account" ? ACCOUNT : CORRECTION;
  const o = offsets ?? at(text, quote);
  return { messageRef, quote, field, label: "x", ...o };
}

test("exact spans are accepted with established/correction kinds and contract-valid shape", () => {
  const { accepted, rejected } = validateSpans(
    [
      span("account", "jerks backward", "movement"),
      span("account", "once", "count"),
      span("correction", "smaller", "magnitude"),
      span("correction", "immediately", "timing"),
    ],
    targets,
  );
  assert.deepEqual(rejected, []);
  assert.equal(accepted.length, 4);
  for (const s of accepted) {
    HighlightSpan.parse(s);
    const text = s.messageId === "msg_account" ? ACCOUNT : CORRECTION;
    assert.ok(
      ["jerks backward", "once", "smaller", "immediately"].includes(text.slice(s.start, s.end)),
    );
  }
  const kinds = Object.fromEntries(accepted.map((s) => [s.field, s.kind]));
  assert.equal(kinds.movement, "established");
  assert.equal(kinds.timing, "correction");
  // Canonical field labels, never the model's free text.
  assert.equal(accepted.find((s) => s.field === "count")?.label, "Count");
});

test("wrong offsets re-anchor when the quote occurs exactly once", () => {
  const { accepted, rejected } = validateSpans(
    [span("account", "once", "count", { start: 3, end: 7 })],
    targets,
  );
  assert.deepEqual(rejected, []);
  assert.equal(ACCOUNT.slice(accepted[0]!.start, accepted[0]!.end), "once");
});

test("out-of-range offsets re-anchor a unique quote but reject a missing one", () => {
  const ok = validateSpans(
    [span("account", "sometimes", "other", { start: 500, end: 509 })],
    targets,
  );
  assert.equal(ok.accepted.length, 1);
  const bad = validateSpans([span("account", "twice", "count", { start: 500, end: 505 })], targets);
  assert.deepEqual(bad.rejected, [{ index: 0, reason: "out_of_range" }]);
});

test("a paraphrase that is not in the stored text is rejected", () => {
  const { accepted, rejected } = validateSpans(
    [span("account", "moves back", "movement", { start: 26, end: 36 })],
    targets,
  );
  assert.equal(accepted.length, 0);
  assert.deepEqual(rejected, [{ index: 0, reason: "not_found" }]);
});

test("ambiguous quote with wrong offsets is rejected, but correct offsets disambiguate", () => {
  const text = "It went back, then back again.";
  const t: SpanTarget[] = [{ ref: "account", messageId: "m", text, kind: "established" }];
  const wrong = validateSpans(
    [{ messageRef: "account", quote: "back", start: 0, end: 4, field: "movement", label: "" }],
    t,
  );
  assert.deepEqual(wrong.rejected, [{ index: 0, reason: "ambiguous" }]);
  const second = text.lastIndexOf("back");
  const right = validateSpans(
    [
      {
        messageRef: "account",
        quote: "back",
        start: second,
        end: second + 4,
        field: "movement",
        label: "",
      },
    ],
    t,
  );
  assert.equal(right.accepted[0]?.start, second);
});

test("overlapping spans keep the first in planner order", () => {
  const { accepted, rejected } = validateSpans(
    [
      span("account", "jerks backward once", "movement"),
      span("account", "backward", "movement"),
      span("account", "once", "count"),
    ],
    targets,
  );
  assert.equal(accepted.length, 1);
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ["overlap", "overlap"],
  );
});

test("duplicate identical spans are rejected as overlap", () => {
  const { accepted, rejected } = validateSpans(
    [span("account", "once", "count"), span("account", "once", "count")],
    targets,
  );
  assert.equal(accepted.length, 1);
  assert.deepEqual(rejected, [{ index: 1, reason: "overlap" }]);
});

test("at most three spans per message survive", () => {
  const { accepted, rejected } = validateSpans(
    [
      span("account", "stops", "start"),
      span("account", "jerks backward", "movement"),
      span("account", "once", "count"),
      span("account", "sometimes", "other"),
      span("correction", "smaller", "magnitude"),
    ],
    targets,
  );
  assert.equal(accepted.filter((s) => s.messageId === "msg_account").length, 3);
  assert.equal(accepted.filter((s) => s.messageId === "msg_corr").length, 1);
  assert.deepEqual(rejected, [{ index: 3, reason: "limit" }]);
});

test("a correction span without a correction message in this request is stale", () => {
  const onlyAccount = targets.filter((t) => t.ref === "account");
  const { accepted, rejected } = validateSpans(
    [span("correction", "smaller", "magnitude")],
    onlyAccount,
  );
  assert.equal(accepted.length, 0);
  assert.deepEqual(rejected, [{ index: 0, reason: "stale" }]);
});

test("empty and overlong quotes are rejected", () => {
  const long = ACCOUNT.slice(0, 70);
  const { rejected } = validateSpans(
    [
      { messageRef: "account", quote: "   ", start: 0, end: 3, field: "other", label: "" },
      { messageRef: "account", quote: long, start: 0, end: 70, field: "other", label: "" },
    ],
    targets,
  );
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ["empty", "too_long"],
  );
});

test("whitespace around a quote is trimmed and re-anchored to the exact phrase", () => {
  const o = at(ACCOUNT, " once");
  const { accepted } = validateSpans([span("account", " once", "count", o)], targets);
  assert.equal(ACCOUNT.slice(accepted[0]!.start, accepted[0]!.end), "once");
});

test("UTF-16 offsets: text after an emoji uses code units, and pairs are never split", () => {
  const text = "It beeps \u{1F50A} then spins left twice.";
  const t: SpanTarget[] = [{ ref: "account", messageId: "m", text, kind: "established" }];
  const quote = "spins left";
  const start = text.indexOf(quote);
  // Code point counting would be one less than the UTF-16 index here.
  assert.equal([...text.slice(0, start)].length, start - 1);
  const ok = validateSpans(
    [
      {
        messageRef: "account",
        quote,
        start,
        end: start + quote.length,
        field: "movement",
        label: "",
      },
    ],
    t,
  );
  assert.equal(ok.accepted.length, 1);
  assert.equal(text.slice(ok.accepted[0]!.start, ok.accepted[0]!.end), quote);

  const emojiAt = text.indexOf("\u{1F50A}");
  const half = text.slice(emojiAt, emojiAt + 1); // lone high surrogate
  const split = validateSpans(
    [
      {
        messageRef: "account",
        quote: half,
        start: emojiAt,
        end: emojiAt + 1,
        field: "other",
        label: "",
      },
    ],
    t,
  );
  assert.deepEqual(split.rejected, [{ index: 0, reason: "split_surrogate" }]);
});

test("non-integer offsets fall back to a unique quote search", () => {
  const { accepted } = validateSpans(
    [span("account", "once", "count", { start: 1.5, end: 9.2 })],
    targets,
  );
  assert.equal(ACCOUNT.slice(accepted[0]!.start, accepted[0]!.end), "once");
});

test("label for field 'other' keeps a bounded model label; others use canonical labels", () => {
  const { accepted } = validateSpans(
    [
      { ...span("account", "sometimes", "other"), label: "  Frequency   of\nevent " },
      { ...span("account", "once", "count"), label: "IGNORED" },
    ],
    targets,
  );
  assert.equal(accepted.find((s) => s.field === "other")?.label, "Frequency of event");
  assert.equal(accepted.find((s) => s.field === "count")?.label, "Count");
});

test("sanitizeStoredSpans drops out-of-range and overlapping stored spans", () => {
  const text = "abc def ghi";
  const kept = sanitizeStoredSpans(text, [
    { messageId: "m", start: 0, end: 3, field: "other", label: "a", kind: "established" },
    { messageId: "m", start: 2, end: 5, field: "other", label: "b", kind: "established" },
    { messageId: "m", start: 8, end: 20, field: "other", label: "c", kind: "established" },
    { messageId: "m", start: 4, end: 7, field: "other", label: "d", kind: "established" },
  ]);
  assert.deepEqual(
    kept.map((s) => s.label),
    ["a", "d"],
  );
});

test("supersedeSpans re-tags older correction spans and drops fields the newest one changed", () => {
  const older = [
    {
      messageId: "c1",
      start: 0,
      end: 3,
      field: "timing" as const,
      label: "Timing",
      kind: "correction" as const,
    },
    {
      messageId: "c1",
      start: 4,
      end: 9,
      field: "magnitude" as const,
      label: "Magnitude",
      kind: "correction" as const,
    },
  ];
  const result = supersedeSpans(older, new Set(["magnitude"]));
  assert.deepEqual(result, [{ ...older[0]!, kind: "established" }]);
});
