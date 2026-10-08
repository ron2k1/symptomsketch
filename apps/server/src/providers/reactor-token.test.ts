// Offline contract tests for the Reactor token adapter (fake fetch, no network, no secrets).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mintX2Token, ReactorTokenError, X2_MODEL_RESOURCE } from "./reactor-token.ts";

const FAKE_KEY = "test-key-not-real";

function fakeFetch(respond: (body: unknown) => Response) {
  const calls: { url: string; init: RequestInit; body: unknown }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "null")) as unknown;
    calls.push({ url: String(input), init: init ?? {}, body });
    return respond(body);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

async function expectCode(p: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof ReactorTokenError);
    assert.equal(err.code, code);
    if (reason) assert.equal(err.reason, reason);
    assert.ok(!err.message.includes(FAKE_KEY), "error message must not carry the key");
    return true;
  });
}

test("sends the documented scoped request and maps the response", async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 900;
  const { impl, calls } = fakeFetch(() =>
    json(200, {
      jwt: "a.b.c",
      expires_at: expiresAt,
      authorization_details: [{ type: "session", constraints: { max_sessions: 1 } }],
    }),
  );

  const token = await mintX2Token({ apiKey: FAKE_KEY, fetchImpl: impl });

  assert.equal(token.jwt, "a.b.c");
  assert.equal(token.expiresAt, new Date(expiresAt * 1000).toISOString());
  assert.equal(token.maxSessions, 1);
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, "https://api.reactor.inc/tokens");
  assert.equal(call.init.method, "POST");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers["Reactor-API-Key"], FAKE_KEY);
  assert.deepEqual(call.body, {
    expires_after: 900,
    authorization_details: [
      {
        type: "session",
        resources: { models: { match: [X2_MODEL_RESOURCE] } },
        constraints: { max_sessions: 1, max_session_duration_seconds: 600 },
      },
    ],
  });
});

test("missing or blank key is CONFIG_MISSING without a network call", async () => {
  const { impl, calls } = fakeFetch(() => json(200, {}));
  await expectCode(mintX2Token({ apiKey: undefined, fetchImpl: impl }), "CONFIG_MISSING");
  await expectCode(mintX2Token({ apiKey: "  ", fetchImpl: impl }), "CONFIG_MISSING");
  assert.equal(calls.length, 0);
});

test("401/403 map to CONFIG_MISSING, 429 to RATE_LIMITED, 5xx to REACTOR_UNAVAILABLE", async () => {
  for (const status of [401, 403]) {
    const { impl } = fakeFetch(() => json(status, { detail: `echo ${FAKE_KEY}` }));
    await expectCode(mintX2Token({ apiKey: FAKE_KEY, fetchImpl: impl }), "CONFIG_MISSING");
  }

  const limited = fakeFetch(() => json(429, {}, { "retry-after": "3" }));
  await assert.rejects(mintX2Token({ apiKey: FAKE_KEY, fetchImpl: limited.impl }), (err) => {
    assert.ok(err instanceof ReactorTokenError);
    assert.equal(err.code, "RATE_LIMITED");
    assert.equal(err.retryAfterMs, 3000);
    return true;
  });

  const down = fakeFetch(() => json(503, { error: "upstream secret detail" }));
  await assert.rejects(mintX2Token({ apiKey: FAKE_KEY, fetchImpl: down.impl }), (err) => {
    assert.ok(err instanceof ReactorTokenError);
    assert.equal(err.code, "REACTOR_UNAVAILABLE");
    assert.equal(err.status, 503);
    assert.ok(!err.message.includes("upstream secret detail"), "no provider body in message");
    return true;
  });
});

test("malformed body, network failure, timeout and abort are REACTOR_UNAVAILABLE", async () => {
  const bad = fakeFetch(() => json(200, { token: "x" }));
  await expectCode(
    mintX2Token({ apiKey: FAKE_KEY, fetchImpl: bad.impl }),
    "REACTOR_UNAVAILABLE",
    "bad_response",
  );

  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await expectCode(
    mintX2Token({ apiKey: FAKE_KEY, fetchImpl: offline }),
    "REACTOR_UNAVAILABLE",
    "network",
  );

  const hang = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;
  await expectCode(
    mintX2Token({ apiKey: FAKE_KEY, fetchImpl: hang, timeoutMs: 20 }),
    "REACTOR_UNAVAILABLE",
    "timeout",
  );

  const controller = new AbortController();
  const pending = mintX2Token({ apiKey: FAKE_KEY, fetchImpl: hang, signal: controller.signal });
  controller.abort();
  await expectCode(pending, "REACTOR_UNAVAILABLE", "aborted");
});

test("rejects out-of-range options before calling the provider", async () => {
  const { impl, calls } = fakeFetch(() => json(200, {}));
  await assert.rejects(
    mintX2Token({ apiKey: FAKE_KEY, maxSessions: 0, fetchImpl: impl }),
    RangeError,
  );
  await assert.rejects(
    mintX2Token({ apiKey: FAKE_KEY, expiresAfterSeconds: 7 * 60 * 60, fetchImpl: impl }),
    RangeError,
  );
  assert.equal(calls.length, 0);
});
