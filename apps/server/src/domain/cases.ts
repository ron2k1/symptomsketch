import { readFile } from "node:fs/promises";
import type { Request } from "express";
import type {
  CaseRecord,
  CaseStatus,
  CatalogFixture,
  CreateCaseRequest,
  PatchCaseRequest,
  Purpose,
  Role,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { fromNow, getRow, newId, now, toJson, tx } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import { type SessionInfo, requireCustomerAccess, requireSession } from "../http/session.ts";
import { ImageRejectedError } from "../media/image.ts";
import { commitImageAssets, discardStagedImage, stageImage, type StagedImage } from "./assets.ts";
import { fixturePhotoPath, getFixture } from "./catalog.ts";
import { createProductRevision, relabelCurrentProduct } from "./products.ts";

/** Row of the `cases` table. */
export interface CaseRow {
  id: string;
  owner_session_id: string;
  owner_role: Role;
  title: string;
  mode: Purpose;
  status: CaseStatus;
  original_account: string;
  actions_tried: string;
  model_label: string | null;
  fixture_id: string | null;
  product_revision_id: string | null;
  problem_plan_id: string | null;
  solution_plan_id: string | null;
  source_ticket_id: string | null;
  take_counter: number;
  client_request_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  deleted_at: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function getCaseRow(ctx: AppContext, caseId: string): CaseRow | undefined {
  return getRow<CaseRow>(ctx.db, "SELECT * FROM cases WHERE id = ?", caseId);
}

/**
 * The case if `session` owns it. Foreign or unknown ids -> 404 NOT_FOUND (never FORBIDDEN, so ids
 * cannot be probed). With `active` (default) a deleted/expired own case -> 410 CASE_INACTIVE.
 * Support sessions get no bypass: they only reach cases they own (agent work cases).
 */
export function getOwnedCase(
  ctx: AppContext,
  session: SessionInfo,
  caseId: string,
  opts: { active?: boolean } = {},
): CaseRow {
  const row = getRow<CaseRow>(
    ctx.db,
    "SELECT * FROM cases WHERE id = ? AND owner_session_id = ?",
    caseId,
    session.id,
  );
  if (!row) throw new AppError("NOT_FOUND");
  if ((opts.active ?? true) && row.status !== "active") throw new AppError("CASE_INACTIVE");
  return row;
}

/**
 * Route helper for every `/api/cases/:caseId/...` handler: valid session (+ customer access or
 * support when `paid`), then ownership of the URL case.
 */
export function requireOwnedCase(
  ctx: AppContext,
  req: Request,
  caseId: string,
  opts: { paid?: boolean; active?: boolean } = {},
): { session: SessionInfo; caseRow: CaseRow } {
  const session = opts.paid ? requireCustomerAccess(req) : requireSession(req);
  return { session, caseRow: getOwnedCase(ctx, session, caseId, { active: opts.active }) };
}

export function toCaseRecord(row: CaseRow): CaseRecord {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    ownerRole: row.owner_role,
    originalAccount: row.original_account,
    actionsTried: row.actions_tried,
    modelLabel: row.model_label,
    fixtureId: row.fixture_id,
    productRevisionId: row.product_revision_id,
    problemPlanId: row.problem_plan_id,
    solutionPlanId: row.solution_plan_id,
    sourceTicketId: row.source_ticket_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function findByClientRequest(ctx: AppContext, sessionId: string, clientRequestId: string) {
  return getRow<CaseRow>(
    ctx.db,
    "SELECT * FROM cases WHERE owner_session_id = ? AND client_request_id = ?",
    sessionId,
    clientRequestId,
  );
}

/** Store the fixture's authored demo procedure as an initial, unconfirmed procedure draft. */
function insertFixtureProcedure(
  ctx: AppContext,
  caseId: string,
  productRevisionId: string,
  fixture: CatalogFixture,
): void {
  const p = fixture.procedure;
  ctx.db
    .prepare(
      `INSERT INTO procedure_revisions (id, case_id, product_revision_id, title, procedure_code,
         approved_text, steps_json, source_description, source_asset_id,
         model_applicability_confirmed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
    )
    .run(
      newId("proc"),
      caseId,
      productRevisionId,
      p.title,
      p.procedureId,
      p.steps.join("\n"),
      toJson(p.steps),
      p.source,
      now(),
    );
}

export interface CreateCaseResult {
  caseRow: CaseRow;
  created: boolean;
}

/**
 * POST /api/cases. With an allowlisted fixtureId the sample photo is copied into a case-owned
 * original + normalized asset, a demo_photo product revision becomes current, and the fixture's
 * authored procedure is stored as a draft procedure revision for solution mode. Same
 * clientRequestId from the same session returns the existing case.
 */
export async function createCase(
  ctx: AppContext,
  session: SessionInfo,
  input: CreateCaseRequest,
): Promise<CreateCaseResult> {
  const clientRequestId = input.clientRequestId ?? null;
  if (clientRequestId) {
    const existing = findByClientRequest(ctx, session.id, clientRequestId);
    if (existing) return { caseRow: existing, created: false };
  }
  let fixture: CatalogFixture | null = null;
  if (input.fixtureId) {
    fixture = getFixture(ctx.config, input.fixtureId);
    if (!fixture) throw new AppError("VALIDATION_FAILED", "Unknown demo product.");
  }

  const caseId = newId("case");
  let staged: StagedImage | null = null;
  if (fixture) {
    try {
      const bytes = await readFile(fixturePhotoPath(ctx.config, fixture));
      staged = await stageImage(ctx, {
        caseId,
        ownerSessionId: session.id,
        bytes,
        filename: fixture.photo,
        lineage: { source: "demo_fixture", fixtureId: fixture.id },
      });
    } catch (err) {
      console.error(
        `[cases] fixture photo unusable fixture=${fixture.id} ${err instanceof ImageRejectedError ? err.reason : "io"}`,
      );
      throw new AppError("INTERNAL_ERROR");
    }
  }

  const ts = now();
  const title = input.title?.trim() || fixture?.name || "My product";
  try {
    tx(ctx.db, () => {
      ctx.db
        .prepare(
          `INSERT INTO cases (id, owner_session_id, owner_role, title, mode, status, fixture_id,
             client_request_id, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        )
        .run(
          caseId,
          session.id,
          session.role,
          title,
          input.purpose,
          fixture?.id ?? null,
          clientRequestId,
          ts,
          ts,
          fromNow(ctx.config.caseRetentionDays * DAY_MS),
        );
      if (staged && fixture) {
        const { original, normalized } = commitImageAssets(ctx, staged);
        const revision = createProductRevision(ctx, {
          caseId,
          sourceType: "demo_photo",
          fixtureId: fixture.id,
          original,
          normalized,
          modelLabel: null,
        });
        insertFixtureProcedure(ctx, caseId, revision.id, fixture);
      }
    });
  } catch (err) {
    if (staged) await discardStagedImage(ctx, staged);
    // Concurrent duplicate submit with the same clientRequestId: return the winner.
    const existing = clientRequestId && findByClientRequest(ctx, session.id, clientRequestId);
    if (existing) return { caseRow: existing, created: false };
    throw err;
  }
  const row = getCaseRow(ctx, caseId);
  if (!row) throw new Error("case insert failed");
  return { caseRow: row, created: true };
}

function hasAnyPlan(ctx: AppContext, caseId: string): boolean {
  return (
    getRow<{ one: number }>(
      ctx.db,
      "SELECT 1 AS one FROM plan_revisions WHERE case_id = ? LIMIT 1",
      caseId,
    ) !== undefined
  );
}

/**
 * PATCH /api/cases/:id. What happened / What I tried keep the customer's exact wording and are
 * editable only until the first plan exists (later changes go through plan corrections).
 */
export function patchCase(ctx: AppContext, row: CaseRow, patch: PatchCaseRequest): CaseRow {
  tx(ctx.db, () => {
    const sets: string[] = [];
    const values: (string | null)[] = [];
    const accountChanged =
      patch.originalAccount !== undefined && patch.originalAccount !== row.original_account;
    const triedChanged =
      patch.actionsTried !== undefined && patch.actionsTried !== row.actions_tried;
    if ((accountChanged || triedChanged) && hasAnyPlan(ctx, row.id)) {
      throw new AppError(
        "PLAN_CONFLICT",
        "What happened and What I tried are saved with the first plan. Add a correction instead.",
      );
    }
    if (accountChanged) {
      sets.push("original_account = ?");
      values.push(patch.originalAccount ?? "");
    }
    if (triedChanged) {
      sets.push("actions_tried = ?");
      values.push(patch.actionsTried ?? "");
    }
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title.length === 0) throw new AppError("VALIDATION_FAILED", "Title cannot be empty.");
      sets.push("title = ?");
      values.push(title);
    }
    if (patch.mode !== undefined && patch.mode !== row.mode) {
      sets.push("mode = ?");
      values.push(patch.mode);
    }
    if (patch.modelLabel !== undefined) {
      const label = patch.modelLabel?.trim() || null;
      if (label !== row.model_label) {
        sets.push("model_label = ?");
        values.push(label);
        relabelCurrentProduct(ctx, row.id, row.product_revision_id, label);
      }
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    values.push(now());
    ctx.db.prepare(`UPDATE cases SET ${sets.join(", ")} WHERE id = ?`).run(...values, row.id);
  });
  const updated = getCaseRow(ctx, row.id);
  if (!updated) throw new AppError("NOT_FOUND");
  return updated;
}
