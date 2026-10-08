import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { CatalogResponse, HealthResponse, SessionState } from "@symptomsketch/contracts";
import { resetAccessFailures } from "../domain/sessions.ts";
import {
  Browser,
  type CoreServer,
  errorCode,
  startCoreServer,
  TEST_ACCESS_CODE,
  TEST_SESSION_SECRET,
} from "./core-harness.ts";

let srv: CoreServer;

before(async () => {
  srv = await startCoreServer();
});

after(async () => {
  await srv.stop();
});

test("session gate: wrong code rejected, right code grants an HttpOnly session", async () => {
  const b = new Browser(srv.base);
  const anon = (await (await b.req("/api/session")).json()) as SessionState;
  assert.equal(anon.authenticated, false);

  const noSession = await b.json("/api/cases", "POST", { purpose: "problem" });
  assert.equal(noSession.status, 401);
  assert.equal(await errorCode(noSession), "ACCESS_REQUIRED");

  const wrong = await b.login("not-the-code");
  assert.equal(wrong.status, 401);
  assert.equal(await errorCode(wrong), "ACCESS_REQUIRED");
  assert.equal(b.cookie, "");

  const right = await b.login();
  assert.equal(right.status, 200);
  const setCookie = right.headers.getSetCookie().join(";");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const state = (await right.json()) as SessionState;
  assert.deepEqual(
    [state.authenticated, state.role, state.accessGranted],
    [true, "customer", true],
  );
  assert.equal(JSON.stringify(state).includes(TEST_ACCESS_CODE), false);

  const again = (await (await b.req("/api/session")).json()) as SessionState;
  assert.equal(again.accessGranted, true);
  resetAccessFailures();
});

test("health reports media + db booleans without secrets", async () => {
  const res = await fetch(`${srv.base}/api/health`);
  const body = (await res.json()) as HealthResponse;
  assert.equal(body.db, true);
  assert.equal(typeof body.media?.ffmpeg, "boolean");
  assert.equal(typeof body.media?.ffprobe, "boolean");
  const text = JSON.stringify(body);
  assert.equal(text.includes(TEST_ACCESS_CODE) || text.includes(TEST_SESSION_SECRET), false);
});

test("catalog lists allowlisted fixtures without server photo names", async () => {
  const body = (await (await fetch(`${srv.base}/api/catalog`)).json()) as CatalogResponse;
  const vacuum = body.products.find((p) => p.id === "robot-vacuum");
  assert.ok(vacuum, "robot-vacuum fixture listed");
  assert.equal(vacuum.queueLabel, "SymptomSketch Demo Support");
  assert.equal("photo" in vacuum, false);
});

test("repeated wrong access codes are rate limited", async () => {
  resetAccessFailures();
  const b = new Browser(srv.base);
  for (let i = 0; i < 10; i++) assert.equal((await b.login("wrong")).status, 401);
  const limited = await b.login();
  assert.equal(limited.status, 429);
  assert.equal(await errorCode(limited), "RATE_LIMITED");
  resetAccessFailures();
});
