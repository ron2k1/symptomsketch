import type { Router } from "express";
import {
  CreateProcedureRequest,
  ROUTES,
  type CreateProcedureResponse,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { now } from "../db/index.ts";
import { requireOwnedActiveCase } from "../domain/plans.ts";
import { findFixtureProcedure, insertProcedure, splitSteps } from "../domain/procedures.ts";
import { AppError } from "../http/errors.ts";
import { requireCustomerAccess } from "../http/session.ts";
import { param, parseBody } from "../http/validate.ts";

/**
 * POST ROUTES.caseProcedures  CreateProcedureRequest -> CreateProcedureResponse (201)
 * Creates an immutable procedure revision bound to the case's current product revision.
 * fixtureProcedureId prefills from the authored demo procedure of the case's catalog fixture.
 */
export function register(router: Router, ctx: AppContext): void {
  router.post(ROUTES.caseProcedures, (req, res) => {
    const session = requireCustomerAccess(req);
    const kase = requireOwnedActiveCase(ctx.db, session, param(req, "caseId"));
    const input = parseBody(CreateProcedureRequest, req);
    if (!kase.product_revision_id) {
      throw new AppError("VALIDATION_FAILED", "Add a product photo before the procedure.");
    }
    let title = input.title.trim();
    let approvedText = input.approvedText;
    let steps = input.steps?.map((s) => s.trim()).filter(Boolean) ?? splitSteps(approvedText);
    let procedureCode = input.procedureCode?.trim() || null;
    let sourceDescription = input.sourceDescription.trim();
    let confirmed = input.modelApplicabilityConfirmed;
    if (input.fixtureProcedureId) {
      const fixture = findFixtureProcedure(ctx.config.demoAssetsDir, input.fixtureProcedureId);
      if (!fixture || fixture.fixtureId !== kase.fixture_id) {
        throw new AppError("VALIDATION_FAILED", "That demo procedure is not for this product.");
      }
      const f = fixture.procedure;
      title = f.title;
      approvedText = f.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
      steps = [...f.steps];
      procedureCode = f.procedureId;
      sourceDescription = f.source;
      confirmed = true;
    }
    if (steps.length === 0) {
      throw new AppError("VALIDATION_FAILED", "The procedure needs at least one step.");
    }
    const procedure = insertProcedure(ctx.db, {
      caseId: kase.id,
      productRevisionId: kase.product_revision_id,
      title,
      procedureCode,
      approvedText,
      steps,
      sourceDescription,
      modelApplicabilityConfirmed: confirmed,
      createdAt: now(),
    });
    const body: CreateProcedureResponse = { procedure };
    res.status(201).json(body);
  });
}
