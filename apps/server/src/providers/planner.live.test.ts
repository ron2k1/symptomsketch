// Live planner check against the real Gemini API. Skipped unless LIVE_GEMINI=1, e.g. from apps/server:
//   $env:LIVE_GEMINI = "1"; npx tsx --test src/providers/planner.live.test.ts
// Uses config.ts (root .env) and the demo vacuum photo. Prints only model id, latency and
// validated enum/number fields; never the key or raw provider bodies.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import { getConfig } from "../config.ts";
import type { MessageRow } from "../domain/messages.ts";
import { type BuiltPlan, buildActionPlan } from "../domain/plan-builder.ts";
import { createGeminiClient } from "./gemini-client.ts";
import { runPlanner, type PlannerInput } from "./planner.ts";
import { checkReadiness, compileReactorPrompt } from "./prompt-compiler.ts";
import { validateSpans } from "./spans.ts";

const LIVE = process.env.LIVE_GEMINI === "1";
const ACCOUNT = "The vacuum stops and then jerks backward once. It only happens sometimes.";
const CORRECTION = "The backward movement is smaller and happens immediately.";

function row(id: string, kind: MessageRow["kind"], text: string): MessageRow {
  return {
    id,
    case_id: "case_live",
    purpose: "problem",
    role: "user",
    kind,
    text,
    plan_revision_id: null,
    highlights_json: "[]",
    created_at: new Date().toISOString(),
  };
}

function report(label: string, fields: Record<string, unknown>): void {
  console.log(`[planner-live] ${label} ${JSON.stringify(fields)}`);
}

describe("planner live", { skip: LIVE ? false : "set LIVE_GEMINI=1 to call the real API" }, () => {
  let config: ReturnType<typeof getConfig>;
  let client: ReturnType<typeof createGeminiClient>;
  let image: Buffer;
  let first: BuiltPlan;
  const account = row("msg_live_account", "account", ACCOUNT);
  const product = { modelLabel: null, confirmedFeatures: [] as string[] };

  before(() => {
    config = getConfig();
    client = createGeminiClient({ apiKey: config.geminiApiKey });
    image = readFileSync(path.join(config.demoAssetsDir, "demo-vacuum.jpg"));
  });

  function input(over: Partial<PlannerInput> = {}): PlannerInput {
    return {
      purpose: "problem",
      account: { whatHappened: ACCOUNT, whatITried: "" },
      product: {
        label: null,
        sourceType: "demo_photo",
        confirmedFeatures: [],
        image: { bytes: image, mime: "image/jpeg" },
      },
      procedure: null,
      previousPlan: null,
      correction: null,
      fieldEdits: null,
      ...over,
    };
  }

  test("initial account -> one backward movement, compiled prompt ready", async () => {
    const run = await runPlanner(client, {
      model: config.geminiTextModel,
      thinkingLevel: config.geminiThinkingLevel,
      input: input(),
    });
    first = buildActionPlan(run.output, {
      purpose: "problem",
      productRevisionId: "prod_live",
      procedure: null,
      account,
      actionsTried: null,
      corrections: [],
      fieldEdits: null,
    });
    const a = first.plan.selectedAction;
    const prompt = compileReactorPrompt(first.plan, product);
    const readiness = checkReadiness(
      first.plan,
      { prompt, caption: first.plan.caption },
      { procedure: null, clarificationBlocking: first.clarificationBlocking },
    );
    const spans = validateSpans(run.output.spans, [
      { ref: "account", messageId: account.id, text: ACCOUNT, kind: "established" },
    ]);
    report("initial", {
      modelId: run.modelId,
      latencyMs: run.latencyMs,
      direction: a.direction,
      repetitions: a.repetitions,
      constraints: first.plan.requiredConstraints.map((c) => c.id),
      promptChars: prompt.length,
      captionChars: first.plan.caption.length,
      issues: readiness.issues.length,
      blocking: readiness.needsClarification,
      spansAccepted: spans.accepted.map((s) => [ACCOUNT.slice(s.start, s.end), s.field]),
      spansRejected: spans.rejected.map((r) => r.reason),
    });
    assert.match(a.direction ?? "", /backward/i);
    assert.equal(a.repetitions, 1);
    assert.ok(prompt.length > 0 && prompt.length <= 1000);
    assert.match(prompt, /backward/i);
    assert.match(prompt, /exactly once/);
    assert.deepEqual(readiness.issues, []);
    assert.ok(spans.accepted.length >= 1, "at least one highlight survives validation");
    for (const s of spans.accepted) assert.ok(ACCOUNT.slice(s.start, s.end).length > 0);
  });

  test("magnitude/timing correction keeps direction and count", async () => {
    assert.ok(first, "initial plan ran");
    const correction = row("msg_live_correction", "correction", CORRECTION);
    const run = await runPlanner(client, {
      model: config.geminiTextModel,
      thinkingLevel: config.geminiThinkingLevel,
      input: input({
        previousPlan: { plan: first.plan, status: "ready", clarificationQuestion: null },
        correction: { kind: "correction", text: CORRECTION },
      }),
    });
    const next = buildActionPlan(run.output, {
      purpose: "problem",
      productRevisionId: "prod_live",
      procedure: null,
      account,
      actionsTried: null,
      corrections: [correction],
      fieldEdits: null,
    });
    const a = next.plan.selectedAction;
    const prompt = compileReactorPrompt(next.plan, product);
    const spans = validateSpans(run.output.spans, [
      { ref: "account", messageId: account.id, text: ACCOUNT, kind: "established" },
      { ref: "correction", messageId: correction.id, text: CORRECTION, kind: "correction" },
    ]);
    const corr = spans.accepted.filter((s) => s.messageId === correction.id);
    report("correction", {
      modelId: run.modelId,
      latencyMs: run.latencyMs,
      direction: a.direction,
      repetitions: a.repetitions,
      magnitudeSet: a.magnitude !== null,
      timingSet: a.timing !== null,
      promptChars: prompt.length,
      correctionSpans: corr.map((s) => [CORRECTION.slice(s.start, s.end), s.field, s.kind]),
      spansRejected: spans.rejected.map((r) => r.reason),
    });
    assert.match(a.direction ?? "", /backward/i);
    assert.equal(a.repetitions, 1);
    assert.ok(a.magnitude, "magnitude carried into the plan");
    assert.ok(prompt.length <= 1000);
    assert.match(prompt, /exactly once/);
    assert.ok(corr.every((s) => s.kind === "correction"));
  });
});
