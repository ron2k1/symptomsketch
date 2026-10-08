import { z } from "zod";
import { ClientRequestId, Id, Purpose, Timestamp } from "./common.ts";
import { LIMITS } from "./limits.ts";
import { HighlightSpan, Message } from "./messages.ts";

/** Where a required constraint comes from. Server resolves quotes against exact stored records. */
export const ConstraintSourceKind = z.enum([
  "account",
  "actions_tried",
  "correction",
  "answer",
  "procedure",
  "reference",
]);
export type ConstraintSourceKind = z.infer<typeof ConstraintSourceKind>;

export const ConstraintSource = z.object({
  kind: ConstraintSourceKind,
  quote: z.string().nullable(),
  /** Message the quote came from (server-filled; never trusted from the model). */
  messageId: Id.nullable().optional(),
  /** 0-based procedure step for kind=procedure. */
  stepIndex: z.number().int().nonnegative().nullable().optional(),
});
export type ConstraintSource = z.infer<typeof ConstraintSource>;

/** A required visible constraint; the critic must check every one by `id` (spec 9). */
export const RequiredConstraint = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,47}$/),
  expected: z.string().min(1).max(200),
  critical: z.boolean(),
  source: ConstraintSource,
});
export type RequiredConstraint = z.infer<typeof RequiredConstraint>;

export const SelectedAction = z.object({
  subject: z.string(),
  startingState: z.string(),
  action: z.string(),
  direction: z.string().nullable(),
  repetitions: z.number().int().positive().nullable(),
  timing: z.string().nullable(),
  magnitude: z.string().nullable(),
  endingState: z.string(),
});
export type SelectedAction = z.infer<typeof SelectedAction>;

export const SourceReference = z.object({
  kind: z.enum(["procedure", "account", "reference"]),
  label: z.string(),
  quote: z.string().nullable(),
  stepIndex: z.number().int().nonnegative().nullable().optional(),
});
export type SourceReference = z.infer<typeof SourceReference>;

/** Structured action plan (spec 10 example). Ids are filled from owned server records. */
export const ActionPlan = z.object({
  schemaVersion: z.literal(1),
  purpose: Purpose,
  productRevisionId: Id,
  procedureRevisionId: Id.nullable(),
  selectedAction: SelectedAction,
  context: z.object({
    reportedFrequency: z.string().nullable(),
    actionsTried: z.array(z.string()),
    unresolved: z.array(z.string()),
  }),
  /** Solution mode: source-supported prerequisites shown on screen. Empty in problem mode. */
  prerequisites: z.array(z.string()),
  invariants: z.array(z.string()),
  requiredConstraints: z.array(RequiredConstraint).min(1),
  understanding: z.string(),
  preservedDetails: z.array(z.string()),
  caption: z.string().min(1).max(LIMITS.captionMaxChars),
  sourceReferences: z.array(SourceReference),
  clarificationQuestion: z.string().nullable(),
});
export type ActionPlan = z.infer<typeof ActionPlan>;

export const PlanStatus = z.enum(["ready", "needs_clarification", "invalid"]);
export type PlanStatus = z.infer<typeof PlanStatus>;

/** Persisted plan revision DTO. A text/reference correction always creates a new revision. */
export const PlanRevision = z.object({
  id: Id,
  caseId: Id,
  parentId: Id.nullable(),
  purpose: Purpose,
  productRevisionId: Id,
  procedureRevisionId: Id.nullable(),
  plan: ActionPlan,
  /** Server-compiled X2 prompt (<= reactorPromptMaxChars). Null unless status is ready. */
  reactorPrompt: z.string().max(LIMITS.reactorPromptMaxChars).nullable(),
  caption: z.string().max(LIMITS.captionMaxChars),
  status: PlanStatus,
  /** Why the plan is invalid (deterministic validation messages), empty otherwise. */
  validationIssues: z.array(z.string()),
  createdAt: Timestamp,
});
export type PlanRevision = z.infer<typeof PlanRevision>;

/**
 * Direct edit of one or more structured details (selecting a highlight -> editing its field).
 * Goes through the same planner path as a text correction and preserves untouched constraints.
 * `null` clears a detail; an omitted key leaves it unchanged.
 */
export const PlanFieldEdits = z
  .object({
    direction: z.string().trim().min(1).max(60).nullable().optional(),
    repetitions: z.number().int().min(1).max(10).nullable().optional(),
    timing: z.string().trim().min(1).max(80).nullable().optional(),
    magnitude: z.string().trim().min(1).max(60).nullable().optional(),
  })
  .refine((e) => Object.values(e).some((v) => v !== undefined), {
    message: "at least one field edit is required",
  });
export type PlanFieldEdits = z.infer<typeof PlanFieldEdits>;

/**
 * POST /api/cases/:id/plans
 * - initial plan: parentPlanId null, correction null (uses the case account / procedure)
 * - correction or clarification answer: parentPlanId = current plan id, correction = text
 * - field edit: parentPlanId = current plan id, fieldEdits = {...} (correction may be null)
 * A stale parentPlanId (not the current pointer for that purpose) -> 409 PLAN_CONFLICT.
 */
export const CreatePlanRequest = z.object({
  purpose: Purpose,
  parentPlanId: Id.nullable(),
  correction: z.string().min(1).max(LIMITS.composerMaxChars).nullable(),
  /** True when `correction` answers the parent plan's clarification question. */
  isClarificationAnswer: z.boolean().optional(),
  /** Structured detail edits applied through the planner (requires parentPlanId). */
  fieldEdits: PlanFieldEdits.optional(),
  clientRequestId: ClientRequestId,
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;

/** Planner result shown as What I understood / What will stay the same / What is still unclear. */
export const PlannerResult = z.object({
  planRevision: PlanRevision,
  understanding: z.string(),
  preserved: z.array(z.string()),
  unclear: z.array(z.string()),
  clarificationQuestion: z.string().nullable(),
  /** Validated spans (also attached to the messages they belong to). */
  highlights: z.array(HighlightSpan),
  /** Messages created by this request (user correction + planner explanation), in order. */
  messages: z.array(Message),
});
export type PlannerResult = z.infer<typeof PlannerResult>;
export type CreatePlanResponse = PlannerResult;

/** POST /api/cases/:id/reactor-token: requires a ready plan; acquires a preview lease. */
export const ReactorTokenRequest = z.object({
  planRevisionId: Id,
  clientRequestId: ClientRequestId,
});
export type ReactorTokenRequest = z.infer<typeof ReactorTokenRequest>;

export const ReactorTokenResponse = z.object({
  /** Short-lived Reactor JWT for X2Provider `jwtToken`. Never log it. */
  jwt: z.string().min(1),
  expiresAt: Timestamp.nullable(),
  leaseId: Id,
  leaseExpiresAt: Timestamp,
  /** The compiled prompt for planRevisionId (same as PlanRevision.reactorPrompt). */
  reactorPrompt: z.string(),
});
export type ReactorTokenResponse = z.infer<typeof ReactorTokenResponse>;

/** POST /api/cases/:id/preview-lease: heartbeat keeps capacity; release frees it. */
export const PreviewLeaseRequest = z.object({
  leaseId: Id,
  action: z.enum(["heartbeat", "release"]),
});
export type PreviewLeaseRequest = z.infer<typeof PreviewLeaseRequest>;

export const PreviewLeaseResponse = z.object({
  leaseId: Id,
  active: z.boolean(),
  expiresAt: Timestamp.nullable(),
  liveScenesInUse: z.number().int().nonnegative(),
  liveScenesMax: z.number().int().positive(),
});
export type PreviewLeaseResponse = z.infer<typeof PreviewLeaseResponse>;
