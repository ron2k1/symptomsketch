import type { Router } from "express";
import { ROUTES } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { productBoxFor } from "../domain/product-box.ts";
import { requireCustomerAccess } from "../http/session.ts";
import { param } from "../http/validate.ts";

/**
 * GET ROUTES.caseProductBox -> ProductBoxResponse. Gemini box_2d for the product in the case's
 * reference image, cached per reference asset. No box -> a typed AppError, never a guessed region.
 */
export function register(router: Router, ctx: AppContext): void {
  router.get(ROUTES.caseProductBox, async (req, res) => {
    const session = requireCustomerAccess(req);
    res.json(await productBoxFor(ctx, session, param(req, "caseId")));
  });
}
