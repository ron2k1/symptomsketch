// Story routes: token + director authz and bookkeeping (stub Gemini + stub minter, no network).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  STORY_LIMITS,
  storyPaths,
  type StoryDirectorResponse,
  type StoryTokenResponse,
} from "@symptomsketch/contracts";
import { type AiHarness, loggedIn, newCase, startAiServer } from "../routes/ai-harness.ts";
import { Browser, errorCode } from "../routes/core-harness.ts";
import { ReactorTokenError } from "../providers/reactor-token.ts";
import { setStoryMinterFor } from "./routes.ts";

// Labeled stubs only.
const scene = (n: number) => ({
  label: `STUB choice ${n}`,
  caption: `STUB caption ${n}`,
  prompt: `STUB scene ${n}: the robot vacuum rolls across the floor with a steady motor whine and a soft click.`,
});
const beat = (n: number) => ({ ...scene(n), custom: false });

let h: AiHarness;
let mintFails = false;
let mints = 0;
before(async () => {
  h = await startAiServer();
  setStoryMinterFor(h.srv.ctx, async () => {
    mints += 1;
    if (mintFails) throw new ReactorTokenError("REACTOR_UNAVAILABLE", "network");
    return {
      jwt: "stub.fasth3.jwt",
      expiresAt: new Date(Date.now() + 9e5).toISOString(),
      maxSessions: 1,
    };
  });
});
after(() => h.srv.stop());

test("token: owner only; foreign session and anonymous get no FastH3 token", async () => {
  const owner = await loggedIn(h);
  const caseId = await newCase(owner);
  const res = await owner.json(storyPaths.token(caseId), "POST", {});
  assert.equal(res.status, 200);
  const body = (await res.json()) as StoryTokenResponse;
  assert.equal(body.modelName, "reactor/fast-h3");
  assert.equal(body.clipSeconds, STORY_LIMITS.clipSeconds);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const stranger = await loggedIn(h);
  const before = mints;
  const foreign = await stranger.json(storyPaths.token(caseId), "POST", {});
  assert.equal(foreign.status, 404);
  assert.equal(await errorCode(foreign), "NOT_FOUND");

  const anon = new Browser(h.srv.base);
  const noSession = await anon.json(storyPaths.token(caseId), "POST", {});
  assert.ok(noSession.status === 401 || noSession.status === 403);
  assert.equal(mints, before, "no token minted for non-owners");
});

test("token: provider failure surfaces as REACTOR_UNAVAILABLE, never a stand-in", async () => {
  const owner = await loggedIn(h);
  const caseId = await newCase(owner);
  mintFails = true;
  try {
    const res = await owner.json(storyPaths.token(caseId), "POST", {});
    assert.equal(res.status, 503);
    assert.equal(await errorCode(res), "REACTOR_UNAVAILABLE");
  } finally {
    mintFails = false;
  }
});

test("director: opening returns a scene + three choices; foreign case is NOT_FOUND", async () => {
  const owner = await loggedIn(h);
  const caseId = await newCase(owner);
  h.calls = 0;
  h.replies.push(JSON.stringify({ scene: scene(0), choices: [scene(1), scene(2), scene(3)] }));
  const res = await owner.json(storyPaths.director(caseId), "POST", { kind: "opening" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as StoryDirectorResponse;
  assert.equal(body.scene?.label, "STUB choice 0");
  assert.equal(body.choices.length, 3);
  assert.equal(body.act, "went_wrong");
  assert.equal(body.offerEnd, false);
  assert.equal(h.calls, 1);

  const stranger = await loggedIn(h);
  const foreign = await stranger.json(storyPaths.director(caseId), "POST", { kind: "opening" });
  assert.equal(foreign.status, 404);
  assert.equal(h.calls, 1, "no Gemini call for a foreign case");
});

test("director: end offered after 3 scenes; at the 6-scene cap no model call is made", async () => {
  const owner = await loggedIn(h);
  const caseId = await newCase(owner);
  h.replies.push(JSON.stringify({ choices: [scene(4), scene(5), scene(6)] }));
  const three = await owner.json(storyPaths.director(caseId), "POST", {
    kind: "next",
    beats: [beat(1), beat(2), beat(3)],
  });
  const b3 = (await three.json()) as StoryDirectorResponse;
  assert.equal(b3.offerEnd, true);
  assert.equal(b3.atCap, false);
  assert.equal(b3.act, "failure");

  h.calls = 0;
  const capped = await owner.json(storyPaths.director(caseId), "POST", {
    kind: "next",
    beats: [1, 2, 3, 4, 5, 6].map(beat),
  });
  const c = (await capped.json()) as StoryDirectorResponse;
  assert.equal(c.atCap, true);
  assert.deepEqual(c.choices, []);
  assert.equal(h.calls, 0);
});

test("director: custom text becomes one scene; invalid output twice is PROVIDER_FAILED", async () => {
  const owner = await loggedIn(h);
  const caseId = await newCase(owner);
  h.replies.push(JSON.stringify({ scene: scene(9) }));
  const ok = await owner.json(storyPaths.director(caseId), "POST", {
    kind: "custom",
    beats: [beat(1)],
    text: "It started beeping and spun in place",
  });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as StoryDirectorResponse;
  assert.equal(body.scene?.label, "STUB choice 9");
  assert.deepEqual(body.choices, []);

  h.replies.push("{}", "{}");
  const bad = await owner.json(storyPaths.director(caseId), "POST", {
    kind: "next",
    beats: [beat(1)],
  });
  assert.equal(bad.status, 502);
  assert.equal(await errorCode(bad), "PROVIDER_FAILED");
});

test("director: malformed request is VALIDATION_FAILED", async () => {
  const owner = await loggedIn(h);
  const caseId = await newCase(owner);
  const res = await owner.json(storyPaths.director(caseId), "POST", { kind: "next", beats: [] });
  assert.equal(res.status, 400);
});
