import { describe, expect, it } from "vitest";
import { LIMITS } from "@symptomsketch/contracts";
import { precheckPhoto } from "./photo-check";

const file = (name: string, type: string, size: number) => ({ name, type, size });

describe("precheckPhoto", () => {
  it("accepts JPEG, PNG and WebP within the limit", () => {
    expect(precheckPhoto(file("a.jpg", "image/jpeg", 1000))).toEqual({
      ok: true,
      mime: "image/jpeg",
    });
    expect(precheckPhoto(file("a.png", "image/png", LIMITS.uploadMaxBytes)).ok).toBe(true);
    expect(precheckPhoto(file("a.webp", "image/webp", 5)).ok).toBe(true);
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(precheckPhoto(file("photo.JPEG", "", 2048))).toEqual({ ok: true, mime: "image/jpeg" });
  });

  it("rejects other types, empty files and files over 10 MiB", () => {
    expect(precheckPhoto(file("a.heic", "image/heic", 1000)).ok).toBe(false);
    expect(precheckPhoto(file("a.mp4", "video/mp4", 1000)).ok).toBe(false);
    expect(precheckPhoto(file("a.png", "image/png", 0)).ok).toBe(false);
    const big = precheckPhoto(file("a.png", "image/png", LIMITS.uploadMaxBytes + 1));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.message).toContain("limit");
  });
});
