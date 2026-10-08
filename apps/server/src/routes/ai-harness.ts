// Test-only harness for server-ai route tests. Gemini and Reactor are replaced by LABELED stubs
// (no network); live checks are in providers/*.live.test.ts. Stub output is never served live.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CaseResponse, PlannerResult } from "@symptomsketch/contracts";
import { createGeminiClient, type InteractionsTransport } from "../providers/gemini-client.ts";
import { type PlannerModelOutput, setGeminiFor } from "../providers/planner.ts";
import { ReactorTokenError } from "../providers/reactor-token.ts";
import { Browser, type CoreServer, startCoreServer } from "./core-harness.ts";
import { setReactorMinterFor } from "./reactor.ts";

/** A client request / idempotency key in the ClientRequestId format. */
export const reqId = (): string => `req_${randomUUID()}`;

export interface AiHarness {
  srv: CoreServer;
  /** Queued stub Gemini replies (raw output_text, or an Error to throw). */
  replies: (string | Error)[];
  /** Stub Gemini calls so far. */
  calls: number;
  /** Make the stub Reactor minter fail with REACTOR_UNAVAILABLE. */
  mintFails: boolean;
}

export async function startAiServer(): Promise<AiHarness> {
  const h: AiHarness = { srv: await startCoreServer(), replies: [], calls: 0, mintFails: false };
  h.srv.ctx.jobs.start();
  const transport: InteractionsTransport = {
    async create() {
      h.calls += 1;
      const next = h.replies.shift();
      if (next === undefined) throw new Error("no stub reply queued");
      if (next instanceof Error) throw next;
      return { status: "completed", model: "stub-model", output_text: next };
    },
  };
  setGeminiFor(h.srv.ctx, createGeminiClient({ apiKey: "unused", transport }));
  setReactorMinterFor(h.srv.ctx, async () => {
    if (h.mintFails) throw new ReactorTokenError("REACTOR_UNAVAILABLE", "network");
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    return { jwt: "stub.jwt.value", expiresAt, maxSessions: 1 };
  });
  return h;
}

export const ACCOUNT = "The vacuum stops and then jerks backward once. It only happens sometimes.";

export function plannerOut(over: Partial<PlannerModelOutput> = {}): PlannerModelOutput {
  return {
    selectedAction: {
      subject: "round robot vacuum",
      startingState: "driving forward, then stopping",
      action: "jerks backward",
      direction: "backward",
      repetitions: 1,
      timing: "right after it stops",
      magnitude: "a short distance",
      endingState: "stationary",
    },
    reportedFrequency: "sometimes",
    actionsTried: ["restarted it"],
    unresolved: [],
    prerequisites: [],
    invariants: ["same vacuum as the reference"],
    requiredConstraints: [
      {
        id: "direction",
        expected: "moves backward",
        critical: true,
        sourceKind: "account",
        quote: "jerks backward",
        stepIndex: null,
      },
      {
        id: "count",
        expected: "exactly one backward jerk",
        critical: true,
        sourceKind: "account",
        quote: "once",
        stepIndex: null,
      },
    ],
    sourceReferences: [
      { kind: "account", label: "Your description", quote: "jerks backward once", stepIndex: null },
    ],
    understanding: "The vacuum stops, then jerks backward one time.",
    preserved: ["The same vacuum"],
    unclear: [],
    clarificationQuestion: null,
    clarificationBlocking: false,
    caption: "Illustration of one backward jerk after stopping",
    spans: [
      {
        messageRef: "account",
        quote: "jerks backward",
        start: 0,
        end: 5,
        field: "movement",
        label: "x",
      },
      { messageRef: "account", quote: "once", start: 47, end: 51, field: "count", label: "x" },
      {
        messageRef: "correction",
        quote: "smaller",
        start: 0,
        end: 7,
        field: "magnitude",
        label: "x",
      },
    ],
    ...over,
  };
}

export async function loggedIn(h: AiHarness): Promise<Browser> {
  const b = new Browser(h.srv.base);
  assert.equal((await b.login()).status, 200);
  return b;
}

export async function newCase(
  b: Browser,
  purpose: "problem" | "solution" = "problem",
): Promise<string> {
  const res = await b.json("/api/cases", "POST", { purpose, fixtureId: "robot-vacuum" });
  assert.equal(res.status, 201);
  const id = ((await res.json()) as CaseResponse).case.id;
  const patch = await b.json(`/api/cases/${id}`, "PATCH", {
    originalAccount: ACCOUNT,
    actionsTried: "Restarted it",
  });
  assert.equal(patch.status, 200);
  return id;
}

export async function plan(
  h: AiHarness,
  b: Browser,
  caseId: string,
  body: Record<string, unknown>,
  reply: PlannerModelOutput | string = plannerOut(),
): Promise<Response> {
  h.replies.push(typeof reply === "string" ? reply : JSON.stringify(reply));
  return b.json(`/api/cases/${caseId}/plans`, "POST", {
    purpose: "problem",
    parentPlanId: null,
    correction: null,
    clientRequestId: reqId(),
    ...body,
  });
}

export async function readyCase(
  h: AiHarness,
): Promise<{ b: Browser; caseId: string; planId: string }> {
  const b = await loggedIn(h);
  const caseId = await newCase(b);
  const r = (await (await plan(h, b, caseId, {})).json()) as PlannerResult;
  return { b, caseId, planId: r.planRevision.id };
}
