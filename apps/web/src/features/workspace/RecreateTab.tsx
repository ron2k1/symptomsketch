import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Eye, LoaderCircle } from "lucide-react";
import {
  APP_PATHS,
  LIMITS,
  PREVIEW_STATUS_COPY,
  REVIEW_ACTION_LABELS,
  UI_STATE_COPY,
  type PreviewStatus,
  type ReviewDecision,
  type Take,
} from "@symptomsketch/contracts";
import { ReactorMark } from "@/components/ReactorMark";
import { Button } from "@/components/ui/button";
import { formatTakeNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LiveStage } from "@/features/preview/LiveStage";
import { ReviewPanel } from "@/features/review/ReviewPanel";
import { ConversationPanel } from "./ConversationPanel";
import { ModeToggle } from "./ModeToggle";
import { ProcedureForm } from "./ProcedureForm";
import { PhotoPicker, ProductPanel } from "./ProductPanel";
import {
  currentPlan,
  isTheaterLayout,
  planById,
  previewablePlan,
  procedureFor,
  stageNextStep,
  takesFor,
  type StageStep,
} from "./state";
import { SendTakeButton } from "./SendTakeButton";
import { TakeShelf } from "./TakeShelf";
import { useWorkspace } from "./WorkspaceProvider";

/** Announced once per change; frame-level churn is never announced (spec 6). */
const ANNOUNCED_STATUSES: readonly PreviewStatus[] = [
  "connecting",
  "live",
  "armed",
  "recording",
  "uploading",
  "error",
];

function isReadyTake(take: Take | null): take is Take {
  return (
    take !== null &&
    take.captureStatus === "complete" &&
    take.processingState === "ready" &&
    take.mediaUrl !== null
  );
}

export function RecreateTab() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { state, dispatch, captureBusy, selectedTakeId, announce } = ws;
  const [shelfOpen, setShelfOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastStatus = useRef<PreviewStatus>(state.previewStatus);
  const caseData = state.caseData;
  if (!caseData) return null;

  const purpose = caseData.mode;
  const plan = currentPlan(caseData, purpose);
  const stagePlan = previewablePlan(caseData, purpose);
  const takes = takesFor(caseData, purpose);
  const selectedTake = takes.find((t) => t.id === selectedTakeId) ?? null;
  const readyTake = isReadyTake(selectedTake) ? selectedTake : null;
  const product = caseData.product;
  const planning = state.planning === purpose;
  const isSupportCase = caseData.ownerRole === "support";

  function onStatusChange(status: PreviewStatus) {
    dispatch({ type: "preview_status", status });
    if (status !== lastStatus.current && ANNOUNCED_STATUSES.includes(status)) {
      announce(PREVIEW_STATUS_COPY[status]);
    }
    lastStatus.current = status;
  }

  function onTakeUploaded(take: Take) {
    dispatch({ type: "take_upsert", take });
    ws.selectTake(take.id);
    announce(`${formatTakeNumber(take.number)} saved. ${UI_STATE_COPY.uploading.copy}.`);
  }

  function onNewTake() {
    ws.selectTake(null);
    dispatch({ type: "compare_original", on: false });
    requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.scrollIntoView({ block: "center", behavior: "smooth" });
      // Clip when it is enabled, otherwise the stage itself (it explains why not).
      const clip = stage.querySelector<HTMLButtonElement>(
        '[data-stage-action="clip"]:not(:disabled)',
      );
      (clip ?? stage).focus();
    });
  }

  async function onTryCorrection(text: string) {
    const ok = await ws.submitPlan(purpose, text.slice(0, LIMITS.composerMaxChars));
    if (ok) {
      ws.selectTake(null);
      announce("Description updated. Clip the live stage once it shows the change.");
    }
  }

  function onDecision(decision: ReviewDecision) {
    announce(`Review saved: ${REVIEW_ACTION_LABELS[purpose][decision]}`);
    if (decision === "refine") {
      ws.selectTake(null);
      requestAnimationFrame(() => document.getElementById("composer")?.focus());
    }
  }

  function onContinue() {
    if (isSupportCase && caseData?.sourceTicketId) {
      navigate(APP_PATHS.supportTicket(caseData.sourceTicketId));
    } else {
      ws.goTab("support");
    }
  }

  let badge: string;
  if (readyTake) badge = `Saved take / ${formatTakeNumber(readyTake.number)}`;
  else if (planning) badge = UI_STATE_COPY.planning.copy;
  else if (!product) badge = UI_STATE_COPY.empty.copy;
  else if (!stagePlan && state.previewStatus === "idle") badge = "Waiting for a ready description";
  else if (state.previewStatus === "idle") badge = "Preview is off";
  else badge = PREVIEW_STATUS_COPY[state.previewStatus];
  const live =
    !readyTake && (state.previewStatus === "live" || state.previewStatus === "recording");
  // Theater: while Reactor X2 is on stage (or a take is shown) the stage takes the width and the
  // product shelf folds into a compact chip above it (see workspace.css).
  const theater = isTheaterLayout(state.previewStatus, selectedTake !== null);

  const selectedPlan = selectedTake ? planById(caseData, selectedTake.planRevisionId) : null;
  const selectedOriginal = selectedTake
    ? (caseData.products.find((p) => p.id === selectedTake.productRevisionId)?.original ?? null)
    : null;

  return (
    <div className="ws-recreate" data-theater={theater ? "" : undefined}>
      <aside
        className={cn(
          "ws-area-product rounded-[var(--radius-card)] border border-border bg-card",
          theater ? "px-3 py-1.5" : "p-4",
        )}
      >
        <button
          type="button"
          className={cn(
            "flex min-h-11 w-full items-center gap-3 text-left",
            !theater && "min-[1180px]:hidden",
          )}
          aria-expanded={shelfOpen}
          aria-controls="product-shelf-body"
          onClick={() => setShelfOpen((o) => !o)}
        >
          {product ? (
            <img
              src={product.normalized.mediaUrl}
              alt=""
              className="size-10 shrink-0 rounded-lg object-cover"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{ws.productLabel}</span>
          {theater ? (
            <span className="hidden text-[12.5px] text-muted-foreground sm:inline">
              {shelfOpen ? "Hide product" : "Product details"}
            </span>
          ) : null}
          <ChevronDown
            className={cn("size-4 transition-transform", shelfOpen && "rotate-180")}
            aria-hidden
          />
        </button>
        <div
          id="product-shelf-body"
          className={cn(
            shelfOpen ? (theater ? "mt-3 mb-2 block" : "mt-4 block") : "hidden",
            !theater && "min-[1180px]:mt-0 min-[1180px]:block",
          )}
        >
          <ProductPanel purpose={purpose} showAccount procedure={procedureFor(caseData, plan)} />
        </div>
      </aside>

      <section aria-labelledby="stage-heading" className="ws-area-stage min-w-0 space-y-4">
        <ModeToggle
          mode={purpose}
          onChange={(mode) => void ws.setMode(mode)}
          disabled={captureBusy || state.planning !== null}
          solutionOnly={isSupportCase}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="stage-heading" className="text-xl font-semibold">
              Recreate the movement
            </h2>
            <ReactorMark size="sm" live={live} label="Reactor X2 world model" />
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[12px]",
                live ? "border-magenta/60 text-magenta" : "border-border text-muted-foreground",
              )}
            >
              {planning ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
              {live ? <span className="size-1.5 rounded-full bg-magenta" aria-hidden /> : null}
              {badge}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            aria-pressed={state.compareOriginal}
            disabled={!product}
            onClick={() => dispatch({ type: "compare_original", on: !state.compareOriginal })}
          >
            <Eye aria-hidden />
            {state.compareOriginal ? "Showing original" : "Compare original"}
          </Button>
        </div>

        <div ref={stageRef} tabIndex={-1} className="outline-none">
          {product ? (
            <LiveStage
              caseId={caseData.id}
              purpose={purpose}
              plan={stagePlan}
              referenceImageUrl={product.normalized.mediaUrl}
              productLabel={ws.productLabel}
              isGeneratedConcept={false}
              canRecord={stagePlan !== null && state.planning === null}
              onTakeUploaded={onTakeUploaded}
              onStatusChange={onStatusChange}
              selectedTake={readyTake}
              compareOriginal={state.compareOriginal}
              onExitTake={() => ws.selectTake(null)}
              onTakeUpdated={(take) => dispatch({ type: "take_upsert", take })}
            />
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
              <p>{UI_STATE_COPY.empty.copy}. Upload a photo of your product to begin.</p>
              <PhotoPicker primary />
            </div>
          )}
        </div>

        <StageHint />

        {selectedTake ? (
          <ReviewPanel
            take={selectedTake}
            plan={selectedPlan}
            original={selectedOriginal}
            onTakeUpdated={(take) => dispatch({ type: "take_upsert", take })}
            onClose={() => ws.selectTake(null)}
            onTryCorrection={(text) => void onTryCorrection(text)}
            correctionDisabled={captureBusy || state.planning !== null || plan === null}
            onDecision={onDecision}
            continueLabel={isSupportCase ? "Continue to the ticket" : "Continue to Support"}
            onContinue={onContinue}
            announce={announce}
          />
        ) : null}
      </section>

      <aside className="ws-area-conversation min-w-0 rounded-[var(--radius-card)] border border-border bg-card p-4">
        <ConversationPanel purpose={purpose} compact={theater} />
      </aside>

      <div className="ws-area-takes min-w-0">
        <TakeShelf
          takes={takes}
          selectedTakeId={selectedTakeId}
          onSelect={(id) => {
            ws.selectTake(id);
            dispatch({ type: "compare_original", on: false });
          }}
          onNewTake={onNewTake}
          disabled={captureBusy}
          renderAction={
            isSupportCase
              ? undefined
              : (take) => (
                  <SendTakeButton
                    caseId={caseData.id}
                    take={take}
                    sent={caseData.tickets.some(
                      (t) => t.takeId === take.id && t.status !== "revoked",
                    )}
                  />
                )
          }
        />
      </div>
    </div>
  );
}

/** Next step when the current purpose has no previewable plan yet, offered right on Recreate. */
function StageHint() {
  const ws = useWorkspace();
  const caseData = ws.state.caseData;
  if (!caseData) return null;
  const purpose = caseData.mode;
  const step = stageNextStep(caseData, purpose);
  if (!step || ws.state.planning === purpose) return null;

  if (step === "procedure") {
    return (
      <section
        aria-labelledby="stage-procedure-heading"
        className="space-y-4 rounded-xl border border-border p-4"
      >
        <div className="space-y-1">
          <h3 id="stage-procedure-heading" className="text-base font-semibold">
            Add the approved procedure
          </h3>
          <p className="text-sm text-muted-foreground">
            The solution follows only the approved steps saved here.
          </p>
        </div>
        <ProcedureForm />
      </section>
    );
  }

  // The Describe and refine box takes the description, the answer and corrections in place.
  const focusComposer = () => document.getElementById("composer")?.focus();
  const replan = () => void ws.submitPlan(purpose, null);
  const hint = {
    describe: ["Describe what happened to plan the movement.", "Describe it here", focusComposer],
    plan: ["Ready to plan the movement from your description.", "Create the action plan", replan],
    answer: [
      "Answer the planner's question to start the preview.",
      "Answer the question",
      focusComposer,
    ],
    refine: ["This description cannot be previewed yet.", "Refine the description", focusComposer],
    replan: ["The product photo changed since this plan.", "Plan for the new photo", replan],
  } as const satisfies Record<
    Exclude<StageStep, "procedure">,
    readonly [string, string, () => void]
  >;
  const [text, action, run] = hint[step];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
      <span>{text}</span>
      <Button
        type="button"
        className="min-h-11"
        disabled={ws.state.planning !== null}
        data-stage-step={step}
        onClick={run}
      >
        {action}
      </Button>
    </div>
  );
}
