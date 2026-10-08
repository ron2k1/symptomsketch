import { describe, expect, it } from "vitest";
import { LIMITS } from "@symptomsketch/contracts";
import { LIVE_POLICY, evaluateLivePolicy, reconnectDelayMs } from "./live-policy";

const MIN = 60_000;
const visible = { connectionOpenedAt: 0, hiddenSince: null, reconnecting: false };

describe("LIVE_POLICY", () => {
  it("rotates before the server's 5 minute lease cap and stops after 2 hidden minutes", () => {
    expect(LIVE_POLICY.connectionMaxMs).toBe(LIMITS.previewMaxMs);
    expect(LIVE_POLICY.rotateLeadMs).toBeGreaterThan(LIMITS.previewHeartbeatMs);
    expect(LIVE_POLICY.hiddenStopMs).toBe(2 * MIN);
  });
});

describe("evaluateLivePolicy (infinite preview)", () => {
  it("never stops a visible preview for inactivity", () => {
    expect(evaluateLivePolicy({ ...visible, now: 90_000 })).toEqual({ kind: "ok" });
    expect(evaluateLivePolicy({ ...visible, now: 4 * MIN })).toEqual({ kind: "ok" });
  });

  it("rotates to a fresh connection 20 s before the lease cap", () => {
    expect(evaluateLivePolicy({ ...visible, now: 5 * MIN - 20_001 })).toEqual({ kind: "ok" });
    expect(evaluateLivePolicy({ ...visible, now: 5 * MIN - 20_000 })).toEqual({ kind: "rotate" });
    // Rotation counts from the current connection, so it repeats forever.
    expect(
      evaluateLivePolicy({ ...visible, connectionOpenedAt: 280_000, now: 280_000 + 4 * MIN }),
    ).toEqual({ kind: "ok" });
  });

  it("stops after 2 minutes in a background tab", () => {
    const hidden = { ...visible, hiddenSince: 10_000 };
    expect(evaluateLivePolicy({ ...hidden, now: 10_000 + 2 * MIN - 1 })).toEqual({ kind: "ok" });
    expect(evaluateLivePolicy({ ...hidden, now: 10_000 + 2 * MIN })).toEqual({
      kind: "stop",
      reason: "hidden",
    });
  });

  it("rotates on time in a hidden tab instead of stopping early at the lease cap", () => {
    // Hidden one second before rotation was due: the old policy stopped 15 s later as "hidden".
    const hidden = { ...visible, hiddenSince: 279_000 };
    expect(evaluateLivePolicy({ ...hidden, now: 280_000 })).toEqual({ kind: "rotate" });
    expect(evaluateLivePolicy({ ...hidden, now: 295_000 })).toEqual({ kind: "rotate" });
    // The 2 minute hidden stop still applies.
    expect(evaluateLivePolicy({ ...hidden, now: 279_000 + 2 * MIN })).toEqual({
      kind: "stop",
      reason: "hidden",
    });
  });

  it("does not rotate while a reconnect is already under way, but still honours the hidden stop", () => {
    const busy = { ...visible, reconnecting: true };
    expect(evaluateLivePolicy({ ...busy, now: 6 * MIN })).toEqual({ kind: "ok" });
    expect(evaluateLivePolicy({ ...busy, connectionOpenedAt: null, now: 6 * MIN })).toEqual({
      kind: "ok",
    });
    expect(evaluateLivePolicy({ ...busy, hiddenSince: 0, now: 2 * MIN })).toEqual({
      kind: "stop",
      reason: "hidden",
    });
  });
});

describe("reconnectDelayMs", () => {
  it("rotates immediately, backs off on unplanned drops, then gives up", () => {
    expect(reconnectDelayMs(0)).toBe(0);
    expect(reconnectDelayMs(1)).toBe(1_000);
    expect(reconnectDelayMs(2)).toBe(3_000);
    expect(reconnectDelayMs(3)).toBe(8_000);
    expect(reconnectDelayMs(4)).toBeNull();
  });
});
