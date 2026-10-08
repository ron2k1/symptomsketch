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
  // Motion-first (docs/providers/reactor-x2.md section 9): the moving subject + action lead.
  assert.match(
    prompt,
    /^The small round white robot vacuum with a dark circular top jerks backward, exactly once: a clearly visible large movement, immediately after stopping, then it stops\./,
  );
  assert.match(prompt, /front bumper/); // confirmed feature not already in the subject
  assert.equal(prompt.match(/dark circular top/g)?.length, 1); // deduped against the subject
  assert.match(prompt, /Starting state: Moving forward across the rug, then comes to a stop\./);
  assert.match(prompt, /Ending state: Stationary\./);
  assert.match(
    prompt,
    /It is the only thing that moves; it stays identical to the reference image/,
  );
  assert.match(prompt, /Steady fixed camera; the surroundings stay in place\./);
  // The stasis-first wording the motion lab measured as non-moving is gone.
  assert.equal(prompt.includes("Start: "), false);
  assert.equal(prompt.includes("no other movement"), false);
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
    assert.match(p, /, immediately after stopping, then it stops\./);
    assert.match(p, /jerks backward/);
  }
  assert.match(p1, /a clearly visible large movement/);
  assert.match(p2, /a clearly visible small movement/);
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
  assert.match(prompt, /makes a short jerk, direction: backward, exactly once/);
});

test("multi-word magnitude reads as 'a clearly visible movement of ...'; null fields drop out", () => {
  const prompt = compileReactorPrompt(
    demoPlan({
      subject: "the robot vacuum",
      action: "Drives backward",
      magnitude: "about a quarter of its body length",
      timing: "over about 2 seconds",
    }),
    product,
  );
  assert.match(
    prompt,
    /^The robot vacuum drives backward, exactly once: a clearly visible movement of about a quarter of its body length, over about 2 seconds, then it stops\./,
  );
  const noSize = compileReactorPrompt(
    demoPlan({ repetitions: null, magnitude: null, timing: null }),
    product,
  );
  assert.match(noSize, /jerks backward: a clearly visible movement, then it stops\./);
  // No direction and no size: the movement clause is not added on the action text alone.
  const bare = compileReactorPrompt(
    demoPlan({ direction: null, repetitions: null, magnitude: null, timing: null }),
    product,
  );
  assert.match(bare, /top jerks backward\. Starting state:/);
  // "then it stops" only when the ending state is a stop.
  const keepsGoing = compileReactorPrompt(demoPlan({ endingState: "rolling backward" }), product);
  assert.match(keepsGoing, /a clearly visible large movement, immediately after stopping\. /);
});

test("a light blink is not asked to be a movement", () => {
  const prompt = compileReactorPrompt(
    demoPlan({
      action: "Status light blinks red",
      direction: null,
      repetitions: 3,
      magnitude: null,
      timing: null,
      endingState: "light off",
    }),
    product,
  );
  assert.match(
    prompt,
    /^Product: the small round white robot vacuum with a dark circular top\. Action: Status light blinks red, exactly 3 times\. /,
  );
  assert.equal(prompt.includes("clearly visible movement"), false);
  assert.equal(prompt.includes("then it stops"), false);
  assert.equal(prompt.includes("It is the only thing that moves"), false);
  assert.match(prompt, /Only this action happens; it stays identical to the reference image/);
});

test("a no-movement action keeps the product as actor without a movement clause", () => {
  for (const direction of [null, "forward"]) {
    const prompt = compileReactorPrompt(
      demoPlan({
        action: "Does not move when the start button is pressed",
        direction,
        magnitude: null,
        timing: null,
      }),
      product,
    );
    assert.match(
      prompt,
      /^The small round white robot vacuum with a dark circular top does not move when the start button is pressed, (direction: forward, )?exactly once\. /,
    );
    assert.equal(prompt.includes("clearly visible movement"), false);
    assert.equal(prompt.includes("only thing that moves"), false);
  }
});

function solutionPlan(overrides: Partial<ActionPlan["selectedAction"]>): ActionPlan {
  return { ...demoPlan(overrides), purpose: "solution", procedureRevisionId: "proc_1" };
}

test("drone hover solution step does not ask for a movement", () => {
  const hover = {
    subject: "white quadcopter camera drone with landing legs",
    action: "holds one spot in the air, level, without drifting sideways or bobbing up and down",
    direction: null,
    repetitions: null,
    magnitude: null,
    timing: "for a few seconds",
    startingState: "hovering at about eye height",
    endingState: "still hovering in the same spot",
  };
  const prompt = compileReactorPrompt(solutionPlan(hover), product);
  assert.match(
    prompt,
    /^The white quadcopter camera drone with landing legs holds one spot in the air, level, without drifting sideways or bobbing up and down, timing: for a few seconds\. /,
  );
  assert.equal(prompt.includes("clearly visible movement"), false);
  assert.match(prompt, /Only this one step happens/);
  // Even as a problem plan with a direction, the negated drift is not turned into a movement.
  const asProblem = compileReactorPrompt(demoPlan({ ...hover, direction: "sideways" }), product);
  assert.equal(asProblem.includes("clearly visible movement"), false);
});

test("a solution step where the product travels gets the motion-first lead", () => {
  const prompt = compileReactorPrompt(
    solutionPlan({
      action: "drives forward in a straight line",
      direction: "forward",
      magnitude: "short way",
      timing: null,
    }),
    product,
  );
  assert.match(
    prompt,
    /drives forward in a straight line, exactly once: a clearly visible movement/,
  );
  assert.match(prompt, /It is the only thing that moves/);
  assert.equal(prompt.startsWith("Product:"), false);
});

test("an imperative solution step is not written with the product as the actor", () => {
  const prompt = compileReactorPrompt(
    solutionPlan({
      action: "Press the start button once and step back",
      direction: null,
      magnitude: null,
      timing: null,
    }),
    product,
  );
  assert.match(
    prompt,
    /^Product: the small round white robot vacuum with a dark circular top\. Action: Press the start button once and step back, exactly once\. /,
  );
  assert.equal(prompt.includes("vacuum with a dark circular top press"), false);
  assert.equal(prompt.includes("clearly visible movement"), false);
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
  assert.match(prompt, /^Product: the very /); // "very" is not a 3rd-person verb: neutral lead
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
