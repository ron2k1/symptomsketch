import { useEffect, useState } from "react";
import { paths } from "@symptomsketch/contracts";

/**
 * "Gemini planned in N s" from the browser's Resource Timing of POST /api/cases/:id/plans (the only
 * client call on that path, lib/api.ts). It measures the real planner round trip without touching
 * the workspace code that issues it.
 */
export interface PlanTimingEntry {
  name: string;
  initiatorType: string;
  startTime: number;
  responseEnd: number;
  /** Missing in browsers without Resource Timing response status. */
  responseStatus?: number | undefined;
}

export interface PlanTiming {
  /** performance.now() when the plan response finished. */
  endedAt: number;
  /** Gemini planning time; null when the latest response was a cached replay. */
  ms: number | null;
  /** 200 = idempotent replay of a stored plan (no Gemini call), 201 = planned by Gemini. */
  cached: boolean;
}

const FETCH_INITIATORS = new Set(["fetch", "xmlhttprequest"]);

export function latestPlanRequest(
  entries: readonly PlanTimingEntry[],
  caseId: string,
): PlanTiming | null {
  const target = paths.casePlans(caseId);
  let best: PlanTiming | null = null;
  for (const e of entries) {
    if (!FETCH_INITIATORS.has(e.initiatorType) || !(e.responseEnd > 0)) continue;
    // Only 201 is a fresh Gemini plan; 200 replays a stored one. Without a status we cannot tell.
    if (e.responseStatus !== 201 && e.responseStatus !== 200) continue;
    if (pathnameOf(e.name) !== target) continue;
    if (!best || e.responseEnd > best.endedAt) {
      const cached = e.responseStatus === 200;
      best = { endedAt: e.responseEnd, ms: cached ? null : e.responseEnd - e.startTime, cached };
    }
  }
  return best;
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Latest planner timing for this case; null until one is observed or when unsupported. */
export function usePlanRequestTiming(caseId: string): PlanTiming | null {
  const [timing, setTiming] = useState<PlanTiming | null>(null);
  useEffect(() => {
    setTiming(null);
    if (typeof PerformanceObserver === "undefined") return;
    let latest: PlanTiming | null = null;
    const take = (list: readonly PlanTimingEntry[]) => {
      const found = latestPlanRequest(list, caseId);
      if (found && (!latest || found.endedAt > latest.endedAt)) {
        latest = found;
        setTiming(found);
      }
    };
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) =>
        take(list.getEntries() as unknown as PlanTimingEntry[]),
      );
      observer.observe({ type: "resource", buffered: true });
    } catch {
      return;
    }
    return () => observer?.disconnect();
  }, [caseId]);
  return timing;
}
