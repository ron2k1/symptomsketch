import { z } from "zod";

/** Authored demo procedure shipped with a catalog fixture (not a manufacturer manual). */
export const CatalogProcedureFixture = z.object({
  procedureId: z.string().min(1),
  title: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  source: z.string().min(1),
});
export type CatalogProcedureFixture = z.infer<typeof CatalogProcedureFixture>;

/** One row of `assets/demo/catalog.json` (server-side fixture file). */
export const CatalogFixture = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1),
  category: z.string().min(1),
  tagline: z.string().min(1),
  /** File name inside assets/demo (server-only; never sent to the browser). */
  photo: z.string().regex(/^[A-Za-z0-9._-]+$/),
  /** Public URL path served by the web app (apps/web/public). */
  landingImage: z.string().startsWith("/"),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  alt: z.string().min(1),
  exampleIssue: z.string().min(1),
  procedure: CatalogProcedureFixture,
});
export type CatalogFixture = z.infer<typeof CatalogFixture>;

/** Shape of `assets/demo/catalog.json`. */
export const CatalogFixtureFile = z.object({
  fixtures: z.array(CatalogFixture).min(1),
});
export type CatalogFixtureFile = z.infer<typeof CatalogFixtureFile>;

/** Public catalog row: the fixture minus server paths, plus its internal queue label. */
export const CatalogProduct = CatalogFixture.omit({ photo: true }).extend({
  queueLabel: z.string(),
});
export type CatalogProduct = z.infer<typeof CatalogProduct>;

/** GET /api/catalog */
export const CatalogResponse = z.object({
  products: z.array(CatalogProduct),
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;
