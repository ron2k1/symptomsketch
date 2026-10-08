import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CHECK_RESULT_LABELS,
  CatalogFixtureFile,
  PURPOSE_LABELS,
  takeFilename,
  type AssessmentUiStatus,
  type CheckResult,
  type TicketAttachmentPurpose,
  type TicketSnapshot,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { fromJson, getRow, type Db } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { AcceptedTake } from "./accepted-take.ts";
import { getLiveAsset } from "./accepted-take.ts";
import type { AssessmentRow, AssetRow, CaseRow, PlanRow, ProductRevisionRow } from "./rows.ts";

/**
 * Builds the immutable ticket snapshot (spec 5, 13) and the exact attachment grants from owned
 * server records at submission time. Later case edits never touch the stored JSON.
 */

export interface PlannedAttachment {
  asset: AssetRow;
  purpose: TicketAttachmentPurpose;
  filename: string;
  lineage: Record<string, string | boolean | null>;
}

const SUMMARY_MAX_CHARS = 800;

let catalogNames: Map<string, string> | null = null;

/** Fixture display names from assets/demo/catalog.json (cached; empty map if unreadable). */
function fixtureName(ctx: AppContext, fixtureId: string | null): string | null {
  if (!fixtureId) return null;
  if (!catalogNames) {
    catalogNames = new Map();
    try {
      const raw = readFileSync(path.join(ctx.config.demoAssetsDir, "catalog.json"), "utf8");
      const parsed = CatalogFixtureFile.safeParse(JSON.parse(raw));
      if (parsed.success) for (const f of parsed.data.fixtures) catalogNames.set(f.id, f.name);
    } catch {
      // Unreadable catalog: fall back to the model label / generic label below.
    }
  }
  return catalogNames.get(fixtureId) ?? null;
}

function assessmentView(
  db: Db,
  assessmentId: string | null,
  finalSha256: string,
): { status: AssessmentUiStatus; summary: string | null } {
  if (!assessmentId) return { status: "unavailable", summary: null };
  const row = getRow<AssessmentRow>(
    db,
    "SELECT id, final_sha256, job_state, result_status, summary, result_json FROM assessments WHERE id = ?",
    assessmentId,
  );
  // An assessment bound to other bytes is never carried into the ticket as current.
  if (!row || row.final_sha256 !== finalSha256) return { status: "unavailable", summary: null };
  if (row.job_state === "queued" || row.job_state === "running") {
    return { status: "pending", summary: null };
  }
  if (row.job_state === "failed" || !row.result_status) {
    return { status: "unavailable", summary: null };
  }
  const checks = fromJson<{ checks?: { constraintId?: string; result?: CheckResult }[] }>(
    row.result_json,
    {},
  ).checks;
  const parts: string[] = [];
  if (row.summary) parts.push(row.summary.trim());
  if (Array.isArray(checks) && checks.length > 0) {
    const list = checks
      .filter(
        (c) => typeof c.constraintId === "string" && c.result && c.result in CHECK_RESULT_LABELS,
      )
      .map((c) => `${c.constraintId}: ${CHECK_RESULT_LABELS[c.result!].toLowerCase()}`);
    if (list.length > 0) parts.push(`Checks: ${list.join("; ")}.`);
  }
  const summary = parts.join(" ").slice(0, SUMMARY_MAX_CHARS);
  return { status: row.result_status, summary: summary || null };
}

function unresolvedDetails(db: Db, planRevisionId: string): string[] {
  const plan = getRow<PlanRow>(
    db,
    "SELECT id, plan_json, unclear_json FROM plan_revisions WHERE id = ?",
    planRevisionId,
  );
  if (!plan) return [];
  const fromPlan = fromJson<{ context?: { unresolved?: unknown } }>(plan.plan_json, {}).context
    ?.unresolved;
  const fromUnclear = fromJson<unknown>(plan.unclear_json, []);
  const all = [
    ...(Array.isArray(fromPlan) ? fromPlan : []),
    ...(Array.isArray(fromUnclear) ? fromUnclear : []),
  ].filter((s): s is string => typeof s === "string" && s.trim() !== "");
  return [...new Set(all.map((s) => s.trim()))];
}

function extFor(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "video/mp4") return ".mp4";
  return ".jpg";
}

/**
 * Short opaque case label for filenames. Same rule as server-media's caseShortLabel
 * (domain/explanations.ts) so ticket filenames match the customer's own download.
 */
export function caseLabel(caseId: string): string {
  const random = caseId.includes("_") ? caseId.slice(caseId.indexOf("_") + 1) : caseId;
  return (
    random
      .replace(/[^A-Za-z0-9]/g, "")
      .toLowerCase()
      .slice(0, 6) || "case"
  );
}

export interface SnapshotInput {
  ctx: AppContext;
  caseRow: CaseRow;
  accepted: AcceptedTake;
  message: string;
  includeOriginal: boolean;
  submittedAt: string;
}

export function buildSnapshot(input: SnapshotInput): {
  snapshot: TicketSnapshot;
  attachments: PlannedAttachment[];
} {
  const { ctx, caseRow, accepted, message, includeOriginal, submittedAt } = input;
  const { take, finalAsset, review } = accepted;
  const db = ctx.db;
  const product = getRow<ProductRevisionRow>(
    db,
    "SELECT * FROM product_revisions WHERE id = ? AND case_id = ?",
    take.product_revision_id,
    caseRow.id,
  );
  if (!product) throw new AppError("NOT_FOUND", "The take's product reference is missing.");
  const reference = getLiveAsset(db, product.normalized_asset_id);
  if (!reference || reference.case_id !== caseRow.id) {
    throw new AppError("NOT_FOUND", "The take's product reference is missing.");
  }

  const modelLabel = caseRow.model_label ?? product.model_label ?? null;
  const productLabel = fixtureName(ctx, product.fixture_id) ?? modelLabel ?? "Uploaded product";
  const assessment = assessmentView(db, take.current_assessment_id, take.sha256!);
  const snapshot: TicketSnapshot = {
    caseTitle: caseRow.title,
    purpose: take.purpose,
    purposeLabel: PURPOSE_LABELS[take.purpose],
    productLabel,
    sourceType: product.source_type,
    modelLabel,
    originalAccount: caseRow.original_account,
    actionsTried: caseRow.actions_tried,
    unresolved: unresolvedDetails(db, take.plan_revision_id),
    takeId: take.id,
    takeNumber: take.number,
    finalSha256: take.sha256!,
    caption: take.caption,
    durationMs: take.duration_ms ?? finalAsset.duration_ms ?? null,
    assessmentStatus: assessment.status,
    assessmentSummary: assessment.summary,
    reviewState: take.review_state,
    uncertaintyNote: review.uncertainty_note,
    criticOverride:
      review.override_check_status === "needs_revision"
        ? {
            checkStatus: "needs_revision",
            reason: review.override_reason,
            overriddenByRole: review.reviewer_role,
            overriddenAt: review.created_at,
          }
        : null,
    message,
    submittedAt,
  };

  const lineage = {
    sourceCaseId: caseRow.id,
    productRevisionId: product.id,
    takeId: take.id,
    includeOriginal,
  };
  const attachments: PlannedAttachment[] = [
    {
      asset: reference,
      purpose: "customer_reference",
      filename: `symptomsketch-case-${caseLabel(caseRow.id)}-reference${extFor(reference.mime)}`,
      lineage: { ...lineage, assetKind: reference.kind },
    },
    {
      asset: finalAsset,
      purpose: "customer_take",
      filename: takeFilename(caseLabel(caseRow.id), take.number),
      lineage: { ...lineage, assetKind: finalAsset.kind },
    },
  ];
  // A reference whose original and normalized rows coincide is attached once.
  if (includeOriginal && product.original_asset_id !== reference.id) {
    const original = getLiveAsset(db, product.original_asset_id);
    if (!original || original.case_id !== caseRow.id) {
      throw new AppError("NOT_FOUND", "The untouched original is no longer available.");
    }
    attachments.push({
      asset: original,
      purpose: "customer_original",
      filename:
        original.filename ??
        `symptomsketch-case-${caseLabel(caseRow.id)}-original${extFor(original.mime)}`,
      lineage: { ...lineage, assetKind: original.kind },
    });
  }
  return { snapshot, attachments };
}
