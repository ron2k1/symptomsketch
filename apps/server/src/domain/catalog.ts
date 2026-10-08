import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  CatalogFixtureFile,
  SUPPORT_QUEUE_LABEL,
  type CatalogFixture,
  type CatalogProduct,
} from "@symptomsketch/contracts";
import type { AppConfig } from "../config.ts";

/**
 * Allowlisted demo products from `assets/demo/catalog.json` (spec 3, 10). The file is validated
 * with the contract schema; a fixture is usable only when its photo exists on disk. The photo
 * filename is server-only and never sent to the browser.
 */

interface CachedCatalog {
  file: string;
  mtimeMs: number;
  fixtures: readonly CatalogFixture[];
}

let cache: CachedCatalog | null = null;

function catalogFile(config: AppConfig): string {
  return path.join(config.demoAssetsDir, "catalog.json");
}

/** Absolute path of a fixture's sample photo (the schema regex already forbids separators). */
export function fixturePhotoPath(config: AppConfig, fixture: CatalogFixture): string {
  const abs = path.resolve(config.demoAssetsDir, fixture.photo);
  if (path.dirname(abs) !== path.resolve(config.demoAssetsDir)) {
    throw new Error("fixture photo escapes assets/demo");
  }
  return abs;
}

function photoExists(config: AppConfig, fixture: CatalogFixture): boolean {
  try {
    return statSync(fixturePhotoPath(config, fixture)).isFile();
  } catch {
    return false;
  }
}

/** Validated fixtures whose photo is present. Re-reads the file when it changes. */
export function loadFixtures(config: AppConfig): readonly CatalogFixture[] {
  const file = catalogFile(config);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return [];
  }
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.fixtures;
  let fixtures: CatalogFixture[] = [];
  try {
    const parsed = CatalogFixtureFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed.success) {
      fixtures = parsed.data.fixtures.filter((f) => photoExists(config, f));
    } else {
      console.error("[catalog] catalog.json failed contract validation");
    }
  } catch {
    console.error("[catalog] catalog.json could not be read");
  }
  cache = { file, mtimeMs, fixtures };
  return fixtures;
}

/** Allowlist lookup. Unknown ids return null (callers answer VALIDATION_FAILED / NOT_FOUND). */
export function getFixture(config: AppConfig, fixtureId: string): CatalogFixture | null {
  return loadFixtures(config).find((f) => f.id === fixtureId) ?? null;
}

/** Public catalog row: fixture minus the server-side photo name, plus the internal queue label. */
export function toCatalogProduct(fixture: CatalogFixture): CatalogProduct {
  const { photo: _photo, ...rest } = fixture;
  return { ...rest, queueLabel: SUPPORT_QUEUE_LABEL };
}

export function listCatalogProducts(config: AppConfig): CatalogProduct[] {
  return loadFixtures(config).map(toCatalogProduct);
}
