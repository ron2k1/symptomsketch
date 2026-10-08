import { useEffect, useRef } from "react";
import { LIMITS, type Take } from "@symptomsketch/contracts";
import { getTake } from "@/lib/api";

/** Poll cadence while a take converts or its visual check runs (2-3 s). */
export const TAKE_POLL_MS = 2_500;
/** The server queues the check after export; give it this long to appear before offering a button. */
const ASSESSMENT_APPEAR_GRACE_MS = 60_000;

export function isTakeProcessing(take: Take): boolean {
  return (
    take.processingState === "uploading" ||
    take.processingState === "queued" ||
    take.processingState === "converting"
  );
}

export function isAssessmentPending(take: Take): boolean {
  return take.currentAssessment?.uiStatus === "pending";
}

/** True when GET /api/takes/:id can still change what the UI shows for this take. */
export function needsPolling(take: Take, now: number = Date.now()): boolean {
  if (take.captureStatus === "incomplete") return false;
  if (isTakeProcessing(take)) return true;
  if (take.processingState !== "ready") return false;
  if (isAssessmentPending(take)) return true;
  if (take.currentAssessment === null) {
    return now - Date.parse(take.updatedAt) < ASSESSMENT_APPEAR_GRACE_MS;
  }
  return false;
}

/**
 * Polls every take that is processing or being checked, backing off on errors, and reports each
 * fresh take. Stops as soon as nothing needs polling.
 */
export function useTakePolling(takes: readonly Take[], onUpdate: (take: Take) => void): void {
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });
  const ids = takes
    .filter((t) => needsPolling(t))
    .map((t) => t.id)
    .join(",");

  useEffect(() => {
    if (!ids) return;
    const list = ids.split(",");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = TAKE_POLL_MS;

    async function tick() {
      let failed = false;
      await Promise.all(
        list.map(async (id) => {
          try {
            const res = await getTake(id, { signal: controller.signal });
            if (!controller.signal.aborted) onUpdateRef.current(res.take);
          } catch {
            failed = true;
          }
        }),
      );
      if (controller.signal.aborted) return;
      delay = failed ? Math.min(delay * 2, LIMITS.pollMaxBackoffMs) : TAKE_POLL_MS;
      timer = setTimeout(() => void tick(), delay);
    }

    timer = setTimeout(() => void tick(), TAKE_POLL_MS);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [ids]);
}
