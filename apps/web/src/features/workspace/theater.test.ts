import { describe, expect, it } from "vitest";
import { PREVIEW_STATUSES } from "@symptomsketch/contracts";
import { isTheaterLayout } from "./state";

describe("isTheaterLayout", () => {
  it("keeps the three-column layout while the preview is off and no take is shown", () => {
    expect(isTheaterLayout("idle", false)).toBe(false);
  });

  it("gives the Reactor stage the width once a session starts, through every active state", () => {
    for (const status of PREVIEW_STATUSES) {
      if (status === "idle") continue;
      expect(isTheaterLayout(status, false), status).toBe(true);
    }
  });

  it("stays in theater while a saved take is on the stage", () => {
    expect(isTheaterLayout("idle", true)).toBe(true);
  });
});
