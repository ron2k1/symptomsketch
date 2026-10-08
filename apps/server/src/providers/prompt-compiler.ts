// Deterministic ActionPlan -> Reactor X2 prompt + caption (spec 9 "Reasoning planner contract").
// Observable action only: subject + visible features, starting state, the one selected action with
// its direction/count/timing/magnitude, ending state, steady camera, same product, photoreal.
// Never chat history, actions tried, understanding text, or causes.
import { LIMITS, type ActionPlan, type Purpose } from "@symptomsketch/contracts";

/** Product facts the compiler may use (from the owned product revision, never the model). */
export interface PromptProduct {
  modelLabel: string | null;
  confirmedFeatures: readonly string[];
}

/** Procedure facts deterministic validation needs (solution mode). */
export interface PromptProcedure {
  id: string;
  productRevisionId: string;
  modelApplicabilityConfirmed: boolean;
}

export interface CompiledPlan {
  prompt: string;
  caption: string;
}

const FIELD_CAP = {
  subject: 120,
  state: 140,
  action: 140,
  short: 60,
  timing: 80,
  features: 180,
  setup: 200,
} as const;

/** Clauses that introduce causes or diagnoses; cut from any field fed to the video model. */
const CAUSE_CLAUSE = /[,;:]?\s*\b(because|due to|caused by|as a result of)\b.*$/i;

/** Collapse whitespace, drop cause clauses and trailing punctuation, cap at a word boundary. */
export function cleanField(value: string | null | undefined, cap: number): string {
  if (!value) return "";
  let s = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(CAUSE_CLAUSE, "").trim();
  s = s.replace(/[\s.;,:]+$/g, "");
  return capWords(s, cap);
}

function capWords(s: string, cap: number): string {
  if (s.length <= cap) return s;
  const cut = s.slice(0, cap + 1);
  const space = cut.lastIndexOf(" ");
  return (space > cap * 0.5 ? cut.slice(0, space) : s.slice(0, cap)).replace(/[\s.;,:]+$/g, "");
}

export function countPhrase(n: number): string {
  if (n === 1) return "exactly once";
  if (n === 2) return "exactly twice";
  return `exactly ${n} times`;
}

function sentence(s: string): string {
  if (!s) return "";
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
}

/** Visible features from the confirmed reference, deduped, as a short phrase. */
function featurePhrase(product: PromptProduct, subject: string): string {
  const lowerSubject = subject.toLowerCase();
  const features = product.confirmedFeatures
    .map((f) => cleanField(f, 60))
    .filter((f) => f && !lowerSubject.includes(f.toLowerCase()));
  return capWords([...new Set(features)].join(", "), FIELD_CAP.features);
}

/** The single action line: action + direction + count + magnitude + timing, each once. */
function actionLine(plan: ActionPlan): string {
  const a = plan.selectedAction;
  const action = cleanField(a.action, FIELD_CAP.action);
  const lowerAction = action.toLowerCase();
  const parts: string[] = [action];
  const direction = cleanField(a.direction, FIELD_CAP.short);
  if (direction && !lowerAction.includes(direction.toLowerCase())) {
    parts.push(`direction: ${direction}`);
  }
  if (a.repetitions !== null) parts.push(countPhrase(a.repetitions));
  const magnitude = cleanField(a.magnitude, FIELD_CAP.short);
  if (magnitude) parts.push(`size of the movement: ${magnitude}`);
  const timing = cleanField(a.timing, FIELD_CAP.timing);
  if (timing) parts.push(`timing: ${timing}`);
  return parts.join(", ");
}

function framingLine(purpose: Purpose): string {
  const extra =
    purpose === "problem"
      ? "Show only this one action, with no other movement."
      : "Show only this one step, with no other movement.";
  return `${extra} Steady fixed camera, same framing and lighting throughout. Photorealistic, no text or overlays.`;
}

/**
 * Compile the X2 prompt. Always <= LIMITS.reactorPromptMaxChars: optional lines (features, setup)
 * are dropped first, then the result is cut at a word boundary as a last resort.
 */
export function compileReactorPrompt(plan: ActionPlan, product: PromptProduct): string {
  const a = plan.selectedAction;
  const subject = cleanField(a.subject, FIELD_CAP.subject) || "product";
  const features = featurePhrase(product, subject);
  const start = cleanField(a.startingState, FIELD_CAP.state);
  const end = cleanField(a.endingState, FIELD_CAP.state);
  const setup =
    plan.purpose === "solution"
      ? capWords(
          plan.prerequisites
            .map((p) => cleanField(p, 100))
            .filter(Boolean)
            .join("; "),
          FIELD_CAP.setup,
        )
      : "";

  const identity = `The same ${subject} shown in the reference image${
    features ? `, with ${features}` : ""
  }; keep its shape, colors and details identical to the reference.`;
  const identityPlain = `The same ${subject} shown in the reference image; keep its shape, colors and details identical to the reference.`;

  const build = (withFeatures: boolean, withSetup: boolean): string =>
    [
      withFeatures ? identity : identityPlain,
      withSetup && setup ? `Setup: ${setup}.` : "",
      start ? `Start: ${sentence(start)}` : "",
      `Action: ${sentence(actionLine(plan))}`,
      end ? `End: ${sentence(end)}` : "",
      framingLine(plan.purpose),
    ]
      .filter(Boolean)
      .join(" ");

  const max = LIMITS.reactorPromptMaxChars;
  for (const [withFeatures, withSetup] of [
    [true, true],
    [false, true],
    [false, false],
  ] as const) {
    const prompt = build(withFeatures, withSetup);
    if (prompt.length <= max) return prompt;
  }
  return capWords(build(false, false), max);
}

/** Caption shown on the take and burned into the export. Planner caption when valid, else built. */
export function compileCaption(plan: ActionPlan): string {
  const max = LIMITS.captionMaxChars;
  const given = plan.caption.replace(/\s+/g, " ").trim();
  if (given.length > 0 && given.length <= max) return given;
  const a = plan.selectedAction;
  const lead = plan.purpose === "problem" ? "Illustration of" : "Instructional illustration:";
  const action = cleanField(a.action, 60);
  const timing = cleanField(a.timing, 40);
  const count = a.repetitions !== null && a.repetitions > 1 ? ` ${countPhrase(a.repetitions)}` : "";
  return capWords(`${lead} ${action}${count}${timing ? ` ${timing}` : ""}`, max);
}

export interface ReadinessContext {
  /** The owned procedure revision the plan was built with (solution mode). */
  procedure: PromptProcedure | null;
  /** Planner flagged its clarification question as blocking the action. */
  clarificationBlocking: boolean;
}

export interface Readiness {
  /** Deterministic problems that make the plan unusable for Reactor (status invalid). */
  issues: string[];
  /** A critical question is unresolved (status needs_clarification). */
  needsClarification: boolean;
}

/**
 * Deterministic validation before any Reactor use (spec 9): required fields, supported purpose,
 * product/procedure relationship, unresolved critical question, caption and prompt limits.
 */
export function checkReadiness(
  plan: ActionPlan,
  compiled: CompiledPlan,
  ctx: ReadinessContext,
): Readiness {
  const issues: string[] = [];
  const a = plan.selectedAction;
  if (!cleanField(a.subject, FIELD_CAP.subject)) issues.push("The product is not named.");
  if (!cleanField(a.action, FIELD_CAP.action)) issues.push("The action to show is missing.");
  if (!cleanField(a.startingState, FIELD_CAP.state)) issues.push("The starting state is missing.");
  if (!cleanField(a.endingState, FIELD_CAP.state)) issues.push("The ending state is missing.");
  if (a.repetitions !== null && (a.repetitions < 1 || a.repetitions > 10)) {
    issues.push("The movement count must be between 1 and 10.");
  }
  if (plan.requiredConstraints.length === 0) issues.push("No visible constraints to check.");
  const ids = plan.requiredConstraints.map((c) => c.id);
  if (new Set(ids).size !== ids.length) issues.push("Constraint ids are not unique.");

  if (plan.purpose === "solution") {
    const p = ctx.procedure;
    if (!p) {
      issues.push("Add the approved procedure before planning a solution.");
    } else {
      if (plan.procedureRevisionId !== p.id) issues.push("The plan uses a different procedure.");
      if (p.productRevisionId !== plan.productRevisionId) {
        issues.push("The procedure belongs to a different product reference.");
      }
      if (!p.modelApplicabilityConfirmed) {
        issues.push("Confirm that the procedure applies to this product model.");
      }
    }
  } else if (plan.procedureRevisionId !== null) {
    issues.push("A problem reenactment cannot carry a procedure.");
  }

  if (compiled.caption.length === 0 || compiled.caption.length > LIMITS.captionMaxChars) {
    issues.push("The caption is empty or too long.");
  }
  if (compiled.prompt.length === 0 || compiled.prompt.length > LIMITS.reactorPromptMaxChars) {
    issues.push("The visual prompt is empty or too long.");
  }
  return { issues, needsClarification: ctx.clarificationBlocking };
}
