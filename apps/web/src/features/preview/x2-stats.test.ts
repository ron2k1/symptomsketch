import { describe, expect, it } from "vitest";
import { EMPTY_STATS, formatClock, linkStatsFrom, readoutCells } from "./x2-stats";

describe("linkStatsFrom (SDK statsUpdate sample)", () => {
  // Shaped like the SDK's ConnectionStats, which carries more fields than the readout reads.
  const measuredSample = {
    rtt: 41.6,
    framesPerSecond: 23.97,
    packetLossRatio: 0,
    connectionTimings: { sessionCreationMs: 300, transportConnectingMs: 900, totalMs: 2_140 },
    timestamp: 1,
  };
  const emptySample = { timestamp: 1 };
  const brokenSample = {
    rtt: Number.NaN,
    framesPerSecond: -1,
    connectionTimings: { sessionCreationMs: 0, transportConnectingMs: 0, totalMs: Infinity },
    timestamp: 1,
  };

  it("keeps measured fps, rtt and connect time", () => {
    expect(linkStatsFrom(measuredSample)).toEqual({ fps: 23.97, rttMs: 41.6, connectMs: 2_140 });
  });

  it("hides anything the browser could not measure", () => {
    expect(linkStatsFrom(emptySample)).toEqual({ fps: null, rttMs: null, connectMs: null });
    expect(linkStatsFrom(brokenSample)).toEqual({ fps: null, rttMs: null, connectMs: null });
  });
});

describe("formatClock", () => {
  it("shows minutes:seconds, with hours once past an hour", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(252_400)).toBe("4:12");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("readoutCells", () => {
  it("formats every measured value with its unit", () => {
    const cells = readoutCells({
      stats: { fps: 23.97, rttMs: 41.6, connectMs: 2_140, appliedMs: 118.4 },
      plannedMs: 6_080,
      sessionMs: 252_400,
    });
    expect(cells).toEqual([
      { key: "session", label: "Live for", value: "4:12" },
      { key: "fps", label: "Output", value: "24.0 fps" },
      { key: "rtt", label: "Round trip", value: "42 ms" },
      { key: "planned", label: "Gemini planned in", value: "6.1 s" },
      { key: "applied", label: "X2 applied in", value: "118 ms" },
      { key: "connect", label: "Connected in", value: "2.1 s" },
    ]);
  });

  it("omits every value that is not measured instead of showing a placeholder", () => {
    expect(readoutCells({ stats: EMPTY_STATS, plannedMs: null, sessionMs: null })).toEqual([]);
    expect(
      readoutCells({ stats: { ...EMPTY_STATS, rttMs: 0.4 }, plannedMs: null, sessionMs: null }),
    ).toEqual([{ key: "rtt", label: "Round trip", value: "<1 ms" }]);
  });
});
