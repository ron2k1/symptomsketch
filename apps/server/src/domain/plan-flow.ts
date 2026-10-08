// POST /api/cases/:id/plans orchestration (spec 9, 11): one fresh planner call built from the
// canonical DB state, deterministic plan building + prompt compilation + readiness, then the
// user message, plan revision, planner messages and purpose pointer in a single transaction.
import {
  HighlightField,
  type CreatePlanRequest,
  type HighlightSpan,
  type Message,
  type PlanFieldEdits,
  type PlannerResult,
  type PlanStatus,
} from "@symptomsketch/contracts";
import { ZodError } from "zod";
import type { AppContext } from "../context.ts";
import { fromJson, newId, now, tx } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import { GeminiError } from "../providers/gemini-client.ts";
import { type PlannerInput, geminiFor, runPlanner } from "../providers/planner.ts";
import { checkReadiness, compileReactorPrompt } from "../providers/prompt-compiler.ts";
import { type SpanTarget, supersedeSpans, validateSpans } from "../providers/spans.ts";
import { bumpSessionCounter, limiterFor } from "./leases.ts";
import {
  type MessageRow,
  insertMessage,
  listMessagesForPlan,
  setHighlights,
  toMessage,
} from "./messages.ts";
import { buildActionPlan } from "./plan-builder.ts";
import {
  type PlanRow,
  currentPlanId,
  findPlanByClientRequest,
  insertPlanRevision,
  loadCase,
  loadProductRevision,
  loadReferenceImage,
  requireOwnedActiveCase,
  toPlanRevision,
} from "./plans.ts";
import { type Prepared, preparePlanRequest } from "./plan-request.ts";

const EDIT_FIELD: Record<keyof PlanFieldEdits, HighlightField> = {
  direction: "movement",
  repetitions: "count",
  timing: "timing",
  magnitude: "magnitude",
};

function mapPlannerError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof GeminiError) {
    console.warn(
      `[planner] failed code=${err.code} reason=${err.reason} http=${err.httpStatus ?? "-"}`,
    );
    if (err.code === "ASSESSMENT_FAILED") {
      return new AppError(err.reason === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_FAILED");
    }
    return new AppError(err.code);
  }
  console.warn(`[planner] failed ${err instanceof ZodError ? "plan_invalid" : "unexpected"}`);
  return new AppError("PROVIDER_FAILED");
}

/** Replay a stored revision as a PlannerResult (idempotent repeat of the same clientRequestId). */
export function plannerResultFor(ctx: AppContext, row: PlanRow): PlannerResult {
  const messages = listMessagesForPlan(ctx.db, row.id);
  return {
    planRevision: toPlanRevision(row),
    understanding: row.understanding,
    preserved: fromJson<string[]>(row.preserved_json, []),
    unclear: fromJson<string[]>(row.unclear_json, []),
    clarificationQuestion: row.clarification_question,
    highlights: messages.flatMap((m) => m.highlights),
    messages,
  };
}

const inflight = new Map<string, Promise<PlannerResult>>();
const purposeLocks = new Set<string>();

/**
 * Create the next plan revision. Idempotent on clientRequestId (a repeat returns the stored
 * result); a concurrent or stale request for the same case + purpose gets PLAN_CONFLICT.
 */
export async function createPlan(
  ctx: AppContext,
  session: SessionInfo,
  caseId: string,
  input: CreatePlanRequest,
): Promise<{ result: PlannerResult; created: boolean }> {
  const kase = requireOwnedActiveCase(ctx.db, session, caseId);
  const done = findPlanByClientRequest(ctx.db, kase.id, input.clientRequestId);
  if (done) return { result: plannerResultFor(ctx, done), created: false };
  const key = `${kase.id}:${input.clientRequestId}`;
  const running = inflight.get(key);
  if (running) return { result: await running, created: false };

  const lock = `${kase.id}:${input.purpose}`;
  if (purposeLocks.has(lock)) throw new AppError("PLAN_CONFLICT");
  const prepared = preparePlanRequest(ctx, kase, input);
  limiterFor(ctx).take("plan", session.id);
  purposeLocks.add(lock);
  const work = runPlanFlow(ctx, session, prepared, input);
  inflight.set(key, work);
  try {
    return { result: await work, created: true };
  } finally {
    inflight.delete(key);
    purposeLocks.delete(lock);
  }
}

async function runPlanFlow(
  ctx: AppContext,
  session: SessionInfo,
  p: Prepared,
  input: CreatePlanRequest,
): Promise<PlannerResult> {
  const product = loadProductRevision(ctx.db, p.kase.product_revision_id!);
  if (!product) throw new AppError("VALIDATION_FAILED", "Add a product photo before planning.");
  const confirmedFeatures = fromJson<string[]>(product.confirmed_features_json, []);
  const parentPlan = p.parent ? toPlanRevision(p.parent) : null;

  const plannerInput: PlannerInput = {
    purpose: p.purpose,
    account:
      p.purpose === "problem"
        ? { whatHappened: p.account.text, whatITried: p.actionsTried?.text ?? "" }
        : null,
    product: {
      label: product.model_label ?? p.kase.model_label,
      sourceType: product.source_type,
      confirmedFeatures,
      image: await loadReferenceImage(ctx, product),
    },
    procedure: p.procedure
      ? {
          title: p.procedure.title,
          code: p.procedure.procedureCode,
          steps: p.procedure.steps,
          sourceDescription: p.procedure.sourceDescription,
          modelApplicabilityConfirmed: p.procedure.modelApplicabilityConfirmed,
        }
      : null,
    previousPlan: parentPlan
      ? {
          plan: parentPlan.plan,
          status: parentPlan.status,
          clarificationQuestion: p.parent!.clarification_question,
        }
      : null,
    correction: p.correction
      ? { kind: p.correction.kind === "answer" ? "answer" : "correction", text: p.correction.text }
      : null,
    fieldEdits: input.fieldEdits ?? null,
  };

  bumpSessionCounter(ctx.db, session.id, "plan_calls");
  let run;
  let built;
  try {
    run = await runPlanner(geminiFor(ctx), {
      model: ctx.config.geminiTextModel,
      thinkingLevel: ctx.config.geminiThinkingLevel,
      input: plannerInput,
    });
    built = buildActionPlan(run.output, {
      purpose: p.purpose,
      productRevisionId: product.id,
      procedure: p.procedure,
      account: p.purpose === "problem" ? p.account : null,
      actionsTried: p.purpose === "problem" ? p.actionsTried : null,
      corrections: p.correction ? [p.correction, ...p.olderCorrections] : p.olderCorrections,
      fieldEdits: input.fieldEdits ?? null,
    });
  } catch (err) {
    throw mapPlannerError(err);
  }
  console.log(`[planner] ok case=${p.kase.id} purpose=${p.purpose} latencyMs=${run.latencyMs}`);

  const prompt = compileReactorPrompt(built.plan, {
    modelLabel: product.model_label ?? p.kase.model_label,
    confirmedFeatures,
  });
  const readiness = checkReadiness(
    built.plan,
    { prompt, caption: built.plan.caption },
    {
      procedure: p.procedure
        ? {
            id: p.procedure.id,
            productRevisionId: p.procedure.productRevisionId,
            modelApplicabilityConfirmed: p.procedure.modelApplicabilityConfirmed,
          }
        : null,
      clarificationBlocking: built.clarificationBlocking,
    },
  );
  const status: PlanStatus =
    readiness.issues.length > 0
      ? "invalid"
      : readiness.needsClarification
        ? "needs_clarification"
        : "ready";

  // Highlights: validated against the exact stored texts the planner saw.
  const targets: SpanTarget[] = [];
  if (p.purpose === "problem") {
    targets.push({
      ref: "account",
      messageId: p.account.id,
      text: p.account.text,
      kind: "established",
    });
  }
  if (p.correction) {
    targets.push({
      ref: "correction",
      messageId: p.correction.id,
      text: p.correction.text,
      kind: "correction",
    });
  }
  const { accepted } = validateSpans(run.output.spans, targets);
  const correctionSpans = accepted.filter((s) => s.messageId === p.correction?.id);
  const changed = new Set<HighlightField>(correctionSpans.map((s) => s.field));
  for (const k of Object.keys(input.fieldEdits ?? {}) as (keyof PlanFieldEdits)[]) {
    changed.add(EDIT_FIELD[k]);
  }
  const freshAccount = accepted.filter((s) => s.messageId === p.account.id);
  const accountSpans =
    freshAccount.length > 0
      ? freshAccount.filter((s) => !changed.has(s.field))
      : supersedeSpans(p.accountIsNew ? [] : toMessage(p.account).highlights, changed);
  const olderUpdates = p.correction
    ? p.olderCorrections.map((row) => ({
        id: row.id,
        spans: supersedeSpans(toMessage(row).highlights, changed),
      }))
    : [];

  const planId = newId("plan");
  const row = tx(ctx.db, () => {
    const latest = loadCase(ctx.db, p.kase.id);
    if (!latest || latest.status !== "active") throw new AppError("CASE_INACTIVE");
    const again = findPlanByClientRequest(ctx.db, p.kase.id, input.clientRequestId);
    if (again) return again;
    if (currentPlanId(latest, p.purpose) !== (p.parent?.id ?? null)) {
      throw new AppError("PLAN_CONFLICT");
    }
    const ts = now();
    const stored = insertPlanRevision(ctx.db, {
      id: planId,
      case_id: p.kase.id,
      parent_id: p.parent?.id ?? null,
      purpose: p.purpose,
      product_revision_id: product.id,
      procedure_revision_id: built.plan.procedureRevisionId,
      status,
      plan: built.plan,
      reactor_prompt: status === "ready" ? prompt : null,
      caption: built.plan.caption,
      understanding: built.understanding,
      preserved: built.preserved,
      unclear: built.unclear,
      clarification_question: built.clarificationQuestion,
      validationIssues: readiness.issues,
      model_id: run.modelId,
      client_request_id: input.clientRequestId,
      created_at: ts,
    });
    const user = (m: MessageRow, highlights: HighlightSpan[]) =>
      insertMessage(ctx.db, {
        id: m.id,
        caseId: m.case_id,
        purpose: m.purpose,
        role: "user",
        kind: m.kind,
        text: m.text,
        planRevisionId: planId,
        highlights,
        createdAt: ts,
      });
    if (p.purpose === "problem") {
      if (p.accountIsNew) user(p.account, accountSpans);
      else setHighlights(ctx.db, p.account.id, accountSpans);
      if (p.actionsTriedIsNew && p.actionsTried) user(p.actionsTried, []);
    }
    for (const u of olderUpdates) setHighlights(ctx.db, u.id, u.spans);
    if (p.correction) user(p.correction, correctionSpans);
    const planner = (kind: "understanding" | "clarification", text: string) =>
      insertMessage(ctx.db, {
        caseId: p.kase.id,
        purpose: p.purpose,
        role: "planner",
        kind,
        text,
        planRevisionId: planId,
        createdAt: ts,
      });
    planner("understanding", built.understanding);
    if (built.clarificationQuestion) planner("clarification", built.clarificationQuestion);
    return stored;
  });
  if (row.id !== planId) return plannerResultFor(ctx, row);

  const messages: Message[] = listMessagesForPlan(ctx.db, planId);
  const highlights: HighlightSpan[] = [
    ...(p.purpose === "problem" ? accountSpans : []),
    ...olderUpdates.flatMap((u) => u.spans),
    ...correctionSpans,
  ];
  return {
    planRevision: toPlanRevision(row),
    understanding: built.understanding,
    preserved: built.preserved,
    unclear: built.unclear,
    clarificationQuestion: built.clarificationQuestion,
    highlights,
    messages,
  };
}
