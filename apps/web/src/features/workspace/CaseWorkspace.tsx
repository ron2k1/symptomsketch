import { useEffect, useRef } from "react";
import { Navigate, useParams } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import {
  APP_PATHS,
  ASSESSMENT_LABELS,
  CASE_TAB_LABELS,
  takeShelfLabel,
  type Take,
} from "@symptomsketch/contracts";
import { CaseLoadError } from "@/components/CaseLoadError";
import { useDocumentTitle } from "@/lib/document-title";
import { formatTakeNumber } from "@/lib/format";
import { CustomerSupportTab } from "@/features/support/CustomerSupportTab";
import { useTakePolling } from "@/features/review/useTakePolling";
import { IssueTab } from "./IssueTab";
import { RecreateTab } from "./RecreateTab";
import { isCaseTab } from "./state";
import { WorkspaceHeader, panelId, tabId } from "./WorkspaceHeader";
import { useWorkspace, WorkspaceProvider } from "./WorkspaceProvider";
import "./workspace.css";

/**
 * Route "/cases/:caseId/:tab" (issue | recreate | support). Case data, drafts and the selected
 * take (?take=) live in WorkspaceProvider above the tab panels; refresh restores from
 * GET /api/cases/:id and deep links work.
 */
export function CaseWorkspace() {
  const { caseId, tab } = useParams();
  if (!caseId) return <Navigate to={APP_PATHS.landing()} replace />;
  if (!isCaseTab(tab)) return <Navigate to={APP_PATHS.caseTab(caseId, "issue")} replace />;
  return (
    <WorkspaceProvider key={caseId} caseId={caseId} tab={tab}>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}

/** Polls processing / checking takes from above the tabs and announces meaningful changes. */
function TakePoller() {
  const { state, dispatch, announce } = useWorkspace();
  const takes = state.caseData?.takes ?? [];
  const known = useRef(new Map<string, Take>());
  useEffect(() => {
    known.current = new Map(takes.map((t) => [t.id, t]));
  }, [takes]);

  useTakePolling(takes, (take) => {
    const prev = known.current.get(take.id);
    dispatch({ type: "take_upsert", take });
    if (!prev) return;
    const parts: string[] = [];
    const label = takeShelfLabel(take);
    if (takeShelfLabel(prev) !== label) parts.push(label);
    const check = take.currentAssessment?.uiStatus;
    if (check && check !== prev.currentAssessment?.uiStatus) parts.push(ASSESSMENT_LABELS[check]);
    if (parts.length > 0) announce(`${formatTakeNumber(take.number)}: ${parts.join(". ")}`);
  });
  return null;
}

function WorkspaceShell() {
  const ws = useWorkspace();
  const { state, tab, dispatch, liveMessage } = ws;
  const caseData = state.caseData;

  useEffect(() => {
    // LiveStage unmounts outside Recreate, which stops live playback; reset the mirrored status.
    if (tab !== "recreate" && state.previewStatus !== "idle") {
      dispatch({ type: "preview_status", status: "idle" });
    }
  }, [tab, state.previewStatus, dispatch]);

  useDocumentTitle(
    ...(state.loadError
      ? ["Case unavailable"]
      : caseData
        ? [CASE_TAB_LABELS[tab], ws.productName]
        : ["Opening case"]),
  );

  return (
    <div className="cyber-grid min-h-screen overflow-x-clip">
      <WorkspaceHeader />
      <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-6">
        {state.loadError ? (
          <CaseLoadError code={state.loadError.code} message={state.loadError.message} />
        ) : !caseData ? (
          <p className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Opening your case
          </p>
        ) : (
          <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
            {tab === "issue" ? <IssueTab /> : null}
            {tab === "recreate" ? <RecreateTab /> : null}
            {tab === "support" ? (
              <CustomerSupportTab
                caseId={caseData.id}
                caseData={caseData}
                selectedTakeId={ws.selectedTakeId}
                onSelectTake={(id) => ws.selectTake(id)}
                onTicketCreated={() => void ws.reload()}
              />
            ) : null}
          </div>
        )}
      </main>
      {caseData ? <TakePoller /> : null}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        <span key={liveMessage.n}>{liveMessage.text}</span>
      </div>
    </div>
  );
}
