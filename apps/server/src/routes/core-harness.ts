import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ApiError } from "@symptomsketch/contracts";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import { type AppContext, createContext } from "../context.ts";
import { stopRetentionSweep } from "../domain/lifecycle.ts";

/** Test-only harness for server-core route tests (temp DATA_DIR, ephemeral port, fake codes). */

export const TEST_ACCESS_CODE = "test-access-code";
export const TEST_SESSION_SECRET = "test-session-secret";

export interface CoreServer {
  ctx: AppContext;
  dir: string;
  base: string;
  stop: () => Promise<void>;
}

export async function startCoreServer(): Promise<CoreServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "ss-core-"));
  const ctx = createContext(
    loadConfig({
      NODE_ENV: "test",
      DATA_DIR: dir,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DEMO_ACCESS_CODE: TEST_ACCESS_CODE,
      DEMO_SUPPORT_CODE: "test-support-code",
    }),
  );
  const server = createApp(ctx, { serveWeb: false }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const stop = async () => {
    stopRetentionSweep(ctx);
    await new Promise<void>((r) => {
      server.closeAllConnections();
      server.close(() => r());
    });
    await ctx.jobs.stop();
    ctx.db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { ctx, dir, base, stop };
}

/** Minimal cookie-keeping client: one instance per browser profile. */
export class Browser {
  cookie = "";
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  async req(p: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const res = await fetch(this.base + p, { ...init, headers });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0] ?? "";
      if (pair.startsWith("ss_session=")) this.cookie = pair;
    }
    return res;
  }
  json(p: string, method: string, body: unknown): Promise<Response> {
    return this.req(p, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  login(code = TEST_ACCESS_CODE): Promise<Response> {
    return this.json("/api/session", "POST", { accessCode: code });
  }
  upload(
    caseId: string,
    bytes: Uint8Array<ArrayBuffer>,
    name: string,
    type: string,
  ): Promise<Response> {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type }), name);
    return this.req(`/api/cases/${caseId}/assets`, { method: "POST", body: form });
  }
}

export async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as ApiError).code;
}

export const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
