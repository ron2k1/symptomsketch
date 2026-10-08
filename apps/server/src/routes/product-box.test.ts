// server-ai route tests: product box (stub Gemini, see ai-harness.ts). Stub boxes are test-only.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { type ProductBoxResponse, paths } from "@symptomsketch/contracts";
import { productBoxFrom } from "../domain/product-box.ts";
import { AppError } from "../http/errors.ts";
import { type AiHarness, loggedIn, newCase, startAiServer } from "./ai-harness.ts";
import { errorCode } from "./core-harness.ts";

let h: AiHarness;
before(async () => {
  h = await startAiServer();
});
after(() => h.srv.stop());

test("productBoxFrom rounds a valid box and refuses missing or bad output", () => {
  assert.deepEqual(
    productBoxFrom("a1", { found: true, box_2d: [548.4, 300, 870, 764.6], facing: "left" }),
    { assetId: "a1", box2d: [548, 300, 870, 765], facing: "left" },
  );
  for (const raw of [
    { found: false, box_2d: [0, 0, 0, 0], facing: "left" },
    { found: true, box_2d: [870, 300, 548, 764], facing: "left" },
    { found: true, box_2d: [0, 0, 1200, 10], facing: "left" },
    { found: true, box_2d: [500.2, 0, 500.4, 10], facing: "left" },
    "not json",
  ]) {
    assert.throws(
      () => productBoxFrom("a1", raw),
      (e: unknown) => e instanceof AppError,
    );
  }
});

test("product box: one Gemini call per reference, cached; failure is a typed error", async () => {
  const b = await loggedIn(h);
  const caseId = await newCase(b);

  h.replies.push(JSON.stringify({ found: false, box_2d: [0, 0, 0, 0], facing: "left" }));
  const miss = await b.req(paths.caseProductBox(caseId));
  assert.equal(miss.status, 502);
  assert.equal(await errorCode(miss), "PROVIDER_FAILED");

  const calls = h.calls;
  h.replies.push(JSON.stringify({ found: true, box_2d: [548, 300, 870, 764], facing: "left" }));
  const res = await b.req(paths.caseProductBox(caseId));
  assert.equal(res.status, 200);
  const body = (await res.json()) as ProductBoxResponse;
  assert.deepEqual(body.box2d, [548, 300, 870, 764]);
  assert.equal(body.facing, "left");
  assert.equal(h.calls, calls + 1);

  const again = await b.req(paths.caseProductBox(caseId));
  assert.equal(again.status, 200);
  assert.deepEqual(((await again.json()) as ProductBoxResponse).box2d, body.box2d);
  assert.equal(h.calls, calls + 1, "cached per reference asset: no second Gemini call");
});

test("product box: foreign case is NOT_FOUND", async () => {
  const owner = await loggedIn(h);
  const caseId = await newCase(owner);
  const other = await loggedIn(h);
  const res = await other.req(paths.caseProductBox(caseId));
  assert.equal(res.status, 404);
});
