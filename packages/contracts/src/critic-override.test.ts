import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateReviewRequest, CriticOverride, TicketSnapshot } from "./index.ts";

const sha = "a".repeat(64);

test("review request carries an explicit, optional critic override flag", () => {
  const base = {
    decision: "accept",
    finalSha256: sha,
    assessmentId: "asm_1",
    uncertaintyNote: null,
    idempotencyKey: "idem-override-1",
  };
  assert.equal(CreateReviewRequest.parse(base).overrideCriticFlag, undefined);
  assert.equal(
    CreateReviewRequest.parse({ ...base, overrideCriticFlag: true }).overrideCriticFlag,
    true,
  );
  assert.equal(
    CreateReviewRequest.safeParse({ ...base, overrideCriticFlag: "yes" }).success,
    false,
  );
});

test("critic override records only a needs_revision verdict, who and when", () => {
  const ok = {
    checkStatus: "needs_revision",
    reason: "The robot keeps moving after the bumper hit.",
    overriddenByRole: "customer",
    overriddenAt: "2026-10-08T17:00:00.000Z",
  };
  assert.deepEqual(CriticOverride.parse(ok), ok);
  assert.equal(CriticOverride.safeParse({ ...ok, checkStatus: "matches" }).success, false);
  assert.equal(CriticOverride.safeParse({ ...ok, checkStatus: "uncertain" }).success, false);
  assert.equal(CriticOverride.safeParse({ ...ok, reason: null }).success, true);
});

test("ticket snapshot accepts an override and older snapshots without one", () => {
  const snap = {
    caseTitle: "Vacuum",
    purpose: "problem",
    purposeLabel: "What happened",
    productLabel: "Robot vacuum",
    sourceType: "demo_photo",
    modelLabel: null,
    originalAccount: "It spins",
    actionsTried: "",
    unresolved: [],
    takeId: "take_1",
    takeNumber: 1,
    finalSha256: sha,
    caption: "Spins",
    durationMs: 1000,
    assessmentStatus: "needs_revision",
    assessmentSummary: "Mismatch",
    reviewState: "accepted",
    uncertaintyNote: null,
    message: "Help",
    submittedAt: "2026-10-08T17:00:00.000Z",
  };
  assert.equal(TicketSnapshot.safeParse(snap).success, true);
  const withOverride = {
    ...snap,
    criticOverride: {
      checkStatus: "needs_revision",
      reason: "Mismatch",
      overriddenByRole: "customer",
      overriddenAt: "2026-10-08T17:00:00.000Z",
    },
  };
  assert.equal(TicketSnapshot.safeParse(withOverride).success, true);
});
