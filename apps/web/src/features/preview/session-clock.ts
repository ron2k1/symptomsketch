import { LIMITS } from "@symptomsketch/contracts";

/** The visible Continue preview prompt appears this long before the idle stop (spec 8). */
export const IDLE_WARNING_LEAD_MS = 15_000;

export interface SessionClockInput {
  now: number;
  /** When the preview session started (token minted). */
  startedAt: number;
  /** Last explicit user activity (start, Continue preview, correction, record). */
  lastActivityAt: number;
  /** A take is being captured or uploaded: never stop mid-capture (capture ends the session itself). */
  busy: boolean;
  idleMs?: number;
  maxMs?: number;
  warnLeadMs?: number;
}

export type SessionClockVerdict =
  | { kind: "ok" }
  | { kind: "idle_warning"; msLeft: number }
  | { kind: "stop"; reason: "idle" | "max" };

/** Pure idle (90 s) + max (5 min) policy for a live preview. */
export function evaluateSessionClock(input: SessionClockInput): SessionClockVerdict {
  const idleMs = input.idleMs ?? LIMITS.previewIdleMs;
  const maxMs = input.maxMs ?? LIMITS.previewMaxMs;
  const warnLeadMs = input.warnLeadMs ?? IDLE_WARNING_LEAD_MS;
  if (input.busy) return { kind: "ok" };
  if (input.now - input.startedAt >= maxMs) return { kind: "stop", reason: "max" };
  const idle = input.now - input.lastActivityAt;
  if (idle >= idleMs) return { kind: "stop", reason: "idle" };
  if (idle >= idleMs - warnLeadMs) return { kind: "idle_warning", msLeft: idleMs - idle };
  return { kind: "ok" };
}
