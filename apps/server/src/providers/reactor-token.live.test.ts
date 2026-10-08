// Live check against the real Reactor token API. Skipped unless LIVE_REACTOR=1.
// Run (from apps/server): LIVE_REACTOR=1 npx tsx --test src/providers/reactor-token.live.test.ts
// Minting a token creates no session and generates nothing; it is free to run.
// Prints only the outcome, JWT length and granted lifetime. Never the key or the JWT.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getConfig } from "../config.ts";
import { mintX2Token } from "./reactor-token.ts";

const live = process.env.LIVE_REACTOR === "1";

test("mintX2Token returns a scoped xmax/x2 JWT (live)", { skip: !live }, async () => {
  const apiKey = getConfig().reactorApiKey ?? undefined;
  assert.ok(apiKey, "REACTOR_API_KEY is not configured");

  const token = await mintX2Token({ apiKey, maxSessions: 1 });
  const expiresInSec = Math.round((Date.parse(token.expiresAt) - Date.now()) / 1000);

  console.log(
    `reactor token: status=2xx jwtLength=${token.jwt.length} ` +
      `expiresInSec=${expiresInSec} maxSessions=${token.maxSessions}`,
  );
  assert.ok(token.jwt.length > 20);
  assert.equal(token.jwt.split(".").length, 3, "expected a compact JWS");
  assert.ok(expiresInSec > 60 && expiresInSec <= 6 * 60 * 60, "unexpected granted lifetime");
  assert.equal(token.maxSessions, 1);
});

test("mintX2Token maps a rejected key to CONFIG_MISSING (live)", { skip: !live }, async () => {
  await assert.rejects(mintX2Token({ apiKey: "not-a-real-key" }), (err: unknown) => {
    const e = err as { code?: string; status?: number };
    console.log(`reactor token (bogus key): code=${e.code} status=${e.status}`);
    return e.code === "CONFIG_MISSING" && e.status === 401;
  });
});
