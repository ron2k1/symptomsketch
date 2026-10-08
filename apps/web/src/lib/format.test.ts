import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatTakeNumber } from "./format";

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(8 * 1024 * 1024)).toBe("8.0 MB");
    expect(formatBytes(null)).toBe("-");
  });
  it("formats durations", () => {
    expect(formatDuration(8200)).toBe("0:08");
    expect(formatDuration(75_000)).toBe("1:15");
  });
  it("formats take numbers", () => {
    expect(formatTakeNumber(3)).toBe("Take 03");
  });
});
