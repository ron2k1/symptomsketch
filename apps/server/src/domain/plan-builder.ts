// Planner output -> ActionPlan (spec 10): deterministic and server-authoritative. Ids, revisions
// and source pointers come from owned server records; model-claimed quotes are re-resolved
// against the exact stored texts and dropped when they are paraphrases.
import {
  ActionPlan,
  type ConstraintSource,
  type PlanFieldEdits,
  type ProcedureRevision,
  type Purpose,
  type RequiredConstraint,
} from "@symptomsketch/contracts";
import type { PlannerModelOutput } from "../providers/planner.ts";
import { compileCaption } from "../providers/prompt-compiler.ts";
import type { MessageRow } from "./messages.ts";

function str(value: string | null | undefined, cap: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, cap);
}

function nullableStr(value: string | null | undefined, cap: number): string | null {
  return str(value, cap) || null;
}

function list(values: readonly string[], maxItems: number, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = str(v, cap);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

const CONSTRAINT_ID = /^[a-z0-9][a-z0-9_.-]{0,47}$/;

/** Lowercase, safe characters, <= 48 chars, unique within the plan. */
export function normalizeConstraintId(raw: string, index: number, taken: Set<string>): string {
  let id = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 44);
  if (!CONSTRAINT_ID.test(id)) id = `c${index + 1}`;
  let unique = id;
  for (let n = 2; taken.has(unique); n += 1) unique = `${id}_${n}`;
  taken.add(unique);
  return unique;
}

/** Exact substring of a stored text for `quote` (case-insensitive match returns the stored casing). */
function findInTexts(
  quote: string,
  texts: readonly { messageId: string | null; text: string }[],
): { quote: string; messageId: string | null } | null {
  for (const t of texts) if (t.text.includes(quote)) return { quote, messageId: t.messageId };
  const lower = quote.toLowerCase();
  for (const t of texts) {
    const at = t.text.toLowerCase().indexOf(lower);
    if (at >= 0) return { quote: t.text.slice(at, at + quote.length), messageId: t.messageId };
  }
  return null;
}

export interface PlanSources {
  purpose: Purpose;
  productRevisionId: string;
  procedure: ProcedureRevision | null;
  account: MessageRow | null;
  actionsTried: MessageRow | null;
  /** User corrections/answers for this purpose, newest first (including this request's). */
  corrections: readonly MessageRow[];
  fieldEdits: PlanFieldEdits | null;
}

/** Resolve a model-claimed source against the exact stored records; never trust it blindly. */
function resolveSource(
  kind: ConstraintSource["kind"],
  rawQuote: string | null,
  rawStep: number | null,
  s: PlanSources,
): ConstraintSource {
  const quote = str(rawQuote, 200);
  const steps = s.procedure?.steps ?? [];
  if (kind === "procedure") {
    const stepTexts = steps.map((text, i) => ({ messageId: String(i), text }));
    const step = rawStep !== null && rawStep >= 0 && rawStep < steps.length ? rawStep : null;
    const ordered = step === null ? stepTexts : [stepTexts[step]!, ...stepTexts];
    const hit = quote ? findInTexts(quote, ordered) : null;
    const stepIndex = hit ? Number(hit.messageId) : step;
    return { kind, quote: hit?.quote ?? null, messageId: null, stepIndex };
  }
  if (kind === "reference") return { kind, quote: null, messageId: null, stepIndex: null };
  const rows =
    kind === "account"
      ? [s.account]
      : kind === "actions_tried"
        ? [s.actionsTried]
        : [...s.corrections];
  const texts = rows.flatMap((r) => (r ? [{ messageId: r.id, text: r.text }] : []));
  const hit = quote ? findInTexts(quote, texts) : null;
  return { kind, quote: hit?.quote ?? null, messageId: hit?.messageId ?? null, stepIndex: null };
}

export interface BuiltPlan {
  plan: ActionPlan;
  understanding: string;
  preserved: string[];
  unclear: string[];
  clarificationQuestion: string | null;
  clarificationBlocking: boolean;
}

/** Turn validated planner output into an ActionPlan with authoritative ids and resolved sources. */
export function buildActionPlan(out: PlannerModelOutput, s: PlanSources): BuiltPlan {
  const a = out.selectedAction;
  const edits = s.fieldEdits ?? {};
  const repetitions =
    edits.repetitions !== undefined
      ? edits.repetitions
      : a.repetitions !== null && a.repetitions >= 1
        ? a.repetitions
        : null;
  const selectedAction = {
    subject: str(a.subject, 160),
    startingState: str(a.startingState, 200),
    action: str(a.action, 200),
    direction: edits.direction !== undefined ? edits.direction : nullableStr(a.direction, 60),
    repetitions,
    timing: edits.timing !== undefined ? edits.timing : nullableStr(a.timing, 100),
    magnitude: edits.magnitude !== undefined ? edits.magnitude : nullableStr(a.magnitude, 60),
    endingState: str(a.endingState, 200),
  };

  const taken = new Set<string>();
  const constraints: RequiredConstraint[] = [];
  out.requiredConstraints.forEach((c, i) => {
    const expected = str(c.expected, 200);
    if (!expected || constraints.length >= 8) return;
    constraints.push({
      id: normalizeConstraintId(c.id, i, taken),
      expected,
      critical: c.critical,
      source: resolveSource(c.sourceKind, c.quote, c.stepIndex, s),
    });
  });
  if (!constraints.some((c) => c.source.kind === "reference" || c.id === "product")) {
    constraints.push({
      id: normalizeConstraintId("product", constraints.length, taken),
      expected: "same product as the reference image",
      critical: true,
      source: { kind: "reference", quote: null, messageId: null, stepIndex: null },
    });
  }

  const unclear = list([...out.unclear, ...out.unresolved], 6, 160);
  let question = nullableStr(out.clarificationQuestion, 300);
  const blocking = question !== null && out.clarificationBlocking;
  if (question !== null && !question.endsWith("?")) question = `${question}?`;

  const draft: ActionPlan = {
    schemaVersion: 1,
    purpose: s.purpose,
    productRevisionId: s.productRevisionId,
    procedureRevisionId: s.purpose === "solution" ? (s.procedure?.id ?? null) : null,
    selectedAction,
    context: {
      reportedFrequency: nullableStr(out.reportedFrequency, 80),
      actionsTried: s.purpose === "problem" ? list(out.actionsTried, 8, 200) : [],
      unresolved: unclear,
    },
    prerequisites: s.purpose === "solution" ? list(out.prerequisites, 6, 200) : [],
    invariants: list(out.invariants, 6, 160),
    requiredConstraints: constraints,
    understanding: str(out.understanding, 400),
    preservedDetails: list(out.preserved, 6, 160),
    caption: str(out.caption, 200),
    sourceReferences: out.sourceReferences.slice(0, 6).map((r) => {
      const src = resolveSource(r.kind, r.quote, r.stepIndex, s);
      return {
        kind: r.kind,
        label: str(r.label, 120) || r.kind,
        quote: src.quote,
        stepIndex: src.stepIndex ?? null,
      };
    }),
    clarificationQuestion: question,
  };
  const plan = ActionPlan.parse({ ...draft, caption: compileCaption(draft) });
  return {
    plan,
    understanding: plan.understanding,
    preserved: plan.preservedDetails,
    unclear,
    clarificationQuestion: question,
    clarificationBlocking: blocking,
  };
}
