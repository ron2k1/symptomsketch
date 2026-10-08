// Plan request validation + canonical source gathering (no writes, no provider calls). Split from
// plan-flow.ts: everything here runs before the paid planner call.
import type {
  CreatePlanRequest,
  PlanFieldEdits,
  ProcedureRevision,
  Purpose,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { newId, now } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import { type MessageRow, findMessageOfKind, listUserCorrections } from "./messages.ts";
import { type AiCaseRow, type PlanRow, currentPlanId, getPlanRow } from "./plans.ts";
import { latestProcedureFor } from "./procedures.ts";

/** Conversation text for structured detail edits sent without a typed correction. */
export function describeFieldEdits(edits: PlanFieldEdits): string {
  const parts: string[] = [];
  if (edits.direction !== undefined) parts.push(`direction ${edits.direction ?? "not specified"}`);
  if (edits.repetitions !== undefined) {
    parts.push(`count ${edits.repetitions ?? "not specified"}`);
  }
  if (edits.timing !== undefined) parts.push(`timing ${edits.timing ?? "not specified"}`);
  if (edits.magnitude !== undefined) parts.push(`size ${edits.magnitude ?? "not specified"}`);
  return `Changed details: ${parts.join("; ")}.`;
}

export interface Prepared {
  kase: AiCaseRow;
  purpose: Purpose;
  parent: PlanRow | null;
  procedure: ProcedureRevision | null;
  account: MessageRow;
  accountIsNew: boolean;
  actionsTried: MessageRow | null;
  actionsTriedIsNew: boolean;
  correction: MessageRow | null;
  olderCorrections: MessageRow[];
}

function draftRow(
  kase: AiCaseRow,
  purpose: Purpose,
  kind: MessageRow["kind"],
  text: string,
): MessageRow {
  return {
    id: newId("msg"),
    case_id: kase.id,
    purpose,
    role: "user",
    kind,
    text,
    plan_revision_id: null,
    highlights_json: "[]",
    created_at: now(),
  };
}

/** Validate the request against the owned case and gather canonical sources (no writes). */
export function preparePlanRequest(
  ctx: AppContext,
  kase: AiCaseRow,
  input: CreatePlanRequest,
): Prepared {
  const { purpose } = input;
  const pointer = currentPlanId(kase, purpose);
  if ((input.parentPlanId ?? null) !== pointer) throw new AppError("PLAN_CONFLICT");
  const parent = input.parentPlanId ? (getPlanRow(ctx.db, input.parentPlanId) ?? null) : null;
  if (input.parentPlanId && (!parent || parent.case_id !== kase.id || parent.purpose !== purpose)) {
    throw new AppError("PLAN_CONFLICT");
  }
  if (input.fieldEdits && !parent) {
    throw new AppError("VALIDATION_FAILED", "Detail edits need an existing plan.");
  }
  if (input.isClarificationAnswer && !input.correction) {
    throw new AppError("VALIDATION_FAILED", "Type an answer to the question first.");
  }
  if (!kase.product_revision_id) {
    throw new AppError("VALIDATION_FAILED", "Add a product photo before planning.");
  }
  let procedure: ProcedureRevision | null = null;
  if (purpose === "solution") {
    procedure = latestProcedureFor(ctx.db, kase.id, kase.product_revision_id);
    if (!procedure) {
      throw new AppError(
        "VALIDATION_FAILED",
        "Add the approved procedure before planning a solution.",
      );
    }
    if (!procedure.modelApplicabilityConfirmed) {
      throw new AppError(
        "VALIDATION_FAILED",
        "Confirm that the procedure applies to this product model.",
      );
    }
  }

  const storedAccount = findMessageOfKind(ctx.db, kase.id, "problem", "account");
  const account = storedAccount ?? draftRow(kase, "problem", "account", kase.original_account);
  const storedTried = findMessageOfKind(ctx.db, kase.id, "problem", "actions_tried");
  const triedText = kase.actions_tried.trim();
  const actionsTried =
    storedTried ??
    (triedText ? draftRow(kase, "problem", "actions_tried", kase.actions_tried) : null);

  const text =
    input.correction?.trim() || (input.fieldEdits ? describeFieldEdits(input.fieldEdits) : "");
  const correction = text
    ? draftRow(kase, purpose, input.isClarificationAnswer ? "answer" : "correction", text)
    : null;
  if (purpose === "problem" && !account.text.trim()) {
    throw new AppError("VALIDATION_FAILED", "Describe what happened before planning.");
  }
  return {
    kase,
    purpose,
    parent,
    procedure,
    account,
    accountIsNew: !storedAccount,
    actionsTried,
    actionsTriedIsNew: !storedTried && actionsTried !== null,
    correction,
    olderCorrections: listUserCorrections(ctx.db, kase.id, purpose),
  };
}
