import type { Router } from "express";
import { CreatePlanRequest, ROUTES, type CreatePlanResponse } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { createPlan } from "../domain/plan-flow.ts";
import { requireCustomerAccess } from "../http/session.ts";
import { param, parseBody } from "../http/validate.ts";

/**
 * POST ROUTES.casePlans  CreatePlanRequest -> PlannerResult (201; 200 for an idempotent repeat)
 * Customer access or a support session's own work case. Stale parent -> 409 PLAN_CONFLICT.
 */
export function register(router: Router, ctx: AppContext): void {
  router.post(ROUTES.casePlans, async (req, res) => {
    const session = requireCustomerAccess(req);
    const input = parseBody(CreatePlanRequest, req);
    const { result, created } = await createPlan(ctx, session, param(req, "caseId"), input);
    const body: CreatePlanResponse = result;
    res.status(created ? 201 : 200).json(body);
  });
}
