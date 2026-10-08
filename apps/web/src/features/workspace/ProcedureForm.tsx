import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { LIMITS } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createProcedure, errorMessage, patchCase } from "@/lib/api";
import { procedureForPhoto } from "./state";
import { useWorkspace } from "./WorkspaceProvider";

/**
 * Solution mode source (spec 3): product/model label, procedure title, approved step text,
 * source description and model-applicability confirmation -> POST procedures, then the plan.
 * Demo cases start from the catalog's authored demo procedure draft.
 */
export function ProcedureForm() {
  const ws = useWorkspace();
  const { state, dispatch, catalogProduct, caseId } = ws;
  const caseData = state.caseData;
  const draft = state.procedure;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);

  useEffect(() => {
    if (!caseData || draft) return;
    const fixture = catalogProduct?.procedure ?? null;
    if (caseData.fixtureId && !catalogProduct) return; // wait for the demo procedure draft
    dispatch({
      type: "procedure_draft",
      patch: {
        modelLabel:
          caseData.modelLabel ?? caseData.product?.modelLabel ?? catalogProduct?.name ?? "",
        title: fixture?.title ?? "",
        procedureCode: fixture?.procedureId ?? null,
        approvedText: fixture ? fixture.steps.join("\n") : "",
        sourceDescription: fixture?.source ?? "",
        confirmed: false,
        fixtureProcedureId: fixture?.procedureId ?? null,
      },
    });
  }, [caseData, draft, catalogProduct, dispatch]);

  if (!caseData) return null;
  // The planner pairs a solution with a procedure saved for the current photo only.
  const existing = procedureForPhoto(caseData);
  const hasSolutionPlan = caseData.solutionPlanId !== null;
  const planning = state.planning === "solution";

  function createSolutionPlan() {
    void ws.submitPlan("solution", null);
    // Recreate renders this form under the stage too; stay put there.
    if (ws.tab !== "recreate") ws.goTab("recreate");
  }

  if (existing && !revising) {
    return (
      <div className="space-y-3 text-sm">
        <p>
          Procedure saved: <span className="font-medium">{existing.title}</span>
        </p>
        {hasSolutionPlan ? (
          <Button type="button" className="min-h-11" onClick={() => ws.goTab("recreate")}>
            Continue to Recreate
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={planning}
              onClick={createSolutionPlan}
            >
              {planning ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {planning ? "Understanding the action" : "Create the solution plan"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={planning}
              onClick={() => setRevising(true)}
            >
              Revise procedure
            </Button>
          </div>
        )}
        {state.planError ? <p className="text-destructive">{state.planError}</p> : null}
      </div>
    );
  }
  if (!draft) return <p className="text-sm text-muted-foreground">Loading the procedure draft.</p>;

  function set(patch: Partial<NonNullable<typeof draft>>) {
    dispatch({ type: "procedure_draft", patch });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft || !caseData) return;
    setError(null);
    if (!draft.modelLabel.trim() || !draft.title.trim() || !draft.approvedText.trim()) {
      setError("Add the product/model label, the procedure title and the approved step text.");
      return;
    }
    if (!draft.sourceDescription.trim()) {
      setError("Describe where the approved text comes from.");
      return;
    }
    setBusy(true);
    try {
      const model = draft.modelLabel.trim();
      if (model !== (caseData.modelLabel ?? "")) await patchCase(caseId, { modelLabel: model });
      const steps = draft.approvedText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      await createProcedure(caseId, {
        title: draft.title.trim(),
        procedureCode: draft.procedureCode,
        approvedText: draft.approvedText.trim(),
        steps: steps.length > 0 ? steps.slice(0, 30) : undefined,
        sourceDescription: draft.sourceDescription.trim(),
        modelApplicabilityConfirmed: draft.confirmed,
        fixtureProcedureId: draft.fixtureProcedureId,
      });
      await ws.reload();
      ws.announce("Procedure saved");
      setBusy(false);
      setRevising(false);
      createSolutionPlan();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const fixtureText = catalogProduct?.procedure.steps.join("\n") ?? null;
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="proc-model">Product / model</Label>
        <Input
          id="proc-model"
          value={draft.modelLabel}
          maxLength={LIMITS.modelLabelMaxChars}
          onChange={(e) => set({ modelLabel: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="proc-title">Procedure title</Label>
        <Input
          id="proc-title"
          value={draft.title}
          maxLength={LIMITS.procedureTitleMaxChars}
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="proc-text">Approved step text</Label>
        <Textarea
          id="proc-text"
          rows={6}
          value={draft.approvedText}
          maxLength={LIMITS.procedureTextMaxChars}
          onChange={(e) =>
            set({
              approvedText: e.target.value,
              fixtureProcedureId:
                fixtureText !== null && e.target.value === fixtureText
                  ? (catalogProduct?.procedure.procedureId ?? null)
                  : null,
            })
          }
        />
        <p className="text-[12px] text-muted-foreground">One step per line.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="proc-source">Source description</Label>
        <Input
          id="proc-source"
          value={draft.sourceDescription}
          maxLength={LIMITS.sourceDescriptionMaxChars}
          placeholder="Company procedure id, manual title with page and step, or authored demo"
          onChange={(e) => set({ sourceDescription: e.target.value })}
        />
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--neon)]"
          checked={draft.confirmed}
          onChange={(e) => set({ confirmed: e.target.checked })}
        />
        <span>
          This source applies to {draft.modelLabel.trim() || "this product/model"}.
          <span className="block text-[12px] text-muted-foreground">
            Without this confirmation the plan asks about applicability before generating.
          </span>
        </span>
      </label>
      {error || state.planError ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? state.planError}
        </p>
      ) : null}
      <Button type="submit" className="min-h-11" disabled={busy || planning}>
        {busy || planning ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
        {planning ? "Understanding the action" : busy ? "Saving procedure" : "Save and continue"}
      </Button>
    </form>
  );
}
