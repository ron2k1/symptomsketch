import assert from "node:assert/strict";
import { test } from "node:test";
import { ActionPlan, LIMITS } from "@symptomsketch/contracts";
import {
  checkReadiness,
  cleanField,
  compileCaption,
  compileReactorPrompt,
  countPhrase,
} from "./prompt-compiler.ts";

function demoPlan(overrides: Partial<ActionPlan["selectedAction"]> = {}): ActionPlan {
  return ActionPlan.parse({
    schemaVersion: 1,
    purpose: "problem",
    productRevisionId: "prod_1",
    procedureRevisionId: null,
    selectedAction: {
      subject: "small round white robot vacuum with a dark circular top",
      startingState: "moving forward across the rug, then comes to a stop",
      action: "jerks backward",
      direction: "backward",
      repetitions: 1,
      timing: "immediately after stopping",
      magnitude: "large",
      endingState: "stationary",
      ...overrides,
    },
    context: {
      reportedFrequency: "intermittent",
      actionsTried: ["restarted it from the app"],
      unresolved: ["cause unknown"],
    },
    prerequisites: [],
    invariants: ["same selected product"],
    requiredConstraints: [
      {
        id: "direction",
        expected: "backward",
        critical: true,
        source: { kind: "account", quote: "jerks backward" },
      },
      {
        id: "count",
        expected: "one backward jerk",
        critical: true,
        source: { kind: "account", quote: "once" },
      },
      {
        id: "product",
        expected: "same vacuum as the reference",
        critical: true,
        source: { kind: "reference", quote: null },
      },
    ],
    understanding: "Show a stop followed by one backward jerk; the cause is a worn wheel motor.",
    preservedDetails: ["one backward jerk"],
    caption: "Illustration of one backward jerk after stopping",
    sourceReferences: [],
    clarificationQuestion: null,
  });
}

const product = { modelLabel: null, confirmedFeatures: ["front bumper", "dark circular top"] };

test("prompt contains the observable action only and stays under the X2 limit", () => {
  const prompt = compileReactorPrompt(demoPlan(), product);
  assert.ok(prompt.length <= LIMITS.reactorPromptMaxChars);
  assert.match(prompt, /same small round white robot vacuum/);
  assert.match(prompt, /front bumper/); // confirmed feature not already in the subject
  assert.equal(prompt.match(/dark circular top/g)?.length, 1); // deduped against the subject
  assert.match(prompt, /Start: Moving forward across the rug, then comes to a stop\./);
  assert.match(
    prompt,
    /Action: Jerks backward, exactly once, size of the movement: large, timing: immediately after stopping\./,
  );
  assert.match(prompt, /End: Stationary\./);
  assert.match(prompt, /Steady fixed camera/);
  assert.match(prompt, /Photorealistic/);
  // Direction already in the action text is not repeated.
  assert.equal(prompt.includes("direction: backward"), false);
  // No chat history, actions tried, understanding, unresolved or causes.
  for (const banned of ["restarted", "app", "cause", "motor", "intermittent", "worn"]) {
    assert.equal(prompt.toLowerCase().includes(banned), false, `prompt leaked "${banned}"`);
  }
});

test("magnitude correction preserves count and timing in prompt and caption", () => {
  const before = demoPlan({ magnitude: "large" });
  const after = demoPlan({ magnitude: "small" });
  const p1 = compileReactorPrompt(before, product);
  const p2 = compileReactorPrompt(after, product);
  for (const p of [p1, p2]) {
    assert.match(p, /exactly once/);
    assert.match(p, /timing: immediately after stopping/);
    assert.match(p, /Jerks backward/);
  }
  assert.match(p1, /size of the movement: large/);
  assert.match(p2, /size of the movement: small/);
  assert.equal(p1.replace("large", "small"), p2, "only the magnitude changed");
  assert.equal(compileCaption(before), compileCaption(after));
});

test("compilation is deterministic", () => {
  assert.equal(
    compileReactorPrompt(demoPlan(), product),
    compileReactorPrompt(demoPlan(), product),
  );
});

test("direction not present in the action text is stated explicitly", () => {
  const prompt = compileReactorPrompt(
    demoPlan({ action: "makes a short jerk", direction: "backward" }),
    product,
  );
  assert.match(prompt, /Makes a short jerk, direction: backward, exactly once/);
});

test("cause clauses in fields are cut before reaching the video model", () => {
  assert.equal(cleanField("jerks backward because the sensor is dirty", 100), "jerks backward");
  assert.equal(cleanField("stops, due to a fault", 100), "stops");
  const prompt = compileReactorPrompt(
    demoPlan({ action: "jerks backward because of a faulty motor" }),
    product,
  );
  assert.equal(prompt.includes("faulty"), false);
});

test("oversized fields still produce a prompt within the limit", () => {
  const huge = "very ".repeat(400) + "long";
  const plan = demoPlan({
    subject: huge,
    startingState: huge,
    action: huge,
    endingState: huge,
    timing: huge,
    magnitude: huge,
    direction: huge,
  });
  const prompt = compileReactorPrompt(plan, {
    modelLabel: null,
    confirmedFeatures: [huge, huge + "x"],
  });
  assert.ok(prompt.length <= LIMITS.reactorPromptMaxChars, `length ${prompt.length}`);
  assert.match(prompt, /^The same /);
});

test("count phrases", () => {
  assert.equal(countPhrase(1), "exactly once");
  assert.equal(countPhrase(2), "exactly twice");
  assert.equal(countPhrase(3), "exactly 3 times");
});

test("caption falls back to a built caption when the planner caption is too long", () => {
  const plan = { ...demoPlan(), caption: "x".repeat(LIMITS.captionMaxChars + 1) };
  const caption = compileCaption(plan);
  assert.ok(caption.length <= LIMITS.captionMaxChars);
  assert.equal(caption, "Illustration of jerks backward immediately after stopping");
});

test("solution prompt includes setup prerequisites; problem prompt never does", () => {
  const solution = {
    ...demoPlan(),
    purpose: "solution" as const,
    procedureRevisionId: "proc_1",
    prerequisites: ["front bumper facing open space"],
  };
  assert.match(compileReactorPrompt(solution, product), /Setup: front bumper facing open space\./);
  assert.match(compileReactorPrompt(solution, product), /Show only this one step/);
  const problem = { ...demoPlan(), prerequisites: ["should never appear"] };
  assert.equal(compileReactorPrompt(problem, product).includes("should never appear"), false);
});

test("readiness: a complete problem plan has no issues", () => {
  const plan = demoPlan();
  const compiled = { prompt: compileReactorPrompt(plan, product), caption: compileCaption(plan) };
  const r = checkReadiness(plan, compiled, { procedure: null, clarificationBlocking: false });
  assert.deepEqual(r, { issues: [], needsClarification: false });
});

test("readiness: blocking question -> needs clarification; missing fields -> issues", () => {
  const plan = demoPlan({ action: "  ", endingState: "" });
  const compiled = { prompt: compileReactorPrompt(plan, product), caption: compileCaption(plan) };
  const r = checkReadiness(plan, compiled, { procedure: null, clarificationBlocking: true });
  assert.equal(r.needsClarification, true);
  assert.ok(r.issues.includes("The action to show is missing."));
  assert.ok(r.issues.includes("The ending state is missing."));
});

test("readiness: solution needs a matching, confirmed procedure", () => {
  const plan = { ...demoPlan(), purpose: "solution" as const, procedureRevisionId: "proc_1" };
  const compiled = { prompt: compileReactorPrompt(plan, product), caption: compileCaption(plan) };
  const none = checkReadiness(plan, compiled, { procedure: null, clarificationBlocking: false });
  assert.ok(none.issues.includes("Add the approved procedure before planning a solution."));
  const other = checkReadiness(plan, compiled, {
    procedure: {
      id: "proc_1",
      productRevisionId: "prod_other",
      modelApplicabilityConfirmed: false,
    },
    clarificationBlocking: false,
  });
  assert.ok(other.issues.includes("The procedure belongs to a different product reference."));
  assert.ok(other.issues.includes("Confirm that the procedure applies to this product model."));
  const ok = checkReadiness(plan, compiled, {
    procedure: { id: "proc_1", productRevisionId: "prod_1", modelApplicabilityConfirmed: true },
    clarificationBlocking: false,
  });
  assert.deepEqual(ok.issues, []);
});

test("readiness: over-limit prompt or caption is invalid", () => {
  const plan = demoPlan();
  const r = checkReadiness(
    plan,
    { prompt: "p".repeat(LIMITS.reactorPromptMaxChars + 1), caption: "c".repeat(91) },
    { procedure: null, clarificationBlocking: false },
  );
  assert.ok(r.issues.includes("The caption is empty or too long."));
  assert.ok(r.issues.includes("The visual prompt is empty or too long."));
});
