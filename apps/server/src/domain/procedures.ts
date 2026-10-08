// Approved procedure revisions (spec 3, 5, 10). Immutable: a changed procedure is a new revision
// bound to the product revision it was written for.
import {
  CatalogFixtureFile,
  type CatalogProcedureFixture,
  type ProcedureRevision,
} from "@symptomsketch/contracts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { type Db, allRows, fromJson, getRow, newId } from "../db/index.ts";

export interface ProcedureRow {
  id: string;
  case_id: string;
  product_revision_id: string;
  title: string;
  procedure_code: string | null;
  approved_text: string;
  steps_json: string;
  source_description: string;
  source_asset_id: string | null;
  model_applicability_confirmed: number;
  created_at: string;
}

export function toProcedure(row: ProcedureRow): ProcedureRevision {
  return {
    id: row.id,
    caseId: row.case_id,
    productRevisionId: row.product_revision_id,
    title: row.title,
    procedureCode: row.procedure_code,
    approvedText: row.approved_text,
    steps: fromJson<string[]>(row.steps_json, []),
    sourceDescription: row.source_description,
    modelApplicabilityConfirmed: row.model_applicability_confirmed === 1,
    createdAt: row.created_at,
  };
}

/** All procedure revisions of a case, oldest first (for CaseDetail). */
export function listProcedures(db: Db, caseId: string): ProcedureRevision[] {
  return allRows<ProcedureRow>(
    db,
    "SELECT * FROM procedure_revisions WHERE case_id = ? ORDER BY created_at, rowid",
    caseId,
  ).map(toProcedure);
}

export function getProcedure(db: Db, id: string): ProcedureRevision | null {
  const row = getRow<ProcedureRow>(db, "SELECT * FROM procedure_revisions WHERE id = ?", id);
  return row ? toProcedure(row) : null;
}

/** Newest procedure revision written for this exact product revision of the case. */
export function latestProcedureFor(
  db: Db,
  caseId: string,
  productRevisionId: string,
): ProcedureRevision | null {
  const row = getRow<ProcedureRow>(
    db,
    `SELECT * FROM procedure_revisions WHERE case_id = ? AND product_revision_id = ?
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    caseId,
    productRevisionId,
  );
  return row ? toProcedure(row) : null;
}

/**
 * Split pasted approved text into steps: one per non-empty line, leading list markers
 * ("1.", "2)", "-", "*", "Step 3:") removed. A single paragraph stays one step.
 */
export function splitSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:step\s*\d+\s*[:.)-]|\d+\s*[.):-]|[-*•])\s*/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 30);
}

export interface NewProcedure {
  caseId: string;
  productRevisionId: string;
  title: string;
  procedureCode: string | null;
  approvedText: string;
  steps: string[];
  sourceDescription: string;
  modelApplicabilityConfirmed: boolean;
  createdAt: string;
}

export function insertProcedure(db: Db, p: NewProcedure): ProcedureRevision {
  const id = newId("proc");
  db.prepare(
    `INSERT INTO procedure_revisions (id, case_id, product_revision_id, title, procedure_code,
       approved_text, steps_json, source_description, model_applicability_confirmed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    p.caseId,
    p.productRevisionId,
    p.title,
    p.procedureCode,
    p.approvedText,
    JSON.stringify(p.steps),
    p.sourceDescription,
    p.modelApplicabilityConfirmed ? 1 : 0,
    p.createdAt,
  );
  return getProcedure(db, id)!;
}

/** Authored demo procedure for a catalog fixture (server-side assets/demo/catalog.json). */
export function findFixtureProcedure(
  demoAssetsDir: string,
  procedureId: string,
): { fixtureId: string; procedure: CatalogProcedureFixture } | null {
  let file: CatalogFixtureFile;
  try {
    file = CatalogFixtureFile.parse(
      JSON.parse(readFileSync(path.join(demoAssetsDir, "catalog.json"), "utf8")),
    );
  } catch {
    return null;
  }
  const fixture = file.fixtures.find((f) => f.procedure.procedureId === procedureId);
  return fixture ? { fixtureId: fixture.id, procedure: fixture.procedure } : null;
}
