import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ActionPlan,
  ApiError,
  CatalogFixtureFile,
  CatalogProduct,
  ClipAssessment,
  CreatePlanRequest,
  ERROR_HTTP_STATUS,
  ErrorCode,
  HighlightSpan,
  REVIEW_ACTION_LABELS,
  ROUTES,
  deriveAssessmentStatus,
  paths,
  takeFilename,
  takeShelfLabel,
} from "./index.ts";

const fixtureFile = {
  fixtures: [
    {
      id: "robot-vacuum",
      name: "Robot vacuum",
      category: "Home robotics",
      tagline: "Demo product · SymptomSketch Demo Support",
      photo: "demo-vacuum.jpg",
      landingImage: "/assets/demo-vacuum.jpg",
      imageWidth: 1600,
      imageHeight: 1067,
      alt: "A white robot vacuum on a rug",
      exampleIssue: "It stops, then jerks backward once.",
      procedure: {
        procedureId: "SS-DEMO-RV-01",
        title: "Reposition the robot vacuum",
        steps: ["Lift the vacuum with both hands.", "Set it flat on the floor."],
        source: "Authored SymptomSketch demo procedure (not a manufacturer manual)",
      },
    },
  ],
};

const plan = {
  schemaVersion: 1,
  purpose: "problem",
  productRevisionId: "prod_abc",
  procedureRevisionId: null,
  selectedAction: {
    subject: "robot vacuum",
    startingState: "moving, then comes to a stop",
    action: "jerks backward",
    direction: "backward",
    repetitions: 1,
    timing: "immediately after stopping",
    magnitude: "small",
    endingState: "stationary",
  },
  context: { reportedFrequency: "intermittent", actionsTried: [], unresolved: ["cause unknown"] },
  prerequisites: [],
  invariants: ["same selected product"],
  requiredConstraints: [
    {
      id: "direction",
      expected: "backward",
      critical: true,
      source: { kind: "account", quote: "jerks backward once" },
    },
  ],
  understanding: "Show a stop followed by one small backward jerk.",
  preservedDetails: ["one backward jerk"],
  caption: "Illustration of one backward jerk after stopping",
  sourceReferences: [],
  clarificationQuestion: null,
};

test("catalog fixture file round-trips and public product strips the server photo path", () => {
  const parsed = CatalogFixtureFile.parse(fixtureFile);
  assert.deepEqual(parsed, fixtureFile);
  const fixture = parsed.fixtures[0]!;
  const product = CatalogProduct.parse({ ...fixture, queueLabel: "SymptomSketch Demo Support" });
  assert.equal("photo" in product, false);
  assert.equal(product.queueLabel, "SymptomSketch Demo Support");
});

test("catalog fixture rejects path traversal in photo", () => {
  const bad = structuredClone(fixtureFile);
  bad.fixtures[0]!.photo = "../../.env";
  assert.equal(CatalogFixtureFile.safeParse(bad).success, false);
});

test("action plan round-trips and enforces caption length", () => {
  assert.deepEqual(ActionPlan.parse(plan), plan);
  const long = { ...plan, caption: "x".repeat(91) };
  assert.equal(ActionPlan.safeParse(long).success, false);
});

test("highlight span requires end > start", () => {
  const ok = {
    messageId: "msg_1",
    start: 0,
    end: 8,
    field: "movement",
    label: "Movement",
    kind: "established",
  };
  assert.ok(HighlightSpan.safeParse(ok).success);
  assert.equal(HighlightSpan.safeParse({ ...ok, end: 0 }).success, false);
});

test("critic status derivation follows spec 9", () => {
  assert.equal(deriveAssessmentStatus([]), "uncertain");
  assert.equal(deriveAssessmentStatus([{ result: "supported" }]), "matches");
  assert.equal(
    deriveAssessmentStatus([{ result: "supported" }, { result: "not_observable" }]),
    "uncertain",
  );
  assert.equal(
    deriveAssessmentStatus([{ result: "not_observable" }, { result: "contradicted" }]),
    "needs_revision",
  );
  const assessment = {
    schemaVersion: 1,
    takeId: "take_1",
    finalSha256: "a".repeat(64),
    productRevisionId: "prod_1",
    planRevisionId: "plan_1",
    procedureRevisionId: null,
    criticPromptVersion: "critic-v1",
    modelId: "gemini-3.8-flash",
    inputCoverage: { kind: "full_video", requestedFps: 8, sampledTimestampsSeconds: [] },
    status: "matches",
    checks: [
      {
        constraintId: "direction",
        result: "supported",
        observation: "Moves back",
        timeRangeSeconds: [1, 2],
      },
    ],
    limitations: [],
    suggestedPresentationChanges: [],
  };
  assert.deepEqual(ClipAssessment.parse(assessment), assessment);
});

test("every error code has an HTTP status and ApiError validates", () => {
  for (const code of ErrorCode.options) assert.ok(ERROR_HTTP_STATUS[code] >= 400);
  assert.ok(ApiError.safeParse({ code: "PLAN_CONFLICT", message: "x" }).success);
  assert.equal(ApiError.safeParse({ code: "NOPE", message: "x" }).success, false);
});

test("paths encode ids and mirror ROUTES patterns", () => {
  assert.equal(paths.caseTakes("case_a/b"), "/api/cases/case_a%2Fb/takes");
  assert.equal(
    paths.ticketAttachmentMedia("tkt_1", "ast_2"),
    ROUTES.ticketAttachmentMedia.replace(":ticketId", "tkt_1").replace(":assetId", "ast_2"),
  );
  assert.equal(takeFilename(42, 3), "symptomsketch-case-42-take-03.mp4");
});

test("plan request and labels", () => {
  assert.ok(
    CreatePlanRequest.safeParse({
      purpose: "problem",
      parentPlanId: null,
      correction: null,
      clientRequestId: "11111111-2222-3333-4444-555555555555",
    }).success,
  );
  assert.equal(REVIEW_ACTION_LABELS.problem.accept, "Matches my description");
  assert.equal(
    takeShelfLabel({
      captureStatus: "complete",
      processingState: "ready",
      reviewState: "accepted",
    }),
    "Matched",
  );
  assert.equal(
    takeShelfLabel({
      captureStatus: "incomplete",
      processingState: "failed",
      reviewState: "unreviewed",
    }),
    "Incomplete",
  );
});
