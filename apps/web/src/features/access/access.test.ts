import { describe, expect, it } from "vitest";
import type { SessionState } from "@symptomsketch/contracts";
import { hasCustomerAccess } from "./access";

const base: SessionState = {
  authenticated: true,
  role: "customer",
  accessGranted: true,
  expiresAt: "2026-10-15T17:44:18.743Z",
};

describe("hasCustomerAccess", () => {
  it("accepts a customer session that entered the code", () => {
    expect(hasCustomerAccess(base)).toBe(true);
  });

  it("asks a customer without the code for it", () => {
    expect(hasCustomerAccess({ ...base, accessGranted: false })).toBe(false);
  });

  it("asks a support login for the customer code, so the case is not a staff work case", () => {
    expect(hasCustomerAccess({ ...base, role: "support" })).toBe(false);
  });

  it("asks a browser with no session", () => {
    expect(
      hasCustomerAccess({
        authenticated: false,
        role: null,
        accessGranted: false,
        expiresAt: null,
      }),
    ).toBe(false);
  });
});
