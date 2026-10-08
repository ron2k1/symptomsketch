import type { Router } from "express";
import {
  CreateCaseRequest,
  PatchCaseRequest,
  ROUTES,
  type CaseResponse,
  type OkResponse,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { buildCaseDetail } from "../domain/case-detail.ts";
import { createCase, getOwnedCase, patchCase } from "../domain/cases.ts";
import { deleteCase, registerCaseCleanupJob, startRetentionSweep } from "../domain/lifecycle.ts";
import { requireCustomerAccess, requireSession } from "../http/session.ts";
import { param, parseBody } from "../http/validate.ts";

/**
 * POST   /api/cases      CreateCaseRequest -> CaseResponse (201; 200 for an idempotent repeat)
 * GET    /api/cases/:id  -> CaseResponse (owner only; foreign ids 404)
 * PATCH  /api/cases/:id  PatchCaseRequest -> CaseResponse
 * DELETE /api/cases/:id  -> OkResponse (deactivate, revoke grants, cancel jobs, remove files)
 * Also starts the retention sweep and registers the case_cleanup job handler.
 */
export function register(router: Router, ctx: AppContext): void {
  registerCaseCleanupJob(ctx);
  startRetentionSweep(ctx);

  router.post(ROUTES.cases, async (req, res) => {
    const session = requireCustomerAccess(req);
    const input = parseBody(CreateCaseRequest, req);
    const { caseRow, created } = await createCase(ctx, session, input);
    const body: CaseResponse = { case: buildCaseDetail(ctx, caseRow) };
    res.status(created ? 201 : 200).json(body);
  });

  router.get(ROUTES.case, (req, res) => {
    const session = requireSession(req);
    const caseRow = getOwnedCase(ctx, session, param(req, "caseId"));
    const body: CaseResponse = { case: buildCaseDetail(ctx, caseRow) };
    res.json(body);
  });

  router.patch(ROUTES.case, (req, res) => {
    const session = requireSession(req);
    const caseRow = getOwnedCase(ctx, session, param(req, "caseId"));
    const patch = parseBody(PatchCaseRequest, req);
    const body: CaseResponse = { case: buildCaseDetail(ctx, patchCase(ctx, caseRow, patch)) };
    res.json(body);
  });

  router.delete(ROUTES.case, async (req, res) => {
    const session = requireSession(req);
    // Deleting an already deleted/expired own case is a no-op success (idempotent DELETE).
    const caseRow = getOwnedCase(ctx, session, param(req, "caseId"), { active: false });
    await deleteCase(ctx, caseRow.id, "deleted");
    const body: OkResponse = { ok: true };
    res.json(body);
  });
}
