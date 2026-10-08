// Plan revisions (spec 10): persistence, DTOs, and owned-case / reference access for the AI
// routes. Turning planner output into an ActionPlan lives in plan-builder.ts.
import { readFile } from "node:fs/promises";
import type {
  ActionPlan,
  PlanRevision,
  PlanStatus,
  Purpose,
  SourceType,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { type Db, allRows, fromJson, getRow, now, toJson } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import { resolveStoragePath } from "../media/files.ts";
import type { GeminiImageMime } from "../providers/gemini-client.ts";

// ---- owned case access ----

export interface AiCaseRow {
  id: string;
  owner_session_id: string;
  owner_role: "customer" | "support";
  mode: Purpose;
  status: "active" | "deleted" | "expired";
  original_account: string;
  actions_tried: string;
  model_label: string | null;
  fixture_id: string | null;
  product_revision_id: string | null;
  problem_plan_id: string | null;
  solution_plan_id: string | null;
  expires_at: string;
}

export function loadCase(db: Db, caseId: string): AiCaseRow | undefined {
  return getRow<AiCaseRow>(db, "SELECT * FROM cases WHERE id = ?", caseId);
}

export function isCaseActive(row: AiCaseRow | undefined): boolean {
  return !!row && row.status === "active" && row.expires_at > now();
}

/**
 * The URL case must be owned by this session (customer case, or a support session's own work
 * case) and still active. Unknown and foreign cases are both NOT_FOUND.
 */
export function requireOwnedActiveCase(db: Db, session: SessionInfo, caseId: string): AiCaseRow {
  const row = loadCase(db, caseId);
  if (!row || row.owner_session_id !== session.id) throw new AppError("NOT_FOUND");
  if (!isCaseActive(row)) throw new AppError("CASE_INACTIVE");
  return row;
}

export function currentPlanId(row: AiCaseRow, purpose: Purpose): string | null {
  return purpose === "problem" ? row.problem_plan_id : row.solution_plan_id;
}

// ---- product reference ----

export interface ProductRefRow {
  id: string;
  case_id: string;
  source_type: SourceType;
  fixture_id: string | null;
  normalized_asset_id: string;
  model_label: string | null;
  confirmed_features_json: string;
}

export function loadProductRevision(db: Db, id: string): ProductRefRow | undefined {
  return getRow<ProductRefRow>(db, "SELECT * FROM product_revisions WHERE id = ?", id);
}

const IMAGE_MIMES = new Set<string>(["image/png", "image/jpeg", "image/webp"]);

/** Read a stored asset's bytes (path stays server-side; refuses paths outside DATA_DIR). */
export async function readAsset(
  ctx: AppContext,
  assetId: string,
): Promise<{ bytes: Buffer; mime: string; sha256: string } | null> {
  const row = getRow<{
    storage_path: string;
    mime: string;
    sha256: string;
    deleted_at: string | null;
  }>(ctx.db, "SELECT storage_path, mime, sha256, deleted_at FROM assets WHERE id = ?", assetId);
  if (!row || row.deleted_at) return null;
  try {
    const full = resolveStoragePath(ctx.paths, row.storage_path);
    return { bytes: await readFile(full), mime: row.mime, sha256: row.sha256 };
  } catch {
    return null;
  }
}

/** The canonical normalized reference image of a product revision, when usable by Gemini. */
export async function loadReferenceImage(
  ctx: AppContext,
  product: ProductRefRow,
): Promise<{ bytes: Buffer; mime: GeminiImageMime } | null> {
  const asset = await readAsset(ctx, product.normalized_asset_id);
  if (!asset || !IMAGE_MIMES.has(asset.mime)) return null;
  return { bytes: asset.bytes, mime: asset.mime as GeminiImageMime };
}

// ---- plan revision rows + DTOs ----

export interface PlanRow {
  id: string;
  case_id: string;
  parent_id: string | null;
  purpose: Purpose;
  product_revision_id: string;
  procedure_revision_id: string | null;
  status: PlanStatus;
  plan_json: string;
  reactor_prompt: string | null;
  caption: string;
  understanding: string;
  preserved_json: string;
  unclear_json: string;
  clarification_question: string | null;
  validation_issues_json: string;
  model_id: string | null;
  client_request_id: string | null;
  created_at: string;
}

export function toPlanRevision(row: PlanRow): PlanRevision {
  return {
    id: row.id,
    caseId: row.case_id,
    parentId: row.parent_id,
    purpose: row.purpose,
    productRevisionId: row.product_revision_id,
    procedureRevisionId: row.procedure_revision_id,
    plan: fromJson<ActionPlan>(row.plan_json, {} as ActionPlan),
    reactorPrompt: row.reactor_prompt,
    caption: row.caption,
    status: row.status,
    validationIssues: fromJson<string[]>(row.validation_issues_json, []),
    createdAt: row.created_at,
  };
}

/** All plan revisions of a case, oldest first (for CaseDetail). */
export function listPlanRevisions(db: Db, caseId: string): PlanRevision[] {
  return allRows<PlanRow>(
    db,
    "SELECT * FROM plan_revisions WHERE case_id = ? ORDER BY created_at, rowid",
    caseId,
  ).map(toPlanRevision);
}

export function getPlanRow(db: Db, id: string): PlanRow | undefined {
  return getRow<PlanRow>(db, "SELECT * FROM plan_revisions WHERE id = ?", id);
}

export function getPlanRevision(db: Db, id: string): PlanRevision | null {
  const row = getPlanRow(db, id);
  return row ? toPlanRevision(row) : null;
}

export function findPlanByClientRequest(
  db: Db,
  caseId: string,
  clientRequestId: string,
): PlanRow | undefined {
  return getRow<PlanRow>(
    db,
    "SELECT * FROM plan_revisions WHERE case_id = ? AND client_request_id = ?",
    caseId,
    clientRequestId,
  );
}

export type NewPlanRow = Omit<
  PlanRow,
  "plan_json" | "preserved_json" | "unclear_json" | "validation_issues_json"
> & {
  plan: ActionPlan;
  preserved: string[];
  unclear: string[];
  validationIssues: string[];
};

/** Insert a plan revision and move the case's purpose pointer to it (call inside tx). */
export function insertPlanRevision(db: Db, p: NewPlanRow): PlanRow {
  db.prepare(
    `INSERT INTO plan_revisions (id, case_id, parent_id, purpose, product_revision_id,
       procedure_revision_id, status, plan_json, reactor_prompt, caption, understanding,
       preserved_json, unclear_json, clarification_question, validation_issues_json, model_id,
       client_request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.case_id,
    p.parent_id,
    p.purpose,
    p.product_revision_id,
    p.procedure_revision_id,
    p.status,
    toJson(p.plan),
    p.reactor_prompt,
    p.caption,
    p.understanding,
    toJson(p.preserved),
    toJson(p.unclear),
    p.clarification_question,
    toJson(p.validationIssues),
    p.model_id,
    p.client_request_id,
    p.created_at,
  );
  const column = p.purpose === "problem" ? "problem_plan_id" : "solution_plan_id";
  db.prepare(`UPDATE cases SET ${column} = ?, updated_at = ? WHERE id = ?`).run(
    p.id,
    p.created_at,
    p.case_id,
  );
  return getPlanRow(db, p.id)!;
}
