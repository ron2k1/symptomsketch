import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";
import type { CaseDetail, CaseResponse, UploadAssetResult } from "@symptomsketch/contracts";
import { fromNow, newId, now } from "../db/index.ts";
import { sweepExpiredCases } from "../domain/lifecycle.ts";
import { hashToken } from "../http/session.ts";
import {
  Browser,
  type CoreServer,
  errorCode,
  sha256,
  startCoreServer,
  TEST_SESSION_SECRET,
} from "./core-harness.ts";

let srv: CoreServer;

before(async () => {
  srv = await startCoreServer();
});

after(async () => {
  await srv.stop();
});

async function loggedIn(): Promise<Browser> {
  const b = new Browser(srv.base);
  assert.equal((await b.login()).status, 200);
  return b;
}

async function fixtureCase(b: Browser): Promise<CaseDetail> {
  const res = await b.json("/api/cases", "POST", { purpose: "problem", fixtureId: "robot-vacuum" });
  assert.equal(res.status, 201);
  return ((await res.json()) as CaseResponse).case;
}

test("case from fixture copies the photo, sets a Demo reference and a draft procedure", async () => {
  const b = await loggedIn();
  const crid = `crid-${randomBytes(6).toString("hex")}`;
  const body = { purpose: "problem", fixtureId: "robot-vacuum", clientRequestId: crid };
  const res = await b.json("/api/cases", "POST", body);
  assert.equal(res.status, 201);
  const raw = await res.text();
  assert.equal(raw.includes(srv.dir), false, "no DATA_DIR paths");
  assert.equal(raw.includes("media/"), false, "no storage paths");
  assert.equal(raw.includes('demo-vacuum.jpg"'), true, "original filename shown");
  const c = (JSON.parse(raw) as CaseResponse).case;
  assert.equal(c.ownerRole, "customer");
  assert.equal(c.mode, "problem");
  assert.ok(c.product);
  assert.equal(c.product.sourceType, "demo_photo");
  assert.equal(c.product.fixtureId, "robot-vacuum");
  assert.equal(c.productRevisionId, c.product.id);
  assert.ok(Math.max(c.product.normalized.width ?? 0, c.product.normalized.height ?? 0) <= 1280);
  assert.equal(c.product.normalized.mime, "image/jpeg");
  assert.equal(c.procedures.length, 1);
  assert.equal(c.procedures[0]?.procedureCode, "SS-DEMO-RV-01");
  assert.equal(c.procedures[0]?.productRevisionId, c.product.id);
  assert.equal(c.procedures[0]?.modelApplicabilityConfirmed, false);
  assert.deepEqual([c.messages, c.plans, c.takes, c.tickets], [[], [], [], []]);

  const dup = await b.json("/api/cases", "POST", body);
  assert.equal(dup.status, 200);
  assert.equal(((await dup.json()) as CaseResponse).case.id, c.id);

  // The untouched original is byte-identical to the fixture photo.
  const dl = await b.req(c.product.original.downloadUrl ?? "");
  assert.equal(dl.status, 200);
  assert.match(
    dl.headers.get("content-disposition") ?? "",
    /attachment; filename="demo-vacuum.jpg"/,
  );
  const fixtureBytes = readFileSync(path.join(srv.ctx.config.demoAssetsDir, "demo-vacuum.jpg"));
  assert.equal(sha256(new Uint8Array(await dl.arrayBuffer())), sha256(fixtureBytes));
  assert.equal(c.product.original.sha256, sha256(fixtureBytes));
  assert.equal(c.product.sourceHash, sha256(fixtureBytes));

  const unknown = await b.json("/api/cases", "POST", { purpose: "problem", fixtureId: "nope" });
  assert.equal(unknown.status, 400);
});

test("upload validates signatures, normalizes, and creates a new current revision", async () => {
  const b = await loggedIn();
  const created = await b.json("/api/cases", "POST", { purpose: "problem" });
  const c = ((await created.json()) as CaseResponse).case;
  assert.equal(c.product, null);

  const fake = await b.upload(c.id, Buffer.from("this is not an image"), "photo.jpg", "image/jpeg");
  assert.equal(fake.status, 422);
  assert.equal(await errorCode(fake), "SOURCE_INVALID");

  const solid = { width: 64, height: 64, channels: 3, background: "#336699" } as const;
  const truncated = await sharp({ create: solid }).jpeg().toBuffer();
  const broken = await b.upload(c.id, truncated.subarray(0, 40), "cut.jpg", "image/jpeg");
  assert.equal(broken.status, 422);

  const tooBig = await b.upload(c.id, new Uint8Array(10 * 1024 * 1024 + 1), "big.png", "image/png");
  assert.equal(tooBig.status, 413);

  // 2000x1000 landscape stored sideways (EXIF orientation 6) with identifying metadata.
  const photo = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "#cc3366" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Copyright: "secret-location-note" } })
    .toBuffer();
  const up = await b.upload(c.id, photo, "My Vacuum.JPG", "application/octet-stream");
  assert.equal(up.status, 201);
  const result = (await up.json()) as UploadAssetResult;
  assert.equal(result.original.filename, "My Vacuum.JPG");
  assert.deepEqual([result.original.width, result.original.height], [1000, 2000]);
  assert.deepEqual([result.normalized.width, result.normalized.height], [640, 1280]);
  assert.equal(result.product.sourceType, "uploaded_photo");
  assert.equal(result.product.normalized.id, result.normalized.id);

  const norm = Buffer.from(await (await b.req(result.normalized.mediaUrl)).arrayBuffer());
  const meta = await sharp(norm).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.exif, undefined, "EXIF stripped from the working copy");
  assert.equal(meta.orientation, undefined);
  assert.equal(norm.includes(Buffer.from("secret-location-note")), false);

  // A second upload becomes current; the first revision is kept.
  const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: "#0f0" } })
    .png()
    .toBuffer();
  const up2 = await b.upload(c.id, png, "second.png", "image/png");
  assert.equal(up2.status, 201);
  const second = (await up2.json()) as UploadAssetResult;
  const detail = ((await (await b.req(`/api/cases/${c.id}`)).json()) as CaseResponse).case;
  assert.equal(detail.products.length, 2);
  assert.equal(detail.productRevisionId, second.product.id);
  assert.equal(detail.product?.original.mime, "image/png");

  // Re-select the first upload as the reference: new revision, same assets.
  const reselect = await b.json(`/api/cases/${c.id}/product-revisions`, "POST", {
    originalAssetId: result.original.id,
    modelLabel: "RV-100",
  });
  assert.equal(reselect.status, 201);
  const after = ((await (await b.req(`/api/cases/${c.id}`)).json()) as CaseResponse).case;
  assert.equal(after.products.length, 3);
  assert.equal(after.product?.original.id, result.original.id);
  assert.equal(after.product?.modelLabel, "RV-100");
  assert.equal(after.modelLabel, "RV-100");
});

test("ownership: another customer or a support session gets 404 for foreign case + media", async () => {
  const owner = await loggedIn();
  const c = await fixtureCase(owner);
  assert.ok(c.product);
  const mediaUrl = c.product.normalized.mediaUrl;
  const downloadUrl = c.product.original.downloadUrl ?? "";
  assert.equal((await owner.req(mediaUrl)).status, 200);

  const other = await loggedIn();
  const support = new Browser(srv.base);
  const token = randomBytes(32).toString("base64url");
  srv.ctx.db
    .prepare(
      `INSERT INTO sessions (id, token_hash, role, access_granted, created_at, last_seen_at, expires_at)
       VALUES (?, ?, 'support', 1, ?, ?, ?)`,
    )
    .run(newId("ses"), hashToken(TEST_SESSION_SECRET, token), now(), now(), fromNow(60_000));
  support.cookie = `ss_session=${token}`;

  for (const intruder of [other, support]) {
    assert.equal((await intruder.req(`/api/cases/${c.id}`)).status, 404);
    assert.equal((await intruder.req(mediaUrl)).status, 404);
    assert.equal((await intruder.req(downloadUrl)).status, 404);
    assert.equal((await intruder.json(`/api/cases/${c.id}`, "PATCH", { title: "x" })).status, 404);
    assert.equal((await intruder.req(`/api/cases/${c.id}`, { method: "DELETE" })).status, 404);
    const up = await intruder.upload(c.id, Buffer.from("x"), "a.jpg", "image/jpeg");
    assert.equal(up.status, 404);
  }
  // Support may create and read its own (agent work) case.
  const own = await support.json("/api/cases", "POST", { purpose: "solution" });
  assert.equal(own.status, 201);
  const ownCase = ((await own.json()) as CaseResponse).case;
  assert.equal(ownCase.ownerRole, "support");
  assert.equal((await support.req(`/api/cases/${ownCase.id}`)).status, 200);
});

test("asset media supports byte ranges", async () => {
  const b = await loggedIn();
  const c = await fixtureCase(b);
  assert.ok(c.product);
  const url = c.product.normalized.mediaUrl;
  const full = Buffer.from(await (await b.req(url)).arrayBuffer());
  const part = await b.req(url, { headers: { range: "bytes=0-99" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-type"), "image/jpeg");
  assert.equal(part.headers.get("content-range"), `bytes 0-99/${full.length}`);
  const bytes = Buffer.from(await part.arrayBuffer());
  assert.equal(bytes.length, 100);
  assert.deepEqual(bytes, full.subarray(0, 100));
});

test("patch keeps original wording until the first plan, then refuses changes", async () => {
  const b = await loggedIn();
  const c = await fixtureCase(b);
  const account = "  The vacuum stops and then jerks backward once. ";
  const patched = await b.json(`/api/cases/${c.id}`, "PATCH", {
    originalAccount: account,
    actionsTried: "Restarted it.",
    modelLabel: "Demo RV",
    mode: "solution",
  });
  assert.equal(patched.status, 200);
  const p = ((await patched.json()) as CaseResponse).case;
  assert.equal(p.originalAccount, account, "exact wording preserved");
  assert.equal(p.mode, "solution");
  assert.equal(p.modelLabel, "Demo RV");
  assert.equal(p.product?.modelLabel, "Demo RV", "unreferenced revision relabeled in place");

  srv.ctx.db
    .prepare(
      `INSERT INTO plan_revisions (id, case_id, purpose, product_revision_id, status, plan_json,
         caption, created_at) VALUES (?, ?, 'problem', ?, 'ready', '{}', 'c', ?)`,
    )
    .run(newId("plan"), c.id, c.productRevisionId, now());
  const locked = await b.json(`/api/cases/${c.id}`, "PATCH", { originalAccount: "changed" });
  assert.equal(locked.status, 409);
  assert.equal(await errorCode(locked), "PLAN_CONFLICT");
  const title = await b.json(`/api/cases/${c.id}`, "PATCH", {
    originalAccount: account,
    title: "Vacuum jerk",
  });
  assert.equal(title.status, 200, "unchanged wording + title edit is allowed");
  const relabelRes = await b.json(`/api/cases/${c.id}`, "PATCH", { modelLabel: "Other" });
  const relabel = ((await relabelRes.json()) as CaseResponse).case;
  assert.equal(relabel.modelLabel, "Other");
  assert.equal(relabel.product?.modelLabel, "Demo RV", "referenced revision stays frozen");
});

test("delete removes files, blocks media, and is idempotent", async () => {
  const b = await loggedIn();
  const c = await fixtureCase(b);
  assert.ok(c.product);
  const caseDir = path.join(srv.dir, "media", "originals", c.id);
  assert.equal(existsSync(caseDir), true);

  const del = await b.req(`/api/cases/${c.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { ok: true });
  assert.equal(existsSync(caseDir), false);
  assert.equal(existsSync(path.join(srv.dir, "media", "normalized", c.id)), false);
  const gone = await b.req(`/api/cases/${c.id}`);
  assert.equal(gone.status, 410);
  assert.equal(await errorCode(gone), "CASE_INACTIVE");
  assert.equal((await b.req(c.product.normalized.mediaUrl)).status, 404);
  assert.equal((await b.req(`/api/cases/${c.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await b.json(`/api/cases/${c.id}`, "PATCH", { title: "x" })).status, 410);
});

test("retention sweep expires old cases and removes their files", async () => {
  const b = await loggedIn();
  const c = await fixtureCase(b);
  assert.equal(
    Math.round((Date.parse(c.expiresAt) - Date.parse(c.createdAt)) / 86_400_000),
    srv.ctx.config.caseRetentionDays,
  );
  srv.ctx.db.prepare("UPDATE cases SET expires_at = ? WHERE id = ?").run(fromNow(-1000), c.id);
  assert.ok((await sweepExpiredCases(srv.ctx)) >= 1);
  const row = srv.ctx.db.prepare("SELECT status FROM cases WHERE id = ?").get(c.id) as {
    status: string;
  };
  assert.equal(row.status, "expired");
  assert.equal(existsSync(path.join(srv.dir, "media", "originals", c.id)), false);
});
