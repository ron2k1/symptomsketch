// Deterministic ActionPlan -> Reactor X2 prompt + caption (spec 9 "Reasoning planner contract").
// Observable action only: the moving subject + the one selected action with its direction/count/
// magnitude/timing FIRST, then starting/ending state, identity (same product, visible features),
// steady camera, photoreal. Never chat history, actions tried, understanding text, or causes.
// Motion-first layout: the motion lab (docs/providers/reactor-x2.md section 9) used it for every
// sketch run; the older identity-first, stasis-first layout ("Start: ... sits still", "no other
// movement") did not stop shape changes and left the product in place.
import { LIMITS, type ActionPlan } from "@symptomsketch/contracts";

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

function lowerFirst(s: string): string {
  return s ? `${s[0]!.toLowerCase()}${s.slice(1)}` : s;
}

function upperFirst(s: string): string {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}

/** "does not move", "stops moving", "without drifting", "won't budge": the product holds still. */
const NEGATED_MOTION =
  /\b(?:not|never|without|cannot|no longer|fails? to|failed to|stops?|stopped|\w+n['’]t)\s+(?:mov|driv|roll|travel|go(?:es|ing)?\b|budg|drift|bob|shift|slid|creep|turn|spin|rotat|swing|tilt)/i;
/** Ending states that are a stop, so "then it stops" does not contradict them. */
const STOP_STATE =
  /\b(?:stops?|stopped|stationary|motionless|halts?|halted|at rest|comes? to (?:a )?(?:stop|rest))\b|\bstill\b(?!\s+\w+ing\b)/i;
const NOT_A_VERB = new Set(["its", "lens"]);

/** "jerks backward", "does not move": starts with a 3rd-person verb, so the product is the actor. */
function productIsActor(action: string): boolean {
  const first = /^[a-z]+/i.exec(action)?.[0]?.toLowerCase() ?? "";
  if (["is", "has", "was", "does", "goes"].includes(first)) return true;
  return (
    first.length > 2 && /s$/.test(first) && !/(ss|us|is)$/.test(first) && !NOT_A_VERB.has(first)
  );
}

interface Lead {
  text: string;
  /** The lead asks for a whole-product movement ("a clearly visible movement"). */
  moves: boolean;
}

/**
 * The lead sentence. A problem action that starts with a 3rd-person verb makes the product the
 * actor ("The robot vacuum jerks backward, exactly once"). Only when it also states a direction or
 * size and is not negated does it add the one clearly visible movement with its size and timing
 * (": a clearly visible movement of about a quarter of its body length, over about 2 seconds"),
 * plus "then it stops" when the ending state is a stop. Lights, sounds, "does not move", hovering,
 * and solution steps (often done by a person: "Press the start button once") stay neutral:
 * "Product: the robot vacuum. Action: Press the start button once, exactly once."
 */
function actionLead(plan: ActionPlan, subject: string): Lead {
  const a = plan.selectedAction;
  const action = cleanField(a.action, FIELD_CAP.action);
  // Imperative solution steps ("Press the start button once") fail productIsActor and stay neutral;
  // a step where the product itself moves ("drives forward") needs the motion-first lead too.
  const actor = productIsActor(action);
  const parts: string[] = [
    actor ? `The ${subject} ${lowerFirst(action)}` : `Action: ${upperFirst(action)}`,
  ];
  const direction = cleanField(a.direction, FIELD_CAP.short);
  if (direction && !action.toLowerCase().includes(direction.toLowerCase())) {
    parts.push(`direction: ${direction}`);
  }
  if (a.repetitions !== null) parts.push(countPhrase(a.repetitions));
  const magnitude = cleanField(a.magnitude, FIELD_CAP.short);
  const timing = cleanField(a.timing, FIELD_CAP.timing);
  const moves = actor && Boolean(direction || magnitude) && !NEGATED_MOTION.test(action);
  if (!moves) {
    if (magnitude) parts.push(`size: ${magnitude}`);
    if (timing) parts.push(`timing: ${timing}`);
    const line = `${parts.join(", ")}.`;
    return { text: actor ? line : `Product: the ${subject}. ${line}`, moves };
  }
  const movement = !magnitude
    ? "a clearly visible movement"
    : magnitude.includes(" ")
      ? `a clearly visible movement of ${magnitude}`
      : `a clearly visible ${magnitude} movement`;
  const stops = STOP_STATE.test(cleanField(a.endingState, FIELD_CAP.state))
    ? ", then it stops"
    : "";
  return { text: `${parts.join(", ")}: ${movement}${timing ? `, ${timing}` : ""}${stops}.`, moves };
}

const FRAMING =
  "Steady fixed camera; the surroundings stay in place. Photorealistic, no text or overlays.";

/** Drops a leading article so "The {subject}" never reads "The the vacuum". */
function bareSubject(subject: string): string {
  return subject.replace(/^(the|a|an)\s+/i, "");
}

/**
 * Compile the X2 prompt. Always <= LIMITS.reactorPromptMaxChars: optional lines (features, setup)
 * are dropped first, then the result is cut at a word boundary as a last resort.
 */
export function compileReactorPrompt(plan: ActionPlan, product: PromptProduct): string {
  const a = plan.selectedAction;
  const subject = bareSubject(cleanField(a.subject, FIELD_CAP.subject)) || "product";
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

  const lead = actionLead(plan, subject);
  const only = lead.moves
    ? "It is the only thing that moves"
    : plan.purpose === "solution"
      ? "Only this one step happens"
      : "Only this action happens";
  const identity = (withFeatures: boolean) =>
    `${only}; it stays identical to the reference image${
      withFeatures && features ? `, with ${features}` : ""
    }.`;

  const build = (withFeatures: boolean, withSetup: boolean): string =>
    [
      lead.text,
      start ? `Starting state: ${sentence(start)}` : "",
      end ? `Ending state: ${sentence(end)}` : "",
      withSetup && setup ? `Setup: ${setup}.` : "",
      identity(withFeatures),
      FRAMING,
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
