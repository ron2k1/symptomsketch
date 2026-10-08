import { useCallback, useMemo } from "react";
import type { CaseDetail, Take } from "@symptomsketch/contracts";
import { getCase } from "@/lib/api";
import { acceptedTakes, isAuthError } from "./model";
import { usePolling } from "./usePolling";

export interface WorkCaseTake {
  workCaseId: string;
  take: Take;
}

/** Work cases change only when the agent records in another view; a slower re-read is enough. */
const WORK_CASE_POLL_MS = 10_000;

async function loadWorkCases(ids: readonly string[], signal: AbortSignal): Promise<CaseDetail[]> {
  const results = await Promise.allSettled(ids.map((id) => getCase(id, { signal })));
  const cases: CaseDetail[] = [];
  let firstError: unknown = null;
  for (const r of results) {
    if (r.status === "fulfilled") cases.push(r.value.case);
    else firstError ??= r.reason;
  }
  if (cases.length === 0 && firstError !== null) throw firstError;
  return cases;
}

/**
 * Accepted solution takes of this ticket's agent work cases (GET /api/cases/:workCaseId), the only
 * takes a reply may attach. The server re-validates ownership, lineage, hash and review on POST.
 */
export function useWorkCaseTakes(workCaseIds: readonly string[], enabled: boolean) {
  const key = workCaseIds.length > 0 ? workCaseIds.join(",") : null;
  const fetcher = useCallback(
    (signal: AbortSignal) => loadWorkCases(key ? key.split(",") : [], signal),
    [key],
  );
  const poll = usePolling(key, fetcher, {
    enabled,
    intervalMs: WORK_CASE_POLL_MS,
    stopOn: isAuthError,
  });

  const takes = useMemo<WorkCaseTake[]>(
    () =>
      (poll.data ?? []).flatMap((c) =>
        acceptedTakes(c.takes, "solution").map((take) => ({ workCaseId: c.id, take })),
      ),
    [poll.data],
  );

  return {
    takes,
    loading: poll.loading,
    error: poll.error,
    refresh: poll.refresh,
  };
}
