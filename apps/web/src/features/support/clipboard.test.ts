import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

describe("copyToClipboard", () => {
  afterEach(() => setClipboard(undefined));

  it("resolves true only after the browser accepts the write", async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("resolves false (manual-copy fallback) when the write is denied", async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error("denied"))) });
    await expect(copyToClipboard("hello")).resolves.toBe(false);
  });

  it("resolves false when the Clipboard API is unavailable", async () => {
    setClipboard(undefined);
    await expect(copyToClipboard("hello")).resolves.toBe(false);
  });
});
