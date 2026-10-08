import { LIMITS } from "@symptomsketch/contracts";

/**
 * Infinite preview: a started preview keeps generating until the user stops it, leaves the case,
 * or the tab stays hidden. The server caps one lease (and its X2 session) at LIMITS.previewMaxMs,
 * so the controller rotates to a fresh token + connection shortly before that cap.
 */
export const LIVE_POLICY = {
  /** A background tab stops the preview after this long (no generation for nobody). */
  hiddenStopMs: 120_000,
  /** The server stops heartbeating a lease this long after it was created. */
  connectionMaxMs: LIMITS.previewMaxMs,
  /** Rotate this long before the cap: covers a token mint, connect and first frame. */
  rotateLeadMs: 20_000,
  /** A hidden tab past its rotation time stops this long before the lease lapses. */
  leaseMarginMs: 5_000,
  /** Waits before reconnect attempts 1..n after unplanned drops; then the preview gives up. */
  reconnectBackoffMs: [1_000, 3_000, 8_000] as readonly number[],
  /** Fresh output this long after a reconnect resets the drop counter. */
  stableAfterMs: 30_000,
} as const;

export type LivePolicy = typeof LIVE_POLICY;

export interface LivePolicyInput {
  now: number;
  /** When the current connection's token was requested; null while none is open. */
  connectionOpenedAt: number | null;
  /** When the tab became hidden; null while visible. */
  hiddenSince: number | null;
  /** A reconnect or rotation is already under way. */
  reconnecting: boolean;
}

export type LiveVerdict = { kind: "ok" } | { kind: "rotate" } | { kind: "stop"; reason: "hidden" };

/** Pure watchdog policy, evaluated every second while a preview runs. */
export function evaluateLivePolicy(
  input: LivePolicyInput,
  policy: LivePolicy = LIVE_POLICY,
): LiveVerdict {
  const { now, connectionOpenedAt, hiddenSince } = input;
  if (hiddenSince !== null && now - hiddenSince >= policy.hiddenStopMs) {
    return { kind: "stop", reason: "hidden" };
  }
  if (input.reconnecting || connectionOpenedAt === null) return { kind: "ok" };
  const age = now - connectionOpenedAt;
  if (age < policy.connectionMaxMs - policy.rotateLeadMs) return { kind: "ok" };
  if (hiddenSince === null) return { kind: "rotate" };
  // Hidden tabs throttle timers and skip video frame callbacks, so a reconnect there could stall:
  // hold the rotation until the tab is back, unless the lease would lapse first.
  if (age >= policy.connectionMaxMs - policy.leaseMarginMs) {
    return { kind: "stop", reason: "hidden" };
  }
  return { kind: "ok" };
}

/**
 * Wait before reconnecting. `drops` counts consecutive unplanned drops (0 = planned rotation).
 * Null means give up and surface the disconnect.
 */
export function reconnectDelayMs(drops: number, policy: LivePolicy = LIVE_POLICY): number | null {
  if (drops <= 0) return 0;
  return policy.reconnectBackoffMs[drops - 1] ?? null;
}

/** User-facing copy owned by the live preview (labels.ts belongs to the workspace copy owner). */
export const LIVE_COPY = {
  reconnecting: "Reconnecting to Reactor X2",
  reconnectingDetail: "Switching to a fresh Reactor X2 session. The current plan is reapplied.",
  hiddenStop:
    "Preview stopped after 2 minutes in a background tab. Start it again when you are ready.",
} as const;
