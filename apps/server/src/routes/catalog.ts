import type { Router } from "express";
import { ROUTES, type CatalogResponse } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { listCatalogProducts } from "../domain/catalog.ts";

/**
 * GET /api/catalog -> CatalogResponse. Public (the landing page lists products before the access
 * code); rows come from the contract-validated assets/demo/catalog.json without server paths.
 */
export function register(router: Router, ctx: AppContext): void {
  router.get(ROUTES.catalog, (_req, res) => {
    const body: CatalogResponse = { products: listCatalogProducts(ctx.config) };
    res.json(body);
  });
}
