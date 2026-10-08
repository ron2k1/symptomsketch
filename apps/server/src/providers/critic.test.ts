import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ActionPlan,
  ClipAssessment,
  deriveAssessmentStatus,
  type CriticModelOutput,
} from "@symptomsketch/contracts";
import {
  buildCriticTask,
  criticJsonSchema,
  CriticOutputError,
  runCritic,
  summarizeAssessment,
  validateCriticCoverage,
} from "./critic.ts";
import { createGeminiClient, GeminiError, type InteractionsTransport } from "./gemini-client.ts";

const plan = ActionPlan.parse({
  schemaVersion: 1,
  purpose: "problem",
  productRevisionId: "prod_1",
  procedureRevisionId: null,
  selectedAction: {
    subject: "round white robot vacuum",
    startingState: "moving, then stops",
    action: "jerks backward",
    direction: "backward",
    repetitions: 1,
    timing: "immediately after stopping",
    magnitude: "small",
    endingState: "stationary",
  },
  context: { reportedFrequency: null, actionsTried: [], unresolved: [] },
  prerequisites: [],
  invariants: [],
  requiredConstraints: [
    {
      id: "direction",
      expected: "backward",
      critical: true,
      source: { kind: "account", quote: "backward" },
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
  understanding: "SHOULD NOT REACH THE CRITIC",
  preservedDetails: [],
  caption: "Illustration of one backward jerk after stopping",
  sourceReferences: [],
  clarificationQuestion: null,
});
const ids = ["direction", "count", "product"];

function output(
  checks: CriticModelOutput["checks"],
  summary = "The vacuum stops and moves backward once.",
): CriticModelOutput {
  return { summary, checks, limitations: ["sampled at 8 fps"], suggestedPresentationChanges: [] };
}
const supported = (id: string, range: [number, number] | null = [2, 3]) => ({
  constraintId: id,
  result: "supported" as const,
  observation: `visible ${id}`,
  timeRangeSeconds: range,
});

test("status derivation: contradiction wins, then not_observable, only all-supported matches", () => {
  assert.equal(deriveAssessmentStatus([]), "uncertain");
  assert.equal(
    deriveAssessmentStatus([
      { result: "supported" },
      { result: "contradicted" },
      { result: "not_observable" },
    ]),
    "needs_revision",
  );
  assert.equal(
    deriveAssessmentStatus([{ result: "supported" }, { result: "not_observable" }]),
    "uncertain",
  );
  assert.equal(
    deriveAssessmentStatus([{ result: "supported" }, { result: "supported" }]),
    "matches",
  );
});

test("coverage: exact set passes and is returned in plan order", () => {
  const r = validateCriticCoverage(
    output([supported("product"), supported("count"), supported("direction")]),
    ids,
    8,
  );
  assert.ok(r.ok);
  assert.deepEqual(
    r.checks.map((c) => c.constraintId),
    ids,
  );
});

test("coverage: missing, duplicate and unknown ids are rejected", () => {
  const missing = validateCriticCoverage(
    output([supported("direction"), supported("count")]),
    ids,
    8,
  );
  assert.deepEqual(missing, { ok: false, reason: "missing_constraint" });
  const dup = validateCriticCoverage(
    output([
      supported("direction"),
      supported("direction"),
      supported("count"),
      supported("product"),
    ]),
    ids,
    8,
  );
  assert.deepEqual(dup, { ok: false, reason: "duplicate_constraint" });
  const unknown = validateCriticCoverage(
    output([supported("direction"), supported("count"), supported("product"), supported("speed")]),
    ids,
    8,
  );
  assert.deepEqual(unknown, { ok: false, reason: "unknown_constraint" });
});

test("coverage: empty observation and out-of-duration ranges are rejected; rounding is clamped", () => {
  const blank = validateCriticCoverage(
    output([
      { ...supported("direction"), observation: "   " },
      supported("count"),
      supported("product"),
    ]),
    ids,
    8,
  );
  assert.deepEqual(blank, { ok: false, reason: "empty_observation" });
  const late = validateCriticCoverage(
    output([supported("direction", [7, 9.5]), supported("count"), supported("product")]),
    ids,
    8,
  );
  assert.deepEqual(late, { ok: false, reason: "bad_time_range" });
  const inverted = validateCriticCoverage(
    output([supported("direction", [5, 4]), supported("count"), supported("product")]),
    ids,
    8,
  );
  assert.deepEqual(inverted, { ok: false, reason: "bad_time_range" });
  const rounded = validateCriticCoverage(
    output([supported("direction", [7.5, 8.2]), supported("count", null), supported("product")]),
    ids,
    8,
  );
  assert.ok(rounded.ok);
  assert.deepEqual(rounded.checks[0]!.timeRangeSeconds, [7.5, 8]);
  assert.equal(rounded.checks[1]!.timeRangeSeconds, null);
});

test("coverage: an empty frozen set can never pass", () => {
  assert.deepEqual(validateCriticCoverage(output([]), [], 8), {
    ok: false,
    reason: "no_constraints",
  });
});

test("summary always agrees with the derived status", () => {
  const checks = [
    supported("direction"),
    {
      constraintId: "count",
      result: "contradicted" as const,
      observation: "The vacuum moves backward twice.",
      timeRangeSeconds: [2, 5] as [number, number],
    },
    supported("product"),
  ];
  const s = summarizeAssessment("needs_revision", checks, "Looks consistent!", plan);
  assert.equal(s, "The vacuum moves backward twice. Expected: one backward jerk.");
});

test("task text carries constraints and intended action, never planner prose", () => {
  const task = buildCriticTask({ plan, procedure: null, durationSeconds: 8, requestedFps: 8 });
  assert.match(task, /"id":"direction"/);
  assert.match(task, /"videoDurationSeconds":8/);
  assert.equal(task.includes("SHOULD NOT REACH THE CRITIC"), false);
  const schema = criticJsonSchema(ids) as {
    properties: {
      checks: { minItems: number; items: { properties: { constraintId: { enum: string[] } } } };
    };
  };
  assert.equal(schema.properties.checks.minItems, 3);
  assert.deepEqual(schema.properties.checks.items.properties.constraintId.enum, ids);
});

function stubClient(replies: (string | Error)[]) {
  const requests: unknown[] = [];
  const transport: InteractionsTransport = {
    async create(request) {
      requests.push(request);
      const next = replies.shift();
      if (next === undefined) throw new Error("no more stub replies");
      if (next instanceof Error) throw next;
      return { status: "completed", model: "stub-model", output_text: next };
    },
  };
  return { client: createGeminiClient({ apiKey: "unused", transport }), requests };
}

const mp4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const runInput = {
  plan,
  procedure: null,
  durationSeconds: 8,
  requestedFps: 8,
  model: "stub-model",
  thinkingLevel: "medium" as const,
  mp4,
  reference: { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" as const },
};

test("runCritic adds the first and last stills after the reference when keyframes are given", async () => {
  const reply = output([supported("direction"), supported("count"), supported("product")], "ok");
  const { client, requests } = stubClient([JSON.stringify(reply)]);
  await runCritic(client, {
    ...runInput,
    keyframes: { first: new Uint8Array([4]), last: new Uint8Array([5]) },
  });
  const req = requests[0] as { input: { type: string; text?: string }[] };
  assert.deepEqual(
    req.input.map((p) => p.type),
    ["video", "image", "text", "image", "text", "image", "text"],
  );
  assert.match(req.input[2]!.text ?? "", /start of the video/);
  assert.match(req.input[4]!.text ?? "", /end of the video/);
});

test("runCritic sends video at requested fps, then image, then task; derives status itself", async () => {
  const modelSaysMatches = output(
    [
      supported("direction"),
      {
        constraintId: "count",
        result: "not_observable",
        observation: "Movement is too fast to count.",
        timeRangeSeconds: null,
      },
      supported("product"),
    ],
    "Everything matches perfectly.",
  );
  const { client, requests } = stubClient([JSON.stringify(modelSaysMatches)]);
  const result = await runCritic(client, runInput);
  assert.equal(result.status, "uncertain");
  assert.equal(result.modelId, "stub-model");
  assert.match(result.summary, /^Could not confirm one backward jerk/);
  const req = requests[0] as { input: { type: string; processing?: { fps: number } }[] };
  assert.deepEqual(
    req.input.map((p) => p.type),
    ["video", "image", "text"],
  );
  assert.equal(req.input[0]!.processing?.fps, 8);
  // The stored contract shape accepts what the server builds from it.
  ClipAssessment.parse({
    schemaVersion: 1,
    takeId: "take_1",
    finalSha256: "a".repeat(64),
    productRevisionId: "prod_1",
    planRevisionId: "plan_1",
    procedureRevisionId: null,
    criticPromptVersion: "critic-v1",
    modelId: result.modelId,
    inputCoverage: { kind: "full_video", requestedFps: 8, sampledTimestampsSeconds: [] },
    status: result.status,
    checks: result.checks,
    limitations: result.limitations,
    suggestedPresentationChanges: result.suggestedPresentationChanges,
  });
});

test("runCritic retries once on bad coverage, then succeeds", async () => {
  const bad = output([supported("direction"), supported("count")]);
  const good = output([supported("direction"), supported("count"), supported("product")]);
  const { client, requests } = stubClient([JSON.stringify(bad), JSON.stringify(good)]);
  const result = await runCritic(client, runInput);
  assert.equal(requests.length, 2);
  assert.equal(result.status, "matches");
});

test("runCritic gives up after two malformed outputs (never a favorable result)", async () => {
  const bad = output([supported("direction")]);
  const { client } = stubClient([JSON.stringify(bad), JSON.stringify(bad)]);
  await assert.rejects(runCritic(client, runInput), (err: unknown) => {
    assert.ok(err instanceof CriticOutputError);
    assert.equal(err.reason, "missing_constraint");
    return true;
  });
  const { client: c2 } = stubClient(["not json", "{}"]);
  await assert.rejects(runCritic(c2, runInput), (err: unknown) => err instanceof GeminiError);
});

test("runCritic surfaces provider errors without retrying", async () => {
  const providerDown = Object.assign(new Error("boom"), { status: 503 });
  const { client, requests } = stubClient([providerDown]);
  await assert.rejects(runCritic(client, runInput), (err: unknown) => {
    assert.ok(err instanceof GeminiError);
    assert.equal(err.code, "ASSESSMENT_FAILED");
    return true;
  });
  assert.equal(requests.length, 1);
});
