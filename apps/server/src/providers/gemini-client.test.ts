// Offline unit tests for the Gemini adapter: a stub transport stands in for the SDK. These never
// touch the network; the real-provider check lives in gemini-client.live.test.ts (LIVE_GEMINI=1).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createGeminiClient,
  GeminiError,
  GEMINI_INLINE_REQUEST_LIMIT_BYTES,
  imagePart,
  textPart,
  videoPart,
  type InteractionLike,
  type InteractionRequest,
  type InteractionsTransport,
} from "./gemini-client.ts";

const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };

function stub(
  respond: (req: InteractionRequest, signal: AbortSignal) => Promise<InteractionLike>,
): { transport: InteractionsTransport; calls: InteractionRequest[] } {
  const calls: InteractionRequest[] = [];
  return {
    calls,
    transport: {
      create: (req, options) => {
        calls.push(req);
        return respond(req, options.signal);
      },
    },
  };
}

function httpError(status: number, payload?: unknown): Error {
  return Object.assign(new Error(`${status} raw provider text with secrets`), {
    status,
    error: payload,
  });
}

async function expectGeminiError(
  run: Promise<unknown>,
  code: GeminiError["code"],
  reason: GeminiError["reason"],
): Promise<GeminiError> {
  const error = await run.then(
    () => assert.fail("expected GeminiError"),
    (e: unknown) => e,
  );
  assert.ok(error instanceof GeminiError, "error is a GeminiError");
  assert.equal(error.code, code);
  assert.equal(error.reason, reason);
  assert.doesNotMatch(error.message, /raw provider|secret/i);
  return error;
}

const base = { model: "gemini-3.8-flash", system: "sys", jsonSchema: schema };

describe("part helpers", () => {
  test("build interaction content blocks", () => {
    assert.deepEqual(textPart("hi"), { type: "text", text: "hi" });
    assert.deepEqual(imagePart(Buffer.from("ab"), "image/png"), {
      type: "image",
      data: "YWI=",
      mime_type: "image/png",
    });
    assert.deepEqual(videoPart(Buffer.from("ab"), "video/mp4", 8), {
      type: "video",
      data: "YWI=",
      mime_type: "video/mp4",
      processing: { type: "static", fps: 8 },
    });
    assert.throws(() => videoPart(Buffer.from("ab"), "video/mp4", 0), RangeError);
  });
});

describe("generateStructured", () => {
  test("sends the verified request shape and parses JSON", async () => {
    const { transport, calls } = stub(async () => ({
      id: "int-1",
      status: "completed",
      model: "gemini-3.8-flash",
      output_text: '{"a":"x"}',
      usage: { total_input_tokens: 10, total_output_tokens: 5, total_thought_tokens: 3 },
    }));
    const client = createGeminiClient({ apiKey: undefined, transport });
    const result = await client.generateStructured({
      ...base,
      parts: [textPart("hello")],
      thinkingLevel: "low",
    });
    assert.deepEqual(result.data, { a: "x" });
    assert.equal(result.modelId, "gemini-3.8-flash");
    assert.equal(result.interactionId, "int-1");
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, thoughtTokens: 3 });
    assert.deepEqual(calls[0], {
      model: "gemini-3.8-flash",
      system_instruction: "sys",
      input: [{ type: "text", text: "hello" }],
      generation_config: { thinking_level: "low" },
      response_format: { type: "text", mime_type: "application/json", schema },
      store: false,
    });
  });

  test("defaults thinking level to medium and tolerates a json fence", async () => {
    const { transport, calls } = stub(async () => ({
      status: "completed",
      output_text: '```json\n{"a":"y"}\n```',
    }));
    const client = createGeminiClient({ apiKey: undefined, transport });
    const result = await client.generateStructured({ ...base, parts: [textPart("x")] });
    assert.deepEqual(result.data, { a: "y" });
    assert.equal(result.modelId, "gemini-3.8-flash");
    assert.equal(calls[0]?.generation_config.thinking_level, "medium");
  });

  test("validate result is returned and a validate throw is invalid_output", async () => {
    const { transport } = stub(async () => ({ status: "completed", output_text: '{"a":1}' }));
    const client = createGeminiClient({ apiKey: undefined, transport });
    const ok = await client.generateStructured({
      ...base,
      parts: [textPart("x")],
      validate: (v) => ({ wrapped: v }),
    });
    assert.deepEqual(ok.data, { wrapped: { a: 1 } });
    await expectGeminiError(
      client.generateStructured({
        ...base,
        parts: [textPart("x")],
        validate: () => {
          throw new Error("zod says no");
        },
      }),
      "ASSESSMENT_FAILED",
      "invalid_output",
    );
  });

  test("missing key is CONFIG_MISSING without calling the provider", async () => {
    const client = createGeminiClient({ apiKey: "  " });
    await expectGeminiError(
      client.generateStructured({ ...base, parts: [textPart("x")] }),
      "CONFIG_MISSING",
      "missing_key",
    );
  });

  test("maps HTTP statuses to bounded codes", async () => {
    const cases: Array<[number, unknown, GeminiError["code"], GeminiError["reason"]]> = [
      [429, undefined, "RATE_LIMITED", "rate_limited"],
      [401, undefined, "CONFIG_MISSING", "auth"],
      [403, undefined, "CONFIG_MISSING", "auth"],
      [404, undefined, "CONFIG_MISSING", "model_unavailable"],
      [400, { message: "Request blocked by SAFETY" }, "PROVIDER_BLOCKED", "blocked"],
      [400, { message: "Invalid schema" }, "ASSESSMENT_FAILED", "bad_request"],
      [400, [{ error: { details: [{ reason: "API_KEY_INVALID" }] } }], "CONFIG_MISSING", "auth"],
      [503, undefined, "ASSESSMENT_FAILED", "provider_error"],
      [504, undefined, "ASSESSMENT_FAILED", "timeout"],
    ];
    for (const [status, payload, code, reason] of cases) {
      const { transport } = stub(async () => {
        throw httpError(status, payload);
      });
      const client = createGeminiClient({ apiKey: undefined, transport });
      const error = await expectGeminiError(
        client.generateStructured({ ...base, parts: [textPart("x")] }),
        code,
        reason,
      );
      assert.equal(error.httpStatus, status);
    }
  });

  test("non-completed interactions, empty and non-JSON output fail closed", async () => {
    const cases: Array<[InteractionLike, GeminiError["code"], GeminiError["reason"]]> = [
      [
        { status: "failed", errors: [{ code: "SAFETY", message: "blocked" }] },
        "PROVIDER_BLOCKED",
        "blocked",
      ],
      [{ status: "incomplete" }, "ASSESSMENT_FAILED", "incomplete"],
      [{ status: "failed" }, "ASSESSMENT_FAILED", "provider_error"],
      [{ status: "completed", output_text: "" }, "ASSESSMENT_FAILED", "empty_output"],
      [{ status: "completed", output_text: "not json" }, "ASSESSMENT_FAILED", "invalid_json"],
    ];
    for (const [interaction, code, reason] of cases) {
      const { transport } = stub(async () => interaction);
      const client = createGeminiClient({ apiKey: undefined, transport });
      await expectGeminiError(
        client.generateStructured({ ...base, parts: [textPart("x")] }),
        code,
        reason,
      );
    }
  });

  test("timeout and caller abort are distinguished", async () => {
    const hang = stub(
      (_req, signal) =>
        new Promise<InteractionLike>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const client = createGeminiClient({ apiKey: undefined, transport: hang.transport });
    await expectGeminiError(
      client.generateStructured({ ...base, parts: [textPart("x")], timeoutMs: 20 }),
      "ASSESSMENT_FAILED",
      "timeout",
    );
    const controller = new AbortController();
    const pending = client.generateStructured({
      ...base,
      parts: [textPart("x")],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort();
    await expectGeminiError(pending, "ASSESSMENT_FAILED", "aborted");
  });

  test("rejects requests over the inline size ceiling before calling out", async () => {
    const { transport, calls } = stub(async () => ({ status: "completed", output_text: "{}" }));
    const client = createGeminiClient({ apiKey: undefined, transport });
    const huge = { type: "video" as const, data: "A".repeat(GEMINI_INLINE_REQUEST_LIMIT_BYTES) };
    await expectGeminiError(
      client.generateStructured({
        ...base,
        parts: [{ ...huge, mime_type: "video/mp4", processing: { type: "static", fps: 8 } }],
      }),
      "ASSESSMENT_FAILED",
      "request_too_large",
    );
    assert.equal(calls.length, 0);
  });
});
