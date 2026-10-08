import { describe, expect, it } from "vitest";
import type { CaseDetail, PlanRevision, ProcedureRevision } from "@symptomsketch/contracts";
import { procedureForPhoto, stageNextStep } from "./state";

const PHOTO = "pr_now";

/** Only the fields the stage step reads; the rest of CaseDetail is irrelevant here. */
function caseWith(over: Partial<CaseDetail>): CaseDetail {
  return {
    product: { id: PHOTO },
    productRevisionId: PHOTO,
    originalAccount: "",
    procedures: [],
    plans: [],
    problemPlanId: null,
    solutionPlanId: null,
    ...over,
  } as unknown as CaseDetail;
}

function plan(over: Partial<PlanRevision>): PlanRevision {
  return {
    id: "pl_1",
    purpose: "problem",
    productRevisionId: PHOTO,
    status: "ready",
    reactorPrompt: "prompt",
    ...over,
  } as unknown as PlanRevision;
}

function procedure(id: string, productRevisionId: string): ProcedureRevision {
  return { id, productRevisionId } as unknown as ProcedureRevision;
}

describe("stageNextStep", () => {
  it("offers nothing without a photo (the empty stage asks for one)", () => {
    expect(stageNextStep(caseWith({ product: null }), "problem")).toBeNull();
  });

  it("asks for the description in place when nothing was written yet", () => {
    expect(stageNextStep(caseWith({}), "problem")).toBe("describe");
  });

  it("offers to plan once the description exists", () => {
    expect(stageNextStep(caseWith({ originalAccount: "It jerks back." }), "problem")).toBe("plan");
  });

  it("shows the procedure form on the stage for a solution with no plan", () => {
    expect(stageNextStep(caseWith({}), "solution")).toBe("procedure");
    const saved = caseWith({ procedures: [procedure("proc_1", PHOTO)] });
    expect(stageNextStep(saved, "solution")).toBe("procedure");
  });

  it("is quiet while the current plan can drive the preview", () => {
    const c = caseWith({ plans: [plan({})], problemPlanId: "pl_1" });
    expect(stageNextStep(c, "problem")).toBeNull();
  });

  it("points at the open question and at an invalid description", () => {
    const asking = caseWith({
      plans: [plan({ status: "needs_clarification", reactorPrompt: null })],
      problemPlanId: "pl_1",
    });
    expect(stageNextStep(asking, "problem")).toBe("answer");
    const invalid = caseWith({
      plans: [plan({ status: "invalid", reactorPrompt: null })],
      problemPlanId: "pl_1",
    });
    expect(stageNextStep(invalid, "problem")).toBe("refine");
  });

  it("re-plans for a new photo, or asks for a procedure saved for that photo first", () => {
    const old = plan({ productRevisionId: "pr_old" });
    expect(stageNextStep(caseWith({ plans: [old], problemPlanId: "pl_1" }), "problem")).toBe(
      "replan",
    );
    const solution = plan({ purpose: "solution", productRevisionId: "pr_old" });
    const stale = caseWith({
      plans: [solution],
      solutionPlanId: "pl_1",
      procedures: [procedure("proc_old", "pr_old")],
    });
    expect(stageNextStep(stale, "solution")).toBe("procedure");
    const fresh = caseWith({ ...stale, procedures: [procedure("proc_now", PHOTO)] });
    expect(stageNextStep(fresh, "solution")).toBe("replan");
  });
});

describe("procedureForPhoto", () => {
  it("returns the newest procedure saved for the current photo only", () => {
    const c = caseWith({
      procedures: [procedure("a", PHOTO), procedure("b", PHOTO), procedure("c", "pr_old")],
    });
    expect(procedureForPhoto(c)?.id).toBe("b");
    expect(procedureForPhoto(caseWith({ procedures: [procedure("c", "pr_old")] }))).toBeNull();
  });
});
