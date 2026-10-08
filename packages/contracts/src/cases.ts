import { z } from "zod";
import { ClientRequestId, Id, Purpose, Role, Timestamp } from "./common.ts";
import { LIMITS } from "./limits.ts";
import { Message } from "./messages.ts";
import { PlanRevision } from "./plans.ts";
import { ProcedureRevision } from "./procedures.ts";
import { ProductRevision } from "./products.ts";
import { Take } from "./takes.ts";
import { TicketSummary } from "./tickets.ts";

export const CaseStatus = z.enum(["active", "deleted", "expired"]);
export type CaseStatus = z.infer<typeof CaseStatus>;

/** Case row (spec 10). `mode` is the purpose currently selected in Recreate. */
export const CaseRecord = z.object({
  id: Id,
  title: z.string(),
  mode: Purpose,
  status: CaseStatus,
  /** Role of the owning session: customer case or agent work case. */
  ownerRole: Role,
  originalAccount: z.string(),
  actionsTried: z.string(),
  modelLabel: z.string().nullable(),
  fixtureId: z.string().nullable(),
  productRevisionId: Id.nullable(),
  problemPlanId: Id.nullable(),
  solutionPlanId: Id.nullable(),
  /** Agent work cases: ticket this case was created from. */
  sourceTicketId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  expiresAt: Timestamp,
});
export type CaseRecord = z.infer<typeof CaseRecord>;

/**
 * GET /api/cases/:id: everything needed to restore Issue/Recreate/Support after refresh.
 * All media is referenced by authorized URLs (no filesystem paths, no blob URLs).
 */
export const CaseDetail = CaseRecord.extend({
  product: ProductRevision.nullable(),
  /** All product revisions (older takes keep their own). Newest last. */
  products: z.array(ProductRevision),
  procedures: z.array(ProcedureRevision),
  messages: z.array(Message),
  plans: z.array(PlanRevision),
  takes: z.array(Take),
  tickets: z.array(TicketSummary),
});
export type CaseDetail = z.infer<typeof CaseDetail>;

/** POST /api/cases */
export const CreateCaseRequest = z.object({
  purpose: Purpose,
  title: z.string().max(LIMITS.titleMaxChars).optional(),
  /** Allowlisted catalog fixture id (e.g. robot-vacuum): copies the demo photo into the case. */
  fixtureId: z.string().max(64).nullable().optional(),
  clientRequestId: ClientRequestId.optional(),
});
export type CreateCaseRequest = z.infer<typeof CreateCaseRequest>;

/**
 * PATCH /api/cases/:id: allowed context changes. originalAccount/actionsTried are editable only
 * until the first plan exists for the case (then immutable; corrections go through plans).
 */
export const PatchCaseRequest = z.object({
  title: z.string().min(1).max(LIMITS.titleMaxChars).optional(),
  mode: Purpose.optional(),
  originalAccount: z.string().max(LIMITS.accountMaxChars).optional(),
  actionsTried: z.string().max(LIMITS.actionsTriedMaxChars).optional(),
  modelLabel: z.string().max(LIMITS.modelLabelMaxChars).nullable().optional(),
});
export type PatchCaseRequest = z.infer<typeof PatchCaseRequest>;

/** POST /api/cases, GET/PATCH /api/cases/:id */
export const CaseResponse = z.object({ case: CaseDetail });
export type CaseResponse = z.infer<typeof CaseResponse>;
