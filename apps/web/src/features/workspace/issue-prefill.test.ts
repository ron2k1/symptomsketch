import { describe, expect, it } from "vitest";
import { issuePrefill, type IssuePrefillInput } from "./issue-prefill";

const EXAMPLE = "It stops, then jerks backward once.";

function input(over: Partial<IssuePrefillInput> = {}): IssuePrefillInput {
  return {
    ownerRole: "customer",
    mode: "problem",
    locked: false,
    offered: false,
    savedAccount: "",
    draftAccount: "",
    exampleIssue: EXAMPLE,
    ...over,
  };
}

describe("issuePrefill", () => {
  it("offers the catalog example for an empty customer problem case", () => {
    expect(issuePrefill(input())).toBe(EXAMPLE);
  });

  it("trims the example and ignores a blank one", () => {
    expect(issuePrefill(input({ exampleIssue: `  ${EXAMPLE}\n` }))).toBe(EXAMPLE);
    expect(issuePrefill(input({ exampleIssue: "   " }))).toBeNull();
    expect(issuePrefill(input({ exampleIssue: null }))).toBeNull();
    expect(issuePrefill(input({ exampleIssue: undefined }))).toBeNull();
  });

  it("never overwrites words the customer already typed or saved", () => {
    expect(issuePrefill(input({ draftAccount: "It beeps" }))).toBeNull();
    expect(issuePrefill(input({ savedAccount: "It beeps" }))).toBeNull();
  });

  it("offers it only once, so clearing the box keeps it empty", () => {
    expect(issuePrefill(input({ offered: true }))).toBeNull();
  });

  it("skips locked accounts, support cases and solution mode", () => {
    expect(issuePrefill(input({ locked: true }))).toBeNull();
    expect(issuePrefill(input({ ownerRole: "support" }))).toBeNull();
    expect(issuePrefill(input({ mode: "solution" }))).toBeNull();
  });
});
