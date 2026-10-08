import { describe, expect, it } from "vitest";
import { stageErrorFrom } from "./preview-errors";
import { PreviewFailure } from "./x2-preview";

describe("stageErrorFrom", () => {
  it("names Reactor X2 when it rejects the photo or the movement", () => {
    for (const code of ["invalid_image", "invalid_command"]) {
      const { detail } = stageErrorFrom(new PreviewFailure(code, "prompt"));
      expect(detail, code).toMatch(/Reactor X2/);
      expect(detail, code).not.toMatch(/visual workspace/i);
    }
  });

  it("falls back to the Reactor X2 unavailable copy for unknown failures", () => {
    expect(stageErrorFrom(new Error("boom")).detail).toMatch(/Reactor X2/);
  });
});
