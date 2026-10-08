import { z } from "zod";
import { Id, Timestamp } from "./common.ts";
import { LIMITS } from "./limits.ts";

/** Approved procedure revision used as the source in solution mode (spec 3, 5, 10). */
export const ProcedureRevision = z.object({
  id: Id,
  caseId: Id,
  productRevisionId: Id,
  title: z.string(),
  /** Company procedure id / manual page+step / authored demo id, e.g. SS-DEMO-RV-01. */
  procedureCode: z.string().nullable(),
  approvedText: z.string(),
  steps: z.array(z.string()),
  sourceDescription: z.string(),
  modelApplicabilityConfirmed: z.boolean(),
  createdAt: Timestamp,
});
export type ProcedureRevision = z.infer<typeof ProcedureRevision>;

/** POST /api/cases/:id/procedures */
export const CreateProcedureRequest = z.object({
  title: z.string().min(1).max(LIMITS.procedureTitleMaxChars),
  procedureCode: z.string().max(120).nullable().optional(),
  approvedText: z.string().min(1).max(LIMITS.procedureTextMaxChars),
  /** Optional pre-split steps; server splits approvedText by line when omitted. */
  steps: z.array(z.string().min(1).max(1000)).max(30).optional(),
  sourceDescription: z.string().min(1).max(LIMITS.sourceDescriptionMaxChars),
  modelApplicabilityConfirmed: z.boolean(),
  /** Prefill from the catalog fixture's authored procedure instead of pasted text. */
  fixtureProcedureId: z.string().nullable().optional(),
});
export type CreateProcedureRequest = z.infer<typeof CreateProcedureRequest>;

export const CreateProcedureResponse = z.object({ procedure: ProcedureRevision });
export type CreateProcedureResponse = z.infer<typeof CreateProcedureResponse>;
