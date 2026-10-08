import { execFile } from "node:child_process";
import type { Router } from "express";
import { CONTRACTS_VERSION, ROUTES, type HealthResponse } from "@symptomsketch/contracts";
import { configStatus } from "../config.ts";
import type { AppContext } from "../context.ts";

/**
 * GET /api/health readiness (spec 11, 15): database, configuration presence booleans and local
 * ffmpeg/ffprobe availability. Never returns values, paths or provider responses and never makes
 * a paid provider call.
 */

const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;

interface ProbeCache {
  at: number;
  value: Promise<boolean>;
}

const probes = new Map<string, ProbeCache>();

/** `<bin> -version` exits 0 within 5 s. Cached for a minute per binary. */
function binaryAvailable(bin: string): Promise<boolean> {
  const hit = probes.get(bin);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.value;
  const value = new Promise<boolean>((resolve) => {
    try {
      execFile(bin, ["-version"], { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (err) =>
        resolve(!err),
      );
    } catch {
      resolve(false);
    }
  });
  probes.set(bin, { at: Date.now(), value });
  return value;
}

export function register(router: Router, ctx: AppContext): void {
  router.get(ROUTES.health, async (_req, res) => {
    let db = false;
    try {
      db = ctx.db.prepare("SELECT 1 AS ok").get() !== undefined;
    } catch {
      db = false;
    }
    const config = configStatus(ctx.config);
    const [ffmpeg, ffprobe] = await Promise.all([
      binaryAvailable(ctx.config.ffmpegPath),
      binaryAvailable(ctx.config.ffprobePath),
    ]);
    const body: HealthResponse = {
      ok: db && config.ok && ffmpeg && ffprobe,
      contractsVersion: CONTRACTS_VERSION,
      db,
      config,
      media: { ffmpeg, ffprobe },
      extendedInputs: ctx.config.enableExtendedInputs,
    };
    res.status(body.ok ? 200 : 503).json(body);
  });
}
