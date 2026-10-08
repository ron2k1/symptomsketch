import type {
  CaseDetail,
  CaseTab,
  Message,
  PlanRevision,
  PlannerResult,
  PreviewStatus,
  ProcedureRevision,
  Purpose,
  Take,
} from "@symptomsketch/contracts";
import { CASE_TABS } from "@symptomsketch/contracts";

/* ------------------------------------------------------------------ drafts */

export interface IssueDraft {
  originalAccount: string;
  actionsTried: string;
  modelLabel: string;
}

export interface ProcedureDraft {
  modelLabel: string;
  title: string;
  procedureCode: string | null;
  approvedText: string;
  sourceDescription: string;
  confirmed: boolean;
  /** Set while the text still equals the catalog fixture's authored procedure. */
  fixtureProcedureId: string | null;
}

export interface ComposerDraft {
  text: string;
  /** Reused when the same text is resubmitted after a failure (no duplicate paid call). */
  clientRequestId: string | null;
}

export interface LoadError {
  code: string;
  message: string;
}

export interface WorkspaceState {
  caseData: CaseDetail | null;
  loadError: LoadError | null;
  issue: IssueDraft | null;
  procedure: ProcedureDraft | null;
  composer: Record<Purpose, ComposerDraft>;
  previewStatus: PreviewStatus;
  compareOriginal: boolean;
  /** Purpose with a planner request in flight. */
  planning: Purpose | null;
  planError: string | null;
}

export const initialWorkspaceState: WorkspaceState = {
  caseData: null,
  loadError: null,
  issue: null,
  procedure: null,
  composer: {
    problem: { text: "", clientRequestId: null },
    solution: { text: "", clientRequestId: null },
  },
  previewStatus: "idle",
  compareOriginal: false,
  planning: null,
  planError: null,
};

export type WorkspaceAction =
  | { type: "case_loaded"; caseData: CaseDetail }
  | { type: "load_failed"; error: LoadError }
  | { type: "issue_draft"; patch: Partial<IssueDraft> }
  | { type: "procedure_draft"; patch: Partial<ProcedureDraft> }
  | { type: "composer_text"; purpose: Purpose; text: string }
  | { type: "composer_request_id"; purpose: Purpose; clientRequestId: string }
  /** Clears the composer only if it still holds the text that was just sent. */
  | { type: "composer_clear"; purpose: Purpose; sentText: string }
  | { type: "preview_status"; status: PreviewStatus }
  | { type: "compare_original"; on: boolean }
  | { type: "planning"; purpose: Purpose | null }
  | { type: "plan_error"; message: string | null }
  | { type: "plan_created"; result: PlannerResult }
  | { type: "take_upsert"; take: Take };

/* ----------------------------------------------------------------- reducer */

function newer<T extends { updatedAt: string }>(a: T, b: T): T {
  return Date.parse(b.updatedAt) >= Date.parse(a.updatedAt) ? b : a;
}

/** A refetched case must not roll back a take the poller already saw in a later state. */
function mergeTakes(previous: readonly Take[], incoming: readonly Take[]): Take[] {
  const byId = new Map(previous.map((t) => [t.id, t]));
  const merged = incoming.map((t) => {
    const old = byId.get(t.id);
    return old ? newer(old, t) : t;
  });
  for (const t of previous) {
    if (!merged.some((m) => m.id === t.id)) merged.push(t);
  }
  return merged.sort((a, b) => a.number - b.number);
}

function upsertById<T extends { id: string }>(list: readonly T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

function seedIssue(c: CaseDetail): IssueDraft {
  return {
    originalAccount: c.originalAccount,
    actionsTried: c.actionsTried,
    modelLabel: c.modelLabel ?? c.product?.modelLabel ?? "",
  };
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "case_loaded": {
      const prev = state.caseData;
      const caseData =
        prev && prev.id === action.caseData.id
          ? { ...action.caseData, takes: mergeTakes(prev.takes, action.caseData.takes) }
          : action.caseData;
      return {
        ...state,
        caseData,
        loadError: null,
        issue: state.issue ?? seedIssue(action.caseData),
      };
    }
    case "load_failed":
      return { ...state, loadError: action.error };
    case "issue_draft":
      return state.issue ? { ...state, issue: { ...state.issue, ...action.patch } } : state;
    case "procedure_draft": {
      const base: ProcedureDraft = state.procedure ?? {
        modelLabel: "",
        title: "",
        procedureCode: null,
        approvedText: "",
        sourceDescription: "",
        confirmed: false,
        fixtureProcedureId: null,
      };
      return { ...state, procedure: { ...base, ...action.patch } };
    }
    case "composer_text": {
      const current = state.composer[action.purpose];
      const clientRequestId = current.text === action.text ? current.clientRequestId : null;
      return {
        ...state,
        composer: { ...state.composer, [action.purpose]: { text: action.text, clientRequestId } },
      };
    }
    case "composer_request_id":
      return {
        ...state,
        composer: {
          ...state.composer,
          [action.purpose]: {
            ...state.composer[action.purpose],
            clientRequestId: action.clientRequestId,
          },
        },
      };
    case "composer_clear":
      if (state.composer[action.purpose].text.trim() !== action.sentText.trim()) return state;
      return {
        ...state,
        composer: { ...state.composer, [action.purpose]: { text: "", clientRequestId: null } },
      };
    case "preview_status":
      return state.previewStatus === action.status
        ? state
        : { ...state, previewStatus: action.status };
    case "compare_original":
      return { ...state, compareOriginal: action.on };
    case "planning":
      return { ...state, planning: action.purpose };
    case "plan_error":
      return { ...state, planError: action.message };
    case "plan_created": {
      const c = state.caseData;
      if (!c) return state;
      const plan = action.result.planRevision;
      let messages: Message[] = c.messages;
      for (const m of action.result.messages) messages = upsertById(messages, m);
      return {
        ...state,
        planError: null,
        caseData: {
          ...c,
          plans: upsertById(c.plans, plan),
          messages,
          problemPlanId: plan.purpose === "problem" ? plan.id : c.problemPlanId,
          solutionPlanId: plan.purpose === "solution" ? plan.id : c.solutionPlanId,
        },
      };
    }
    case "take_upsert": {
      const c = state.caseData;
      if (!c) return state;
      const old = c.takes.find((t) => t.id === action.take.id);
      const take = old ? newer(old, action.take) : action.take;
      return {
        ...state,
        caseData: { ...c, takes: upsertById(c.takes, take).sort((a, b) => a.number - b.number) },
      };
    }
  }
}

/* --------------------------------------------------------------- selectors */

export function isCaseTab(tab: string | undefined): tab is CaseTab {
  return (CASE_TABS as readonly string[]).includes(tab ?? "");
}

/** While armed/recording/uploading, tabs, mode and corrections are locked (spec 6, 12). */
export function isCaptureBusy(status: PreviewStatus): boolean {
  return status === "armed" || status === "recording" || status === "uploading";
}

/**
 * Theater layout: the Reactor stage takes the width while a session is starting, live, recording
 * or failed on stage, and while a take (ready or still processing) is selected. Only a stopped
 * preview with no take returns to the three-column layout.
 */
export function isTheaterLayout(status: PreviewStatus, takeSelected: boolean): boolean {
  return takeSelected || status !== "idle";
}

export function currentPlanId(c: CaseDetail, purpose: Purpose): string | null {
  return purpose === "problem" ? c.problemPlanId : c.solutionPlanId;
}

export function currentPlan(c: CaseDetail, purpose: Purpose): PlanRevision | null {
  const id = currentPlanId(c, purpose);
  return id ? (c.plans.find((p) => p.id === id) ?? null) : null;
}

export function planById(c: CaseDetail, id: string | null): PlanRevision | null {
  return id ? (c.plans.find((p) => p.id === id) ?? null) : null;
}

/** The plan LiveStage may drive: ready and bound to the current product reference. */
export function previewablePlan(c: CaseDetail, purpose: Purpose): PlanRevision | null {
  const plan = currentPlan(c, purpose);
  if (!plan || plan.status !== "ready" || !plan.reactorPrompt) return null;
  if (c.productRevisionId && plan.productRevisionId !== c.productRevisionId) return null;
  return plan;
}

export function messagesFor(c: CaseDetail, purpose: Purpose): Message[] {
  return c.messages
    .filter((m) => m.purpose === purpose)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function takesFor(c: CaseDetail, purpose: Purpose): Take[] {
  return c.takes.filter((t) => t.purpose === purpose).sort((a, b) => a.number - b.number);
}

/** The original account is immutable once the first problem plan exists (spec 3, 6). */
export function isAccountLocked(c: CaseDetail): boolean {
  return c.problemPlanId !== null || c.plans.some((p) => p.purpose === "problem");
}

export function procedureFor(c: CaseDetail, plan: PlanRevision | null): ProcedureRevision | null {
  if (plan?.procedureRevisionId) {
    const exact = c.procedures.find((p) => p.id === plan.procedureRevisionId);
    if (exact) return exact;
  }
  return c.procedures.length > 0 ? (c.procedures[c.procedures.length - 1] ?? null) : null;
}
