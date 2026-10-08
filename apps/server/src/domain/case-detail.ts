import type { CaseDetail } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { listTicketSummariesForCase } from "../support/dto.ts";
import { type CaseRow, toCaseRecord } from "./cases.ts";
import { listMessages } from "./messages.ts";
import { listPlanRevisions } from "./plans.ts";
import { listProcedures } from "./procedures.ts";
import { getProductRevision, listProductRevisions } from "./products.ts";
import { listCaseTakes } from "./takes.ts";

/**
 * GET /api/cases/:id payload (spec 11 "Restored case data"): everything needed to restore Issue,
 * Recreate and Support after a refresh. Product data is owned here; every other section comes
 * from its owner's mapper so the case view and the per-item routes return identical DTOs.
 * Owner-only: callers must have checked ownership of `caseRow` already.
 */
export function buildCaseDetail(ctx: AppContext, caseRow: CaseRow): CaseDetail {
  const product = caseRow.product_revision_id
    ? getProductRevision(ctx, caseRow.id, caseRow.product_revision_id)
    : null;
  return {
    ...toCaseRecord(caseRow),
    product,
    products: listProductRevisions(ctx, caseRow.id),
    procedures: listProcedures(ctx.db, caseRow.id),
    messages: listMessages(ctx.db, caseRow.id),
    plans: listPlanRevisions(ctx.db, caseRow.id),
    takes: listCaseTakes(ctx, caseRow.id),
    tickets: listTicketSummariesForCase(ctx.db, caseRow.id),
  };
}
