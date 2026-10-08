import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  APP_PATHS,
  type CaseDetail,
  type CaseTab,
  type CatalogProduct,
  type PatchCaseRequest,
  type PlanFieldEdits,
  type Purpose,
} from "@symptomsketch/contracts";
import { errorMessage, getCase, createPlan, isApiClientError, patchCase } from "@/lib/api";
import { newClientRequestId } from "@/lib/ids";
import {
  currentPlanId,
  initialWorkspaceState,
  isAccountLocked,
  isCaptureBusy,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "./state";
import { useCatalogProduct } from "./useCatalogProduct";

export interface SubmitPlanOptions {
  /** The text came from the composer: reuse its client request id and clear it on success. */
  fromComposer?: boolean;
  isClarificationAnswer?: boolean;
  /** Current description edits (needs an existing plan; correction may be null). */
  fieldEdits?: PlanFieldEdits;
}

export interface WorkspaceApi {
  caseId: string;
  tab: CaseTab;
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  catalogProduct: CatalogProduct | null;
  productName: string;
  modelLabel: string | null;
  /** Name plus model, used for the stage label. */
  productLabel: string;
  selectedTakeId: string | null;
  /** True while a take is armed, recording or uploading. */
  captureBusy: boolean;
  liveMessage: { text: string; n: number };
  selectTake(id: string | null): void;
  goTab(tab: CaseTab): void;
  reload(): Promise<CaseDetail | null>;
  announce(text: string): void;
  /** Saves Issue drafts that differ from the case. Returns an error message or null. */
  saveIssueDraft(): Promise<string | null>;
  submitPlan(
    purpose: Purpose,
    correction: string | null,
    opts?: SubmitPlanOptions,
  ): Promise<boolean>;
  setMode(purpose: Purpose): Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

/** Case data and drafts live here, above the tab panels, so tab switches never lose input. */
export function WorkspaceProvider({
  caseId,
  tab,
  children,
}: {
  caseId: string;
  tab: CaseTab;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  const planInFlight = useRef(false);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [liveMessage, setLiveMessage] = useState({ text: "", n: 0 });
  const catalogProduct = useCatalogProduct(state.caseData?.fixtureId);

  useEffect(() => {
    const controller = new AbortController();
    getCase(caseId, { signal: controller.signal })
      .then((res) => dispatch({ type: "case_loaded", caseData: res.case }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: "load_failed",
          error: {
            code: isApiClientError(err) ? err.code : "INTERNAL_ERROR",
            message: errorMessage(err),
          },
        });
      });
    return () => controller.abort();
  }, [caseId]);

  const announce = useCallback((text: string) => {
    setLiveMessage((prev) => ({ text, n: prev.n + 1 }));
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await getCase(caseId);
      dispatch({ type: "case_loaded", caseData: res.case });
      return res.case;
    } catch {
      return null;
    }
  }, [caseId]);

  const selectedParam = params.get("take");
  const selectedTakeId =
    selectedParam && state.caseData?.takes.some((t) => t.id === selectedParam)
      ? selectedParam
      : null;

  const selectTake = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("take", id);
          else next.delete("take");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const goTab = useCallback(
    (next: CaseTab) => {
      const search = params.toString();
      navigate({ pathname: APP_PATHS.caseTab(caseId, next), search: search ? `?${search}` : "" });
    },
    [caseId, navigate, params],
  );

  const saveIssueDraft = useCallback(async (): Promise<string | null> => {
    const { caseData, issue } = stateRef.current;
    if (!caseData || !issue) return null;
    const patch: PatchCaseRequest = {};
    const model = issue.modelLabel.trim();
    if (model !== (caseData.modelLabel ?? "")) patch.modelLabel = model || null;
    if (!isAccountLocked(caseData)) {
      if (issue.originalAccount !== caseData.originalAccount) {
        patch.originalAccount = issue.originalAccount;
      }
      if (issue.actionsTried !== caseData.actionsTried) patch.actionsTried = issue.actionsTried;
    }
    if (Object.keys(patch).length === 0) return null;
    try {
      const res = await patchCase(caseId, patch);
      dispatch({ type: "case_loaded", caseData: res.case });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }, [caseId]);

  const submitPlan = useCallback(
    async (purpose: Purpose, correction: string | null, opts: SubmitPlanOptions = {}) => {
      const { caseData, composer } = stateRef.current;
      if (!caseData || planInFlight.current) return false;
      planInFlight.current = true;
      let clientRequestId = newClientRequestId();
      if (opts.fromComposer) {
        clientRequestId = composer[purpose].clientRequestId ?? clientRequestId;
        dispatch({ type: "composer_request_id", purpose, clientRequestId });
      }
      dispatch({ type: "planning", purpose });
      dispatch({ type: "plan_error", message: null });
      announce("Understanding the action");
      try {
        const result = await createPlan(caseId, {
          purpose,
          parentPlanId: currentPlanId(caseData, purpose),
          correction,
          isClarificationAnswer: opts.isClarificationAnswer ?? false,
          ...(opts.fieldEdits ? { fieldEdits: opts.fieldEdits } : {}),
          clientRequestId,
        });
        dispatch({ type: "plan_created", result });
        if (opts.fromComposer && correction) {
          dispatch({ type: "composer_clear", purpose, sentText: correction });
        }
        announce(
          result.clarificationQuestion
            ? `Description updated. One question: ${result.clarificationQuestion}`
            : "Description updated",
        );
        void reload();
        return true;
      } catch (err) {
        if (isApiClientError(err) && err.code === "PLAN_CONFLICT") void reload();
        const message = errorMessage(err);
        dispatch({ type: "plan_error", message });
        announce(message);
        return false;
      } finally {
        planInFlight.current = false;
        dispatch({ type: "planning", purpose: null });
      }
    },
    [announce, caseId, reload],
  );

  const setMode = useCallback(
    async (purpose: Purpose) => {
      const { caseData } = stateRef.current;
      if (!caseData || caseData.mode === purpose) return;
      try {
        const res = await patchCase(caseId, { mode: purpose });
        dispatch({ type: "case_loaded", caseData: res.case });
        dispatch({ type: "compare_original", on: false });
        const selected = res.case.takes.find((t) => t.id === params.get("take"));
        if (selected && selected.purpose !== purpose) selectTake(null);
        announce(purpose === "problem" ? "Show the problem" : "Show the solution");
      } catch (err) {
        announce(errorMessage(err));
        dispatch({ type: "plan_error", message: errorMessage(err) });
      }
    },
    [announce, caseId, params, selectTake],
  );

  const caseData = state.caseData;
  const productName = catalogProduct?.name ?? caseData?.title ?? "Your product";
  const rawModel = (caseData?.modelLabel || caseData?.product?.modelLabel || "").trim();
  // A model label that only repeats the product name adds nothing ("Robot vacuum / Robot vacuum").
  const modelLabel =
    rawModel && rawModel.toLowerCase() !== productName.toLowerCase() ? rawModel : null;
  const productLabel = modelLabel ? `${productName} (${modelLabel})` : productName;

  const value = useMemo<WorkspaceApi>(
    () => ({
      caseId,
      tab,
      state,
      dispatch,
      catalogProduct,
      productName,
      modelLabel,
      productLabel,
      selectedTakeId,
      captureBusy: isCaptureBusy(state.previewStatus),
      liveMessage,
      selectTake,
      goTab,
      reload,
      announce,
      saveIssueDraft,
      submitPlan,
      setMode,
    }),
    [
      caseId,
      tab,
      state,
      catalogProduct,
      productName,
      modelLabel,
      productLabel,
      selectedTakeId,
      liveMessage,
      selectTake,
      goTab,
      reload,
      announce,
      saveIssueDraft,
      submitPlan,
      setMode,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
