/**
 * TEST FIXTURE ONLY (never imported by the live app). Seeds owned rows + small files directly in
 * a temp DATA_DIR so support tests do not depend on other agents' in-progress route modules.
 * Bytes here are labeled placeholders, not Reactor/Gemini output.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import type { Purpose } from "@symptomsketch/contracts";
import { loadConfig } from "../config.ts";
import { type AppContext, createContext } from "../context.ts";
import { fromNow, newId, now, toJson } from "../db/index.ts";
import { apiNotFound, errorMiddleware } from "../http/errors.ts";
import { originCheck } from "../http/origin.ts";
import { SESSION_COOKIE, hashToken, sessionMiddleware } from "../http/session.ts";
import { register } from "./routes.ts";
import { caseStoragePath, resolveStoragePath } from "../media/files.ts";

export const SUPPORT_CODE = "support-code-for-tests";

export interface Harness {
  ctx: AppContext;
  base: string;
  dir: string;
  close: () => Promise<void>;
}

/** Same middleware chain as app.ts, with only the support routes mounted. */
export async function startHarness(): Promise<Harness> {
  const dir = mkdtempSync(path.join(tmpdir(), "ss-support-"));
  const config = loadConfig({
    NODE_ENV: "test",
    DATA_DIR: dir,
    SESSION_SECRET: "test-secret-not-real",
    DEMO_ACCESS_CODE: "customer-code-for-tests",
    DEMO_SUPPORT_CODE: SUPPORT_CODE,
  });
  const ctx = createContext(config);
  const app = express();
  app.use("/api", express.json());
  app.use("/api", cookieParser());
  app.use("/api", originCheck(config));
  app.use("/api", sessionMiddleware(ctx));
  const api = express.Router();
  register(api, ctx);
  app.use(api);
  app.use(apiNotFound);
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await ctx.jobs.stop();
    ctx.db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { ctx, base, dir, close };
}

/** Insert a customer session row and return its cookie header value. */
export function seedCustomerSession(ctx: AppContext): { id: string; cookie: string } {
  const token = randomBytes(32).toString("base64url");
  const id = newId("ses");
  const ts = now();
  ctx.db
    .prepare(
      `INSERT INTO sessions (id, token_hash, role, access_granted, created_at, last_seen_at, expires_at)
       VALUES (?, ?, 'customer', 1, ?, ?, ?)`,
    )
    .run(id, hashToken(ctx.config.sessionSecret, token), ts, ts, fromNow(86_400_000));
  return { id, cookie: `${SESSION_COOKIE}=${token}` };
}

export function cookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!raw) throw new Error("no session cookie");
  return raw.split(";")[0]!;
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Write a labeled placeholder file + its asset row. */
export function seedAsset(
  ctx: AppContext,
  caseId: string,
  ownerSessionId: string,
  kind: "original" | "normalized" | "final_mp4",
  mime: string,
): { id: string; sha: string; bytes: Buffer } {
  const id = newId("ast");
  const bytes = Buffer.concat([Buffer.from(`TEST FIXTURE ${kind} `), randomBytes(64)]);
  const dir = kind === "final_mp4" ? "finals" : kind === "original" ? "originals" : "normalized";
  const rel = caseStoragePath(dir, caseId, id, mime === "video/mp4" ? "mp4" : "jpg");
  const abs = resolveStoragePath(ctx.paths, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  const sha = sha256(bytes);
  ctx.db
    .prepare(
      `INSERT INTO assets (id, case_id, owner_session_id, kind, mime, size_bytes, sha256, filename,
         storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, caseId, ownerSessionId, kind, mime, bytes.length, sha, null, rel, now());
  return { id, sha, bytes };
}

export interface SeededCase {
  caseId: string;
  productRevisionId: string;
  originalAssetId: string;
  normalizedAssetId: string;
  planId: string;
}

/** A live case with a product revision (original + normalized) and one plan revision. */
export function seedCase(
  ctx: AppContext,
  ownerSessionId: string,
  opts: { role?: "customer" | "support"; purpose?: Purpose; existingCaseId?: string } = {},
): SeededCase {
  const ts = now();
  const purpose = opts.purpose ?? "problem";
  const caseId = opts.existingCaseId ?? newId("case");
  if (!opts.existingCaseId) {
    ctx.db
      .prepare(
        `INSERT INTO cases (id, owner_session_id, owner_role, title, mode, original_account,
           actions_tried, model_label, fixture_id, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, 'Vacuum jerks backward', ?, 'It stops then jerks backward once.',
           'Restarted it twice.', 'RV-100', 'robot-vacuum', ?, ?, ?)`,
      )
      .run(caseId, ownerSessionId, opts.role ?? "customer", purpose, ts, ts, fromNow(86_400_000));
  }
  const original = seedAsset(ctx, caseId, ownerSessionId, "original", "image/jpeg");
  const normalized = seedAsset(ctx, caseId, ownerSessionId, "normalized", "image/jpeg");
  const productRevisionId = newId("prod");
  ctx.db
    .prepare(
      `INSERT INTO product_revisions (id, case_id, source_type, fixture_id, original_asset_id,
         normalized_asset_id, model_label, source_hash, created_at)
       VALUES (?, ?, 'demo_photo', 'robot-vacuum', ?, ?, 'RV-100', ?, ?)`,
    )
    .run(productRevisionId, caseId, original.id, normalized.id, original.sha, ts);
  ctx.db
    .prepare("UPDATE cases SET product_revision_id = ? WHERE id = ?")
    .run(productRevisionId, caseId);
  const planId = newId("plan");
  ctx.db
    .prepare(
      `INSERT INTO plan_revisions (id, case_id, purpose, product_revision_id, status, plan_json,
         caption, unclear_json, created_at) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
    )
    .run(
      planId,
      caseId,
      purpose,
      productRevisionId,
      toJson({ context: { unresolved: ["cause unknown"] } }),
      "Illustration of one backward jerk after stopping",
      toJson(["how often it happens"]),
      ts,
    );
  return {
    caseId,
    productRevisionId,
    originalAssetId: original.id,
    normalizedAssetId: normalized.id,
    planId,
  };
}

export interface SeededTake {
  takeId: string;
  finalAssetId: string;
  sha: string;
  bytes: Buffer;
}

/** A ready take; `accepted` adds a matching assessment + accept review bound to its hash. */
export function seedTake(
  ctx: AppContext,
  c: SeededCase,
  ownerSessionId: string,
  opts: { accepted: boolean; purpose?: Purpose; number: number },
): SeededTake {
  const ts = now();
  const final = seedAsset(ctx, c.caseId, ownerSessionId, "final_mp4", "video/mp4");
  const takeId = newId("take");
  ctx.db
    .prepare(
      `INSERT INTO takes (id, case_id, purpose, number, plan_revision_id, product_revision_id,
         run_id, capture_status, processing_state, review_state, final_asset_id, duration_ms,
         size_bytes, sha256, caption, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'run-test', 'complete', 'ready', ?, ?, 6000, ?, ?, ?, ?, ?)`,
    )
    .run(
      takeId,
      c.caseId,
      opts.purpose ?? "problem",
      opts.number,
      c.planId,
      c.productRevisionId,
      opts.accepted ? "accepted" : "unreviewed",
      final.id,
      final.bytes.length,
      final.sha,
      "One backward jerk after stopping",
      ts,
      ts,
    );
  if (opts.accepted) {
    const asmId = newId("asm");
    ctx.db
      .prepare(
        `INSERT INTO assessments (id, take_id, final_sha256, product_revision_id, plan_revision_id,
           model_id, critic_prompt_version, input_coverage_json, job_state, result_status, summary,
           result_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'test-model', 'v1', '{}', 'done', 'matches', ?, ?, ?, ?)`,
      )
      .run(
        asmId,
        takeId,
        final.sha,
        c.productRevisionId,
        c.planId,
        "Appears consistent with one backward movement.",
        toJson({ checks: [{ constraintId: "direction", result: "supported" }] }),
        ts,
        ts,
      );
    ctx.db.prepare("UPDATE takes SET current_assessment_id = ? WHERE id = ?").run(asmId, takeId);
    ctx.db
      .prepare(
        `INSERT INTO reviews (id, take_id, final_sha256, assessment_id, decision, resulting_state,
           reviewer_session_id, reviewer_role, created_at)
         VALUES (?, ?, ?, ?, 'accept', 'accepted', ?, 'customer', ?)`,
      )
      .run(newId("rev"), takeId, final.sha, asmId, ownerSessionId, ts);
  }
  return { takeId, finalAssetId: final.id, sha: final.sha, bytes: final.bytes };
}

/** JSON request helper. `T` is the expected success body; error bodies carry `code`. */
export async function call<T = { code?: string; message?: string }>(
  base: string,
  method: string,
  url: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T & { code?: string }; res: Response }> {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // binary or empty body
  }
  return { status: res.status, body: body as T & { code?: string }, res };
}
