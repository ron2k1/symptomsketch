import { useState } from "react";
import { Lock, LoaderCircle } from "lucide-react";
import { LIMITS, PURPOSE_MODE_LABELS } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProcedureForm } from "./ProcedureForm";
import { ProductPanel } from "./ProductPanel";
import { currentPlan, isAccountLocked, procedureFor } from "./state";
import { useWorkspace } from "./WorkspaceProvider";

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span className="font-mono text-[12px] text-muted-foreground">
      {value.length}/{max}
    </span>
  );
}

/** Issue tab: reference + original account (spec 4 steps 3-5) or the solution procedure. */
export function IssueTab() {
  const ws = useWorkspace();
  const { state, dispatch } = ws;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const caseData = state.caseData;
  const issue = state.issue;
  if (!caseData || !issue) return null;

  const locked = isAccountLocked(caseData);
  const planning = state.planning === "problem";
  const isCustomerCase = caseData.ownerRole === "customer";
  const showProcedure = caseData.mode === "solution" || !isCustomerCase;
  const procedure = procedureFor(caseData, currentPlan(caseData, "solution"));

  async function saveDraft() {
    const message = await ws.saveIssueDraft();
    if (message) setError(message);
  }

  async function onContinue() {
    if (!caseData || !issue) return;
    setError(null);
    if (locked) {
      ws.goTab("recreate");
      return;
    }
    if (!caseData.product) {
      setError("Add a product photo first.");
      return;
    }
    if (!issue.originalAccount.trim()) {
      setError("Describe what happened first.");
      return;
    }
    setSaving(true);
    const message = await ws.saveIssueDraft();
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    void ws.submitPlan("problem", null);
    ws.goTab("recreate");
  }

  return (
    <div className="grid gap-5 min-[1180px]:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="rounded-[var(--radius-card)] border border-border bg-card p-4">
        <ProductPanel purpose={caseData.mode} showAccount={false} procedure={procedure} />
      </aside>

      <div className="min-w-0 space-y-5">
        {isCustomerCase ? (
          <section
            aria-labelledby="issue-heading"
            className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card p-4 md:p-6"
          >
            <div className="space-y-1">
              <h2 id="issue-heading" className="text-xl font-semibold">
                What happened
              </h2>
              <p className="text-sm text-muted-foreground">
                Your own words are kept exactly as written. Details like timing and repetition can
                be clarified in Recreate.
              </p>
            </div>

            {locked ? (
              <p className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-muted-foreground">
                <Lock className="size-4 shrink-0" aria-hidden />
                Locked after the first plan so the original wording stays intact. Correct details in
                Recreate.
              </p>
            ) : null}

            <div className="space-y-1.5">
              <div className="flex items-end justify-between gap-2">
                <Label htmlFor="issue-account">What happened</Label>
                <Counter value={issue.originalAccount} max={LIMITS.accountMaxChars} />
              </div>
              <Textarea
                id="issue-account"
                rows={4}
                value={issue.originalAccount}
                readOnly={locked}
                disabled={planning}
                maxLength={LIMITS.accountMaxChars}
                placeholder="For example: it stops, then jerks backward once. Only sometimes."
                onChange={(e) =>
                  dispatch({ type: "issue_draft", patch: { originalAccount: e.target.value } })
                }
                onBlur={saveDraft}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-end justify-between gap-2">
                <Label htmlFor="issue-tried">What I tried</Label>
                <Counter value={issue.actionsTried} max={LIMITS.actionsTriedMaxChars} />
              </div>
              <Textarea
                id="issue-tried"
                rows={3}
                value={issue.actionsTried}
                readOnly={locked}
                disabled={planning}
                maxLength={LIMITS.actionsTriedMaxChars}
                placeholder="For example: cleaned the wheels and restarted it."
                onChange={(e) =>
                  dispatch({ type: "issue_draft", patch: { actionsTried: e.target.value } })
                }
                onBlur={saveDraft}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="issue-model">
                Product / model <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="issue-model"
                value={issue.modelLabel}
                maxLength={LIMITS.modelLabelMaxChars}
                placeholder="As printed on the product or box"
                onChange={(e) =>
                  dispatch({ type: "issue_draft", patch: { modelLabel: e.target.value } })
                }
                onBlur={saveDraft}
              />
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            {caseData.mode === "problem" || locked ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={saving || planning}
                onClick={onContinue}
              >
                {saving || planning ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {planning ? "Understanding the action" : "Continue to Recreate"}
              </Button>
            ) : null}
          </section>
        ) : null}

        {showProcedure ? (
          <section
            aria-labelledby="procedure-heading"
            className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card p-4 md:p-6"
          >
            <div className="space-y-1">
              <h2 id="procedure-heading" className="text-xl font-semibold">
                {PURPOSE_MODE_LABELS.solution}: approved procedure
              </h2>
              <p className="text-sm text-muted-foreground">
                The illustration follows only the approved text you supply here.
              </p>
            </div>
            <ProcedureForm />
          </section>
        ) : null}
      </div>
    </div>
  );
}
