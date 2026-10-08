import type { RequestHandler } from "express";
import type { AppConfig } from "../config.ts";
import { AppError } from "./errors.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Origins accepted for state-changing requests: APP_ORIGIN list (+ local dev hosts outside production). */
export function allowedOrigins(config: AppConfig): Set<string> {
  const set = new Set(config.appOrigins);
  if (!config.isProduction) {
    for (const host of ["localhost", "127.0.0.1"]) {
      set.add(`http://${host}:${config.port}`);
      set.add(`http://${host}:5173`);
    }
  }
  return set;
}

/**
 * Same-origin gate for POST/PATCH/PUT/DELETE (spec 11, 14). Passes when Origin is allowlisted or
 * Sec-Fetch-Site is same-origin. Outside production, non-browser clients that send neither header
 * (curl, tests) are allowed; browsers always send Origin on these methods.
 */
export function originCheck(config: AppConfig): RequestHandler {
  const allowed = allowedOrigins(config);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    const site = req.get("sec-fetch-site");
    if (origin && allowed.has(origin.replace(/\/+$/, ""))) return next();
    if (site === "same-origin") return next();
    if (!origin && !site && !config.isProduction) return next();
    next(new AppError("FORBIDDEN", "Cross-origin request blocked."));
  };
}
