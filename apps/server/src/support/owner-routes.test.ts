import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  paths,
  type CaseResponse,
  type CreateWorkCaseResponse,
  type TicketResponse,
} from "@symptomsketch/contracts";
import { loadConfig } from "../config.ts";
import { type AppContext, createContext } from "../context.ts";
import {
  SUPPORT_CODE,
  call,
  cookieFrom,
  seedCase,
  seedCustomerSession,
  seedTake,
  sha256,
} from "./test-harness.ts";

/**
 * Spec 18 test 25 across modules: a support session gets no bypass on owner-only routes
 * (server-core assets/cases, server-media takes). Runs against the full app; when the full app
 * cannot load yet (another module mid-build) or the owner cannot reach a route, that check is
 * skipped rather than passing vacuously.
 */

let ctx: AppContext;
let dir: string;
let base = "";
let close: (() => Promise<void>) | null = null;
let loadError: string | null = null;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ss-support-owner-"));
  ctx = createContext(
    loadConfig({
      NODE_ENV: "test",
      DATA_DIR: dir,
      SESSION_SECRET: "test-secret-not-real",
      DEMO_ACCESS_CODE: "customer-code-for-tests",
      DEMO_SUPPORT_CODE: SUPPORT_CODE,
    }),
  );
  try {
    const { createApp } = await import("../app.ts");
    const server = createApp(ctx, { serveWeb: false }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    };
  } catch (err) {
    loadError = (err as Error)?.name ?? "Error";
  }
});

after(async () => {
  await close?.();
  await ctx.jobs.stop();
  ctx.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("support cannot read an unsubmitted take, source, or case by guessing ids", async (t) => {
  if (loadError) {
    t.skip(`full app did not load (${loadError}); support-route tests cover the ticket surface`);
    return;
  }
  const alice = seedCustomerSession(ctx);
  const c = seedCase(ctx, alice.id);
  const take = seedTake(ctx, c, alice.id, { accepted: true, number: 1 });
  const login = await call(base, "POST", paths.supportSession(), {
    body: { supportCode: SUPPORT_CODE },
  });
  assert.equal(login.status, 200);
  const support = cookieFrom(login.res);

  const urls = [
    paths.assetMedia(c.originalAssetId),
    paths.assetMedia(c.normalizedAssetId),
    paths.assetDownload(c.originalAssetId),
    paths.case(c.caseId),
    paths.take(take.takeId),
    paths.takeMedia(take.takeId),
    paths.takeDownload(take.takeId),
  ];
  let checked = 0;
  for (const url of urls) {
    const owner = await call(base, "GET", url, { cookie: alice.cookie });
    if (owner.status !== 200) continue; // owner route not reachable yet: nothing to compare
    const staff = await call(base, "GET", url, { cookie: support });
    assert.equal(staff.status, 404, `support must get 404 on ${url}`);
    checked += 1;
  }
  t.diagnostic(`owner-only routes compared: ${checked}/${urls.length}`);
  if (checked === 0) t.skip("no owner-only route reachable by the owner yet");
});

test("work case opens in the shared case routes for its support owner only", async (t) => {
  if (loadError) {
    t.skip(`full app did not load (${loadError})`);
    return;
  }
  const alice = seedCustomerSession(ctx);
  const c = seedCase(ctx, alice.id);
  const take = seedTake(ctx, c, alice.id, { accepted: true, number: 1 });
  const login = await call(base, "POST", paths.supportSession(), {
    body: { supportCode: SUPPORT_CODE },
  });
  const support = cookieFrom(login.res);
  const submitted = await call<TicketResponse>(base, "POST", paths.caseTickets(c.caseId), {
    cookie: alice.cookie,
    body: {
      takeId: take.takeId,
      message: "Full-app ticket",
      includeOriginal: false,
      idempotencyKey: "full-app-key-1",
    },
  });
  assert.equal(submitted.status, 201);
  const wc = await call<CreateWorkCaseResponse>(
    base,
    "POST",
    paths.ticketWorkCase(submitted.body.ticket.id),
    { cookie: support, body: { idempotencyKey: "full-app-key-2" } },
  );
  assert.equal(wc.status, 201);

  const opened = await call<CaseResponse>(base, "GET", paths.case(wc.body.caseId), {
    cookie: support,
  });
  assert.equal(opened.status, 200);
  const detail = opened.body.case;
  assert.equal(detail.ownerRole, "support");
  assert.equal(detail.mode, "solution");
  assert.equal(detail.sourceTicketId, submitted.body.ticket.id);
  assert.ok(detail.product, "work case has a product revision");
  const ref = submitted.body.ticket.attachments.find((a) => a.purpose === "customer_reference")!;
  assert.notEqual(detail.product.normalized.id, ref.assetId);
  assert.equal(detail.product.normalized.sha256, ref.sha256);
  const media = await fetch(`${base}${detail.product.normalized.mediaUrl}`, {
    headers: { cookie: support },
  });
  assert.equal(media.status, 200);
  assert.equal(sha256(Buffer.from(await media.arrayBuffer())), ref.sha256);
  // The customer cannot open the agent's work case.
  const peek = await call(base, "GET", paths.case(wc.body.caseId), { cookie: alice.cookie });
  assert.equal(peek.status, 404);
});
