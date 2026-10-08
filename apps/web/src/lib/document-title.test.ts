import { describe, expect, it } from "vitest";
import { pageTitle } from "./document-title";

describe("pageTitle", () => {
  it("prefixes the app name with a pipe", () => {
    expect(pageTitle("Support inbox")).toBe("SymptomSketch | Support inbox");
  });

  it("joins detail parts and drops empty ones", () => {
    expect(pageTitle("Recreate", null, " ", "Robot vacuum")).toBe(
      "SymptomSketch | Recreate · Robot vacuum",
    );
  });

  it("falls back to the bare app name", () => {
    expect(pageTitle()).toBe("SymptomSketch");
    expect(pageTitle(undefined, "")).toBe("SymptomSketch");
  });
});
