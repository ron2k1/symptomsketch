import type { Purpose, Role } from "@symptomsketch/contracts";

export interface IssuePrefillInput {
  ownerRole: Role;
  mode: Purpose;
  /** The account is locked after the first plan. */
  locked: boolean;
  /** The example was already offered for this case (clearing the box must keep it empty). */
  offered: boolean;
  /** caseData.originalAccount as saved on the server. */
  savedAccount: string;
  /** The unsaved Issue draft. */
  draftAccount: string;
  /** Catalog fixture's authored example issue (demo products only). */
  exampleIssue: string | null | undefined;
}

/**
 * The editable default for "What happened" on a demo product: the catalog's exampleIssue, offered
 * once, only into an empty, unlocked customer problem account. Null means leave the box alone.
 */
export function issuePrefill(i: IssuePrefillInput): string | null {
  const example = i.exampleIssue?.trim() ?? "";
  if (!example || i.offered || i.locked) return null;
  if (i.ownerRole !== "customer" || i.mode !== "problem") return null;
  if (i.savedAccount.trim() || i.draftAccount.trim()) return null;
  return example;
}
