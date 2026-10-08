import assert from "node:assert/strict";
import { test } from "node:test";
import { Box2d, GeminiProductBox, ProductBoxResponse, ROUTES, paths } from "./index.ts";

test("Box2d accepts a normalized [ymin, xmin, ymax, xmax] box", () => {
  assert.deepEqual(Box2d.parse([548, 300, 870, 764]), [548, 300, 870, 764]);
  assert.deepEqual(Box2d.parse([0, 0, 1000, 1000]), [0, 0, 1000, 1000]);
});

test("Box2d rejects out-of-range, inverted, empty and wrong-length boxes", () => {
  assert.equal(Box2d.safeParse([-1, 0, 10, 10]).success, false);
  assert.equal(Box2d.safeParse([0, 0, 1001, 10]).success, false);
  assert.equal(Box2d.safeParse([500, 0, 400, 10]).success, false);
  assert.equal(Box2d.safeParse([0, 500, 10, 500]).success, false);
  assert.equal(Box2d.safeParse([0, 0, 10]).success, false);
});

test("GeminiProductBox needs a valid box and facing only when found", () => {
  const ok = GeminiProductBox.parse({ found: true, box_2d: [10, 20, 30, 40], facing: "left" });
  assert.equal(ok.found, true);
  assert.equal(GeminiProductBox.parse({ found: false }).found, false);
  assert.equal(GeminiProductBox.parse({ found: false, box_2d: [] }).found, false);
  assert.equal(
    GeminiProductBox.safeParse({ found: true, box_2d: [10, 20, 30, 40] }).success,
    false,
  );
  assert.equal(
    GeminiProductBox.safeParse({ found: true, box_2d: [30, 20, 10, 40], facing: "left" }).success,
    false,
  );
});

test("ProductBoxResponse and its route", () => {
  const body = { assetId: "a1", box2d: [10, 20, 30, 40], facing: "right" };
  assert.deepEqual(ProductBoxResponse.parse(body), body);
  assert.equal(ROUTES.caseProductBox, "/api/cases/:caseId/product-box");
  assert.equal(paths.caseProductBox("c 1"), "/api/cases/c%201/product-box");
});
