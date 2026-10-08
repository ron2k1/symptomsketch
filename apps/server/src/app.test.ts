import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import express from "express";
import type { HealthResponse } from "@symptomsketch/contracts";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { type AppContext, createContext } from "./context.ts";
import { tx } from "./db/index.ts";
import { JobError } from "./db/jobs.ts";
import { AppError, errorMiddleware } from "./http/errors.ts";
import { sendFileWithRange } from "./http/range.ts";

let dir: string;
let ctx: AppContext;
let base: string;
let close: () => Promise<void>;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ss-smoke-"));
  const config = loadConfig({
    NODE_ENV: "test",
    DATA_DIR: dir,
    SESSION_SECRET: "test-secret-not-real",
    DEMO_ACCESS_CODE: "a",
    DEMO_SUPPORT_CODE: "b",
  });
  ctx = createContext(config);
  const app = createApp(ctx, { serveWeb: false });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () =>
    new Promise<void>((r) => {
      server.closeAllConnections();
      server.close(() => r());
    });
});

after(async () => {
  await close();
  await ctx.jobs.stop();
  ctx.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("GET /api/health reports db + config presence without values", async () => {
  const res = await fetch(`${base}/api/health`);
  const body = (await res.json()) as HealthResponse;
  assert.equal(body.db, true);
  assert.equal(body.config.present.DEMO_ACCESS_CODE, true);
  assert.equal(body.config.present.REACTOR_API_KEY, false);
  assert.ok(body.config.missing.includes("GEMINI_API_KEY"));
  assert.equal(res.status, 503);
  assert.equal(JSON.stringify(body).includes("test-secret-not-real"), false);
});

test("planner effort defaults to low and is set apart from the critic level", () => {
  const defaults = loadConfig({ NODE_ENV: "test" });
  assert.equal(defaults.plannerThinkingLevel, "low");
  assert.equal(defaults.geminiThinkingLevel, "medium");
  const set = loadConfig({
    NODE_ENV: "test",
    GEMINI_PLANNER_THINKING_LEVEL: "high",
    GEMINI_THINKING_LEVEL: "low",
  });
  assert.equal(set.plannerThinkingLevel, "high");
  assert.equal(set.geminiThinkingLevel, "low");
  assert.throws(() => loadConfig({ NODE_ENV: "test", GEMINI_PLANNER_THINKING_LEVEL: "minimal" }));
});

test("unknown /api route returns ApiError NOT_FOUND", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(Object.keys((await res.json()) as object).sort(), ["code", "message"]);
});

test("cross-origin POST is blocked", async () => {
  const res = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: "{}",
  });
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { code: string }).code, "FORBIDDEN");
});

test("migrations create every spec table", () => {
  const names = (
    ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  for (const t of [
    "sessions",
    "cases",
    "product_revisions",
    "assets",
    "procedure_revisions",
    "messages",
    "plan_revisions",
    "takes",
    "assessments",
    "reviews",
    "tickets",
    "ticket_attachments",
    "ticket_replies",
    "jobs",
    "leases",
  ]) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test("tx rolls back on throw", () => {
  assert.throws(() =>
    tx(ctx.db, () => {
      ctx.db
        .prepare(
          "INSERT INTO sessions (id, token_hash, role, created_at, last_seen_at, expires_at) VALUES ('ses_x','h','customer','t','t','t')",
        )
        .run();
      throw new Error("boom");
    }),
  );
  assert.equal(ctx.db.prepare("SELECT id FROM sessions WHERE id = 'ses_x'").get(), undefined);
});

test("job queue: idempotent enqueue, run, failure code, recovery", async () => {
  const seen: string[] = [];
  ctx.jobs.registerJobHandler<{ n: number }>("test_job", {
    concurrency: 1,
    handler: async (payload) => {
      if (payload.n < 0) throw new JobError("EXPORT_FAILED", { retryable: true });
      seen.push(String(payload.n));
      return { doubled: payload.n * 2 };
    },
  });
  const a = ctx.jobs.enqueueJob("test_job", { n: 2 }, "k1");
  const dup = ctx.jobs.enqueueJob("test_job", { n: 99 }, "k1");
  assert.equal(a.created, true);
  assert.equal(dup.created, false);
  assert.equal(dup.job.id, a.job.id);
  const bad = ctx.jobs.enqueueJob("test_job", { n: -1 }, "k2");
  ctx.jobs.start();
  for (let i = 0; i < 50; i++) {
    const s1 = ctx.jobs.getJob(a.job.id)?.status;
    const s2 = ctx.jobs.getJob(bad.job.id)?.status;
    if (s1 === "done" && s2 === "retryable") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(ctx.jobs.getJob(a.job.id)?.status, "done");
  assert.deepEqual(ctx.jobs.getJob(a.job.id)?.result, { doubled: 4 });
  const failed = ctx.jobs.getJob(bad.job.id);
  assert.equal(failed?.status, "retryable");
  assert.equal(failed?.errorCode, "EXPORT_FAILED");
  assert.deepEqual(seen, ["2"]);
  await ctx.jobs.stop();
  ctx.db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(a.job.id);
  assert.equal(ctx.jobs.recoverJobs(), 1);
  assert.equal(ctx.jobs.getJob(a.job.id)?.status, "retryable");
});

test("sendFileWithRange serves 206 partial content and errors as ApiError", async () => {
  const file = path.join(dir, "range.bin");
  writeFileSync(file, Buffer.from("0123456789"));
  const app = express();
  app.get("/f", async (_req, res) => sendFileWithRange(res, file, "application/octet-stream"));
  app.get("/missing", async (_req, res) => sendFileWithRange(res, file + ".nope", "video/mp4"));
  app.get("/err", () => {
    throw new AppError("PLAN_CONFLICT");
  });
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const part = await fetch(`${url}/f`, { headers: { range: "bytes=2-5" } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), "2345");
    assert.equal(part.headers.get("content-range"), "bytes 2-5/10");
    const full = await fetch(`${url}/f`);
    assert.equal(await full.text(), "0123456789");
    const bad = await fetch(`${url}/f`, { headers: { range: "bytes=50-60" } });
    assert.equal(bad.status, 416);
    await bad.arrayBuffer();
    const missing = await fetch(`${url}/missing`);
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { code: string }).code, "NOT_FOUND");
    const err = await fetch(`${url}/err`);
    assert.equal(err.status, 409);
    assert.equal(((await err.json()) as { code: string }).code, "PLAN_CONFLICT");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
