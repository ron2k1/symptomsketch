// Offline tests for the Nano Banana image adapter (stub transport; no network, no key).
import assert from "node:assert/strict";
import { test } from "node:test";
import { GeminiError, imagePart } from "./gemini-client.ts";
import {
  NANO_BANANA_MODELS,
  createNanoBanana,
  nanoBananaModels,
  type ImageInteractionLike,
  type ImageInteractionRequest,
  type ImageTransport,
} from "./nano-banana.ts";

const PIXELS = Buffer.alloc(512, 7).toString("base64");

function stub(reply: (req: ImageInteractionRequest) => Promise<ImageInteractionLike>) {
  const calls: ImageInteractionRequest[] = [];
  const transport: ImageTransport = {
    create: (req) => {
      calls.push(req);
      return reply(req);
    },
  };
  return { transport, calls };
}

test("nanoBananaModels puts GEMINI_IMAGE_MODEL first without duplicates", () => {
  assert.equal(NANO_BANANA_MODELS[0], "gemini-nano-banana-2.1");
  assert.deepEqual(nanoBananaModels(null), [...NANO_BANANA_MODELS]);
  assert.deepEqual(nanoBananaModels("gemini-3-pro-image")[0], "gemini-3-pro-image");
  assert.equal(nanoBananaModels("gemini-3-pro-image").length, NANO_BANANA_MODELS.length);
});

test("sends text then reference images with a 3:4 image response_format", async () => {
  const { transport, calls } = stub(async () => ({
    status: "completed",
    model: "gemini-nano-banana-2.1",
    output_image: { type: "image", data: PIXELS, mime_type: "image/jpeg" },
  }));
  const client = createNanoBanana({ apiKey: null, transport });
  const out = await client.generateImage({
    prompt: "fictional agent",
    images: [imagePart(Buffer.from("agent"), "image/jpeg")],
    aspectRatio: "3:4",
  });
  assert.equal(out.modelId, "gemini-nano-banana-2.1");
  assert.equal(out.mime, "image/jpeg");
  assert.equal(out.bytes.length, 512);
  const req = calls[0]!;
  assert.equal(req.model, "gemini-nano-banana-2.1");
  assert.deepEqual(req.response_format, { type: "image", aspect_ratio: "3:4", image_size: "1K" });
  assert.equal(req.store, false);
  assert.deepEqual(
    req.input.map((p) => p.type),
    ["text", "image"],
  );
});

test("falls back to an image inside the model_output step", async () => {
  const { transport } = stub(async () => ({
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "image", data: PIXELS }] }],
  }));
  const out = await createNanoBanana({ apiKey: null, transport }).generateImage({
    prompt: "p",
    aspectRatio: "3:4",
  });
  assert.equal(out.bytes.length, 512);
  assert.equal(out.mime, "image/png");
});

test("an unknown model moves on to the next model in the chain", async () => {
  const { transport, calls } = stub(async (req) => {
    if (req.model === "missing-model") throw Object.assign(new Error("nf"), { status: 404 });
    return { status: "completed", output_image: { type: "image", data: PIXELS } };
  });
  const out = await createNanoBanana({
    apiKey: null,
    transport,
    models: ["missing-model", "gemini-nano-banana-2.1"],
  }).generateImage({ prompt: "p", aspectRatio: "3:4" });
  assert.deepEqual(
    calls.map((c) => c.model),
    ["missing-model", "gemini-nano-banana-2.1"],
  );
  assert.equal(out.modelId, "gemini-nano-banana-2.1");
});

test("a block stops the chain; a slow provider times out with a bounded error", async () => {
  const blocked = stub(async () => {
    throw Object.assign(new Error("x"), { status: 400, error: { reason: "SAFETY block" } });
  });
  await assert.rejects(
    createNanoBanana({
      apiKey: null,
      transport: blocked.transport,
      models: ["a", "b"],
    }).generateImage({ prompt: "p", aspectRatio: "3:4" }),
    (err: unknown) => err instanceof GeminiError && err.code === "PROVIDER_BLOCKED",
  );
  assert.equal(blocked.calls.length, 1);

  const slow = stub(() => new Promise(() => undefined));
  await assert.rejects(
    createNanoBanana({ apiKey: null, transport: slow.transport }).generateImage({
      prompt: "p",
      aspectRatio: "3:4",
      timeoutMs: 30,
    }),
    (err: unknown) => err instanceof GeminiError && err.reason === "timeout",
  );
  assert.equal(slow.calls.length, 1, "timeout ends the chain");
});

test("a missing key is CONFIG_MISSING without a call", async () => {
  await assert.rejects(
    createNanoBanana({ apiKey: " " }).generateImage({ prompt: "p", aspectRatio: "3:4" }),
    (err: unknown) => err instanceof GeminiError && err.code === "CONFIG_MISSING",
  );
});
