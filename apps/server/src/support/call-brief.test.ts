import assert from "node:assert/strict";
import { test } from "node:test";
import { CALL_GROUND_RULES, finalizePackage, flaggedClipNote } from "./call-brief.ts";

const raw = {
  persona: "You are Sam, an AI support agent. The customer reports the robot vacuum spins.",
  greeting: "Hi, I'm Sam, an AI support agent. What floor were you on?",
};
const override = {
  checkStatus: "needs_revision" as const,
  reason: "The clip shows the vacuum stopping, but the customer said it keeps spinning.",
  overriddenByRole: "customer" as const,
  overriddenAt: "2026-10-08T17:00:00.000Z",
};

test("brief tells Sam the clip was flagged by the automated check, and why", () => {
  const pkg = finalizePackage(raw, override);
  assert.match(pkg.persona, /automated Gemini visual check marked this clip as needing revision/);
  assert.match(pkg.persona, /customer chose to send it anyway/);
  assert.match(pkg.persona, /The check said: The clip shows the vacuum stopping/);
  assert.match(pkg.persona, /Do not treat the clip as confirmed/);
  assert.ok(pkg.persona.endsWith(CALL_GROUND_RULES), "ground rules still close the persona");
});

test("brief without an override carries no flag line", () => {
  const pkg = finalizePackage(raw, null);
  assert.doesNotMatch(pkg.persona, /Flagged clip/);
  assert.equal(flaggedClipNote(undefined), null);
});

test("flag note states plainly when the check recorded no reason", () => {
  const note = flaggedClipNote({ ...override, reason: null });
  assert.match(note ?? "", /The check did not record a reason\./);
});
