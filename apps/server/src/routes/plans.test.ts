// server-ai route tests: plans + procedures (stub Gemini, see ai-harness.ts).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type {
  CaseResponse,
  CreateProcedureResponse,
  PlannerResult,
} from "@symptomsketch/contracts";
import {
  ACCOUNT,
  type AiHarness,
  loggedIn,
  newCase,
  plan,
  plannerOut,
  reqId,
  startAiServer,
} from "./ai-harness.ts";
import { errorCode } from "./core-harness.ts";

let h: AiHarness;
before(async () => {
  h = await startAiServer();
});
after(() => h.srv.stop());

test("initial plan: ready, compiled prompt, validated spans, idempotent, stale parent conflicts", async () => {
  const b = await loggedIn(h);
  const caseId = await newCase(b);
  h.calls = 0;
  const clientRequestId = "req_initial_plan_0001";
  const res = await plan(h, b, caseId, { clientRequestId });
  assert.equal(res.status, 201);
  const r = (await res.json()) as PlannerResult;
  assert.equal(r.planRevision.status, "ready");
  assert.match(r.planRevision.reactorPrompt ?? "", /backward/);
  assert.match(r.planRevision.reactorPrompt ?? "", /exactly once/);
  assert.ok((r.planRevision.reactorPrompt ?? "").length <= 1000);
  assert.deepEqual(
    r.messages.map((m) => m.kind),
    ["account", "actions_tried", "understanding"],
  );
  const account = r.messages[0]!;
  assert.equal(account.text, ACCOUNT);
  // "jerks backward" re-anchored from bad offsets; "once" exact; correction span is stale.
  assert.deepEqual(
    account.highlights.map((h) => [account.text.slice(h.start, h.end), h.field, h.kind, h.label]),
    [
      ["jerks backward", "movement", "established", "Movement"],
      ["once", "count", "established", "Count"],
    ],
  );
  assert.ok(r.planRevision.plan.requiredConstraints.some((c) => c.id === "product"));

  const again = await b.json(`/api/cases/${caseId}/plans`, "POST", {
    purpose: "problem",
    parentPlanId: null,
    correction: null,
    clientRequestId,
  });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as PlannerResult).planRevision.id, r.planRevision.id);
  assert.equal(h.calls, 1);

  const stale = await plan(h, b, caseId, { clientRequestId: "req_stale_parent_0001" });
  assert.equal(stale.status, 409);
  assert.equal(await errorCode(stale), "PLAN_CONFLICT");
  h.replies = [];

  const detail = (await (await b.req(`/api/cases/${caseId}`)).json()) as CaseResponse;
  assert.equal(detail.case.problemPlanId, r.planRevision.id);
  assert.equal(detail.case.plans.length, 1);
});

test("correction and field edits go through the planner; newest correction tints, older settle", async () => {
  const b = await loggedIn(h);
  const caseId = await newCase(b);
  const first = (await (await plan(h, b, caseId, {})).json()) as PlannerResult;
  const correction = "The backward movement is smaller and happens immediately.";
  const res = await plan(
    h,
    b,
    caseId,
    { parentPlanId: first.planRevision.id, correction },
    plannerOut({
      selectedAction: {
        ...plannerOut().selectedAction,
        magnitude: "very small",
        timing: "immediately",
      },
      spans: [
        {
          messageRef: "correction",
          quote: "smaller",
          start: 27,
          end: 34,
          field: "magnitude",
          label: "x",
        },
        {
          messageRef: "correction",
          quote: "immediately",
          start: 46,
          end: 57,
          field: "timing",
          label: "x",
        },
        {
          messageRef: "account",
          quote: "jerks backward",
          start: 25,
          end: 39,
          field: "movement",
          label: "x",
        },
      ],
    }),
  );
  assert.equal(res.status, 201);
  const r = (await res.json()) as PlannerResult;
  assert.equal(r.planRevision.parentId, first.planRevision.id);
  assert.equal(r.planRevision.plan.selectedAction.repetitions, 1);
  assert.equal(r.planRevision.plan.selectedAction.direction, "backward");
  const userMsg = r.messages.find((m) => m.kind === "correction")!;
  assert.equal(userMsg.text, correction);
  assert.deepEqual(
    userMsg.highlights.map((h) => [h.field, h.kind]),
    [
      ["magnitude", "correction"],
      ["timing", "correction"],
    ],
  );

  const edit = await plan(
    h,
    b,
    caseId,
    { parentPlanId: r.planRevision.id, fieldEdits: { repetitions: 2 } },
    plannerOut({ spans: [] }),
  );
  assert.equal(edit.status, 201);
  const e = (await edit.json()) as PlannerResult;
  assert.equal(e.planRevision.plan.selectedAction.repetitions, 2);
  assert.match(e.planRevision.reactorPrompt ?? "", /exactly twice/);
  assert.match(e.messages.find((m) => m.kind === "correction")!.text, /count 2/);
  const detail = (await (await b.req(`/api/cases/${caseId}`)).json()) as CaseResponse;
  const older = detail.case.messages.find((m) => m.text === correction)!;
  assert.ok(older.highlights.every((h) => h.kind === "established"));
});

test("planner: one retry on malformed output, then PROVIDER_FAILED with nothing stored", async () => {
  const b = await loggedIn(h);
  const caseId = await newCase(b);
  h.replies.push("not json");
  const ok = await plan(h, b, caseId, {});
  assert.equal(ok.status, 201);

  h.replies.push("{}");
  const parent = ((await ok.json()) as PlannerResult).planRevision.id;
  const bad = await plan(
    h,
    b,
    caseId,
    { parentPlanId: parent, correction: "It moves left." },
    "{}",
  );
  assert.equal(bad.status, 502);
  assert.equal(await errorCode(bad), "PROVIDER_FAILED");
  const detail = (await (await b.req(`/api/cases/${caseId}`)).json()) as CaseResponse;
  assert.equal(detail.case.plans.length, 1);
  assert.equal(detail.case.messages.filter((m) => m.kind === "correction").length, 0);
});

test("blocking clarification -> needs_clarification, no prompt, no Reactor token", async () => {
  const b = await loggedIn(h);
  const caseId = await newCase(b);
  const res = await plan(
    h,
    b,
    caseId,
    {},
    plannerOut({
      clarificationQuestion: "Does it move backward or forward",
      clarificationBlocking: true,
    }),
  );
  const r = (await res.json()) as PlannerResult;
  assert.equal(r.planRevision.status, "needs_clarification");
  assert.equal(r.planRevision.reactorPrompt, null);
  assert.equal(r.clarificationQuestion, "Does it move backward or forward?");
  assert.deepEqual(
    r.messages.map((m) => m.kind),
    ["account", "actions_tried", "understanding", "clarification"],
  );
  const tok = await b.json(`/api/cases/${caseId}/reactor-token`, "POST", {
    planRevisionId: r.planRevision.id,
    clientRequestId: reqId(),
  });
  assert.equal(tok.status, 409);
});

test("solution plan needs an approved procedure; fixture procedure prefill confirms applicability", async () => {
  const b = await loggedIn(h);
  const caseId = await newCase(b, "solution");
  const early = await plan(h, b, caseId, { purpose: "solution" });
  assert.equal(early.status, 400);
  h.replies = [];
  const proc = await b.json(`/api/cases/${caseId}/procedures`, "POST", {
    title: "x",
    approvedText: "x",
    sourceDescription: "x",
    modelApplicabilityConfirmed: false,
    fixtureProcedureId: "SS-DEMO-RV-01",
  });
  assert.equal(proc.status, 201);
  const p = ((await proc.json()) as CreateProcedureResponse).procedure;
  assert.equal(p.modelApplicabilityConfirmed, true);
  assert.ok(p.steps.length > 0);
  const res = await plan(h, b, caseId, { purpose: "solution" }, plannerOut({ spans: [] }));
  assert.equal(res.status, 201);
  const r = (await res.json()) as PlannerResult;
  assert.equal(r.planRevision.procedureRevisionId, p.id);
  assert.equal(r.planRevision.purpose, "solution");
});
