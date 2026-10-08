import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ActionPlan,
  ASSESSMENT_LABELS,
  CatalogFixtureFile,
  PURPOSE_LABELS,
  type TakeMessageResponse,
  takeFilename,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { fromJson, getRow } from "../db/index.ts";
import { type CaseRow, type CheckState, checkState, currentAssessmentBinding } from "./takes.ts";
import type { TakeRow } from "./takes.ts";

/**
 * Explanation message for an external email (spec 13). Built only from the selected take's frozen
 * plan, product/procedure revisions, visual-check binding and latest review: never from the latest
 * unrelated conversation. States what the clip is (an AI-generated reenactment / instructional
 * illustration) and never claims a diagnosis or that the customer recorded the real fault.
 */

/** Short, filename-safe case label: first 6 alphanumerics of the opaque id's random part. */
export function caseShortLabel(caseId: string): string {
  const random = caseId.includes("_") ? caseId.slice(caseId.indexOf("_") + 1) : caseId;
  const short = random
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase()
    .slice(0, 6);
  return short || "case";
}

/** symptomsketch-case-<short>-take-<NN>.mp4 (download route + copied message use the same name). */
export function takeDownloadFilename(take: Pick<TakeRow, "case_id" | "number">): string {
  return takeFilename(caseShortLabel(take.case_id), take.number);
}

let catalogNames: Map<string, string> | null = null;

function fixtureName(ctx: AppContext, fixtureId: string | null): string | null {
  if (!fixtureId) return null;
  if (!catalogNames) {
    catalogNames = new Map();
    try {
      const raw = readFileSync(path.join(ctx.config.demoAssetsDir, "catalog.json"), "utf8");
      const parsed = CatalogFixtureFile.safeParse(JSON.parse(raw));
      if (parsed.success) for (const f of parsed.data.fixtures) catalogNames.set(f.id, f.name);
    } catch {
      // Missing catalog: fall back to the model label / generic wording.
    }
  }
  return catalogNames.get(fixtureId) ?? null;
}

interface ProductRow {
  model_label: string | null;
  fixture_id: string | null;
  source_type: string;
}

interface ProcedureRow {
  title: string;
  procedure_code: string | null;
  source_description: string;
}

interface PlanRow {
  plan_json: string;
  caption: string;
}

const CHECK_EXPLANATION: Record<CheckState, string> = {
  pending: "the automated comparison was still running when this message was prepared",
  matches:
    "an automated comparison found the clip consistent with the description; it is not proof of what the product does",
  needs_revision: "an automated comparison found a visible difference from the description",
  uncertain: "an automated comparison could not confirm every detail from the video",
  unavailable:
    "the automated comparison did not complete, so the clip was not checked automatically",
};

const one = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function productLabel(ctx: AppContext, kase: CaseRow, product: ProductRow | undefined): string {
  const label = one(product?.model_label) || one(kase.model_label);
  const fixture = fixtureName(ctx, product?.fixture_id ?? kase.fixture_id);
  if (label && fixture && label !== fixture) return `${label} (${fixture} demo reference)`;
  if (label) return label;
  if (fixture) return `${fixture} (demo reference product)`;
  return "Product model not confirmed";
}

function actionLines(plan: ActionPlan): string[] {
  const a = plan.selectedAction;
  const lines = [
    ["Starting state", a.startingState],
    ["Action", a.action],
    ["Direction", a.direction],
    ["How many times", a.repetitions === null ? null : String(a.repetitions)],
    ["Timing", a.timing],
    ["Size of the movement", a.magnitude],
    ["Ending state", a.endingState],
  ] as const;
  return lines.filter(([, v]) => one(v) !== "").map(([k, v]) => `- ${k}: ${one(v)}`);
}

export function composeTakeMessage(
  ctx: AppContext,
  take: TakeRow,
  kase: CaseRow,
): TakeMessageResponse {
  const planRow = getRow<PlanRow>(
    ctx.db,
    "SELECT plan_json, caption FROM plan_revisions WHERE id = ?",
    take.plan_revision_id,
  );
  const parsed = ActionPlan.safeParse(fromJson<unknown>(planRow?.plan_json, null));
  const plan = parsed.success ? parsed.data : null;
  const product = getRow<ProductRow>(
    ctx.db,
    "SELECT model_label, fixture_id, source_type FROM product_revisions WHERE id = ?",
    take.product_revision_id,
  );
  const procedure = take.procedure_revision_id
    ? getRow<ProcedureRow>(
        ctx.db,
        "SELECT title, procedure_code, source_description FROM procedure_revisions WHERE id = ?",
        take.procedure_revision_id,
      )
    : undefined;
  const review = getRow<{ resulting_state: string; uncertainty_note: string | null }>(
    ctx.db,
    `SELECT resulting_state, uncertainty_note FROM reviews WHERE take_id = ?
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    take.id,
  );
  const check = checkState(currentAssessmentBinding(ctx.db, take));
  const filename = takeDownloadFilename(take);
  const label = productLabel(ctx, kase, product);
  const caption = one(take.caption) || one(planRow?.caption) || "the selected action";
  const checkLine = `Automated visual check: ${ASSESSMENT_LABELS[check]} (${CHECK_EXPLANATION[check]}).`;
  const note = one(review?.uncertainty_note);

  if (take.purpose === "solution") {
    const source = procedure
      ? `${one(procedure.title)}${procedure.procedure_code ? ` (${one(procedure.procedure_code)})` : ""}`
      : "the supplied instructions";
    const prereqs = plan?.prerequisites.map(one).filter(Boolean) ?? [];
    const reviewLine =
      review?.resulting_state === "accepted"
        ? "Support review: checked against the supplied instructions before sending."
        : "Support review: not yet confirmed against the supplied instructions.";
    const body = [
      "Hello,",
      "",
      `Here is a short illustration of one step for ${label}, based on ${source}.`,
      "",
      `Step shown: ${caption}`,
      ...(plan ? actionLines(plan) : []),
      ...(prereqs.length ? ["", "Before you start:", ...prereqs.map((p) => `- ${p}`)] : []),
      "",
      `Source: ${source}${procedure ? `. ${one(procedure.source_description)}` : ""}`,
      "",
      `About the attached clip (${filename}):`,
      `- ${PURPOSE_LABELS.solution}. It illustrates the written step above; it is not a manufacturer video and not a recording of your product.`,
      `- ${checkLine}`,
      `- ${reviewLine}${note ? ` Note: ${note}` : ""}`,
      "",
      "If the clip and the written instructions ever differ, follow the written instructions.",
    ].join("\n");
    return {
      takeId: take.id,
      subject: truncate(`How to: ${caption} (${label})`, 140),
      body,
      attachmentFilename: filename,
    };
  }

  const tried = plan?.context.actionsTried.map(one).filter(Boolean) ?? [];
  const triedText = tried.length ? tried : [one(kase.actions_tried)].filter(Boolean);
  const unresolved = plan?.context.unresolved.map(one).filter(Boolean) ?? [];
  const frequency = one(plan?.context.reportedFrequency);
  const reviewLine =
    review?.resulting_state === "accepted"
      ? check === "matches"
        ? "My review: I watched the clip and it matches my description."
        : "My review: I accepted the clip as close to what I described, but it could not be fully verified."
      : review?.resulting_state === "uncertain"
        ? "My review: I am not sure the clip matches exactly."
        : "My review: not yet confirmed.";
  const body = [
    "Hello,",
    "",
    `I am contacting you about a problem with my ${label}. I attached a short clip to show what it does.`,
    "",
    `What happens: ${caption}`,
    ...(plan ? actionLines(plan) : []),
    ...(frequency ? [`- How often: ${frequency}`] : []),
    "",
    `What I tried: ${triedText.length ? triedText.join("; ") : "Not stated"}`,
    `Still unknown: ${unresolved.length ? unresolved.join("; ") : "The cause is unknown"}`,
    "",
    `About the attached clip (${filename}):`,
    `- ${PURPOSE_LABELS.problem}. It illustrates the behavior I described; it is not a recording of my product and does not show or establish the cause.`,
    `- ${checkLine}`,
    `- ${reviewLine}${note ? ` My note: ${note}` : ""}`,
    "",
    "Thank you.",
  ].join("\n");
  return {
    takeId: take.id,
    subject: truncate(`Product issue: ${label} - ${caption}`, 140),
    body,
    attachmentFilename: filename,
  };
}
