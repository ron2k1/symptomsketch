import { describe, expect, it } from "vitest";
import { latestPlanRequest, type PlanTimingEntry } from "./plan-timing";

const ORIGIN = "http://127.0.0.1:5173";

function entry(over: Partial<PlanTimingEntry> & { name: string }): PlanTimingEntry {
  return {
    initiatorType: "fetch",
    startTime: 1_000,
    responseEnd: 7_080,
    responseStatus: 201,
    ...over,
  };
}

describe("latestPlanRequest (Resource Timing for POST /api/cases/:id/plans)", () => {
  it("measures the planner request of this case", () => {
    expect(
      latestPlanRequest([entry({ name: `${ORIGIN}/api/cases/case_1/plans` })], "case_1"),
    ).toEqual({ endedAt: 7_080, ms: 6_080 });
  });

  it("picks the most recently finished plan request", () => {
    const got = latestPlanRequest(
      [
        entry({ name: `${ORIGIN}/api/cases/case_1/plans`, startTime: 50_000, responseEnd: 54_500 }),
        entry({ name: `${ORIGIN}/api/cases/case_1/plans`, startTime: 1_000, responseEnd: 7_080 }),
      ],
      "case_1",
    );
    expect(got).toEqual({ endedAt: 54_500, ms: 4_500 });
  });

  it("ignores other cases, other routes, failed or unfinished requests and non-fetch loads", () => {
    const got = latestPlanRequest(
      [
        entry({ name: `${ORIGIN}/api/cases/case_2/plans`, responseEnd: 90_000 }),
        entry({ name: `${ORIGIN}/api/cases/case_1/plans/extra`, responseEnd: 90_000 }),
        entry({ name: `${ORIGIN}/api/cases/case_1/takes`, responseEnd: 90_000 }),
        entry({
          name: `${ORIGIN}/api/cases/case_1/plans`,
          responseStatus: 502,
          responseEnd: 90_000,
        }),
        entry({ name: `${ORIGIN}/api/cases/case_1/plans`, responseEnd: 0 }),
        entry({
          name: `${ORIGIN}/api/cases/case_1/plans`,
          initiatorType: "img",
          responseEnd: 90_000,
        }),
        entry({ name: "not a url", responseEnd: 90_000 }),
      ],
      "case_1",
    );
    expect(got).toBeNull();
  });

  it("accepts browsers that do not expose responseStatus, and encodes the case id", () => {
    const got = latestPlanRequest(
      [entry({ name: `${ORIGIN}/api/cases/a%20b/plans?x=1`, responseStatus: undefined })],
      "a b",
    );
    expect(got).toEqual({ endedAt: 7_080, ms: 6_080 });
  });
});
