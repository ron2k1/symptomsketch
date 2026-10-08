import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { z } from "zod";

/** apps/server/src -> repo root. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Empty strings in .env mean "not set". */
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);
const flag = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
);
const intWithDefault = (def: number, min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().min(min).max(max).default(def),
  );

/** Every variable from .env.example (+ NODE_ENV, FFPROBE_PATH). */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: intWithDefault(3030, 0, 65535),
  DATA_DIR: optionalString,
  APP_ORIGIN: optionalString,
  REACTOR_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  GEMINI_TEXT_MODEL: optionalString,
  GEMINI_CRITIC_MODEL: optionalString,
  GEMINI_THINKING_LEVEL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["low", "medium", "high"]).default("medium"),
  ),
  CRITIC_FPS: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().positive().max(60).default(8),
  ),
  ENABLE_EXTENDED_INPUTS: flag,
  GEMINI_IMAGE_MODEL: optionalString,
  SESSION_SECRET: optionalString,
  DEMO_ACCESS_CODE: optionalString,
  DEMO_SUPPORT_CODE: optionalString,
  FFMPEG_PATH: optionalString,
  FFPROBE_PATH: optionalString,
  MAX_LIVE_SESSIONS: intWithDefault(2, 1, 50),
  MAX_EXPORT_JOBS: intWithDefault(1, 1, 8),
  CASE_RETENTION_DAYS: intWithDefault(7, 1, 365),
});

export interface AppConfig {
  readonly nodeEnv: "development" | "production" | "test";
  readonly isProduction: boolean;
  readonly port: number;
  /** Absolute path (relative DATA_DIR values resolve against the repo root). */
  readonly dataDir: string;
  /** APP_ORIGIN split on commas, trailing slashes removed. */
  readonly appOrigins: readonly string[];
  readonly reactorApiKey: string | null;
  readonly geminiApiKey: string | null;
  readonly geminiTextModel: string;
  readonly geminiCriticModel: string;
  readonly geminiThinkingLevel: "low" | "medium" | "high";
  readonly criticFps: number;
  readonly enableExtendedInputs: boolean;
  readonly geminiImageModel: string | null;
  /** Always set. When SESSION_SECRET is missing an ephemeral random secret is used (dev only). */
  readonly sessionSecret: string;
  readonly sessionSecretEphemeral: boolean;
  readonly demoAccessCode: string | null;
  readonly demoSupportCode: string | null;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly maxLiveSessions: number;
  readonly maxExportJobs: number;
  readonly caseRetentionDays: number;
  readonly repoRoot: string;
  /** Built frontend served in production / `pnpm start`. */
  readonly webDistDir: string;
  /** Server-side demo fixtures (catalog.json + photos). */
  readonly demoAssetsDir: string;
}

const SECRET_KEYS = [
  "reactorApiKey",
  "geminiApiKey",
  "sessionSecret",
  "demoAccessCode",
  "demoSupportCode",
] as const;

function normalizeOrigin(o: string): string {
  return o.trim().replace(/\/+$/, "");
}

/** Pure: build a config from an env record. Throws a value-free error listing invalid var names. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))];
    throw new Error(`Invalid server configuration: ${names.join(", ")}`);
  }
  const v = parsed.data;
  const port = v.PORT;
  const dataDir = path.resolve(REPO_ROOT, v.DATA_DIR ?? "./.data");
  const origins = (v.APP_ORIGIN ?? `http://localhost:${port}`)
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  const config: AppConfig = {
    nodeEnv: v.NODE_ENV,
    isProduction: v.NODE_ENV === "production",
    port,
    dataDir,
    appOrigins: origins,
    reactorApiKey: v.REACTOR_API_KEY ?? null,
    geminiApiKey: v.GEMINI_API_KEY ?? null,
    geminiTextModel: v.GEMINI_TEXT_MODEL ?? "gemini-3.8-flash",
    geminiCriticModel: v.GEMINI_CRITIC_MODEL ?? "gemini-3.8-flash",
    geminiThinkingLevel: v.GEMINI_THINKING_LEVEL,
    criticFps: v.CRITIC_FPS,
    enableExtendedInputs: v.ENABLE_EXTENDED_INPUTS,
    geminiImageModel: v.GEMINI_IMAGE_MODEL ?? null,
    sessionSecret: v.SESSION_SECRET ?? randomBytes(32).toString("base64url"),
    sessionSecretEphemeral: v.SESSION_SECRET === undefined,
    demoAccessCode: v.DEMO_ACCESS_CODE ?? null,
    demoSupportCode: v.DEMO_SUPPORT_CODE ?? null,
    ffmpegPath: v.FFMPEG_PATH ?? "ffmpeg",
    ffprobePath: v.FFPROBE_PATH ?? "ffprobe",
    maxLiveSessions: v.MAX_LIVE_SESSIONS,
    maxExportJobs: v.MAX_EXPORT_JOBS,
    caseRetentionDays: v.CASE_RETENTION_DAYS,
    repoRoot: REPO_ROOT,
    webDistDir: path.join(REPO_ROOT, "apps", "web", "dist"),
    demoAssetsDir: path.join(REPO_ROOT, "assets", "demo"),
  };
  // Redact secrets if the object is ever logged or serialized by mistake.
  const redacted = () =>
    Object.fromEntries(
      Object.entries(config).map(([k, val]) => [
        k,
        (SECRET_KEYS as readonly string[]).includes(k) ? (val ? "[set]" : null) : val,
      ]),
    );
  Object.defineProperty(config, "toJSON", { value: redacted, enumerable: false });
  Object.defineProperty(config, Symbol.for("nodejs.util.inspect.custom"), {
    value: redacted,
    enumerable: false,
  });
  return Object.freeze(config);
}

/**
 * Load the gitignored root .env (if present) without overriding variables already set in the
 * process environment (so `PORT=3101 DATA_DIR=tmp/x` from a shell wins).
 */
export function loadRootEnvFile(envPath = path.join(REPO_ROOT, ".env")): boolean {
  if (!existsSync(envPath)) return false;
  const before = { ...process.env };
  process.loadEnvFile(envPath);
  for (const [k, val] of Object.entries(before)) process.env[k] = val;
  return true;
}

export interface ConfigStatus {
  ok: boolean;
  present: Record<string, boolean>;
  missing: string[];
}

/** Presence booleans only; never values. Used by /api/health. */
export function configStatus(c: AppConfig): ConfigStatus {
  const present: Record<string, boolean> = {
    REACTOR_API_KEY: c.reactorApiKey !== null,
    GEMINI_API_KEY: c.geminiApiKey !== null,
    SESSION_SECRET: !c.sessionSecretEphemeral,
    DEMO_ACCESS_CODE: c.demoAccessCode !== null,
    DEMO_SUPPORT_CODE: c.demoSupportCode !== null,
  };
  const missing = Object.entries(present)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return { ok: missing.length === 0, present, missing };
}

let cached: AppConfig | null = null;

/** Process-wide config (loads root .env once). Prefer `ctx.config` inside route modules. */
export function getConfig(): AppConfig {
  if (!cached) {
    loadRootEnvFile();
    cached = loadConfig(process.env);
  }
  return cached;
}
