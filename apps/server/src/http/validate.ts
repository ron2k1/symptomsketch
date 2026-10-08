import type { Request } from "express";
import type { z } from "zod";
import { AppError } from "./errors.ts";

/** Field paths only (never submitted values) so errors cannot echo user text or secrets. */
function describe(error: z.ZodError): string {
  const fields = [...new Set(error.issues.map((i) => i.path.join(".") || "(body)"))].slice(0, 6);
  return `Invalid or missing fields: ${fields.join(", ")}`;
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_FAILED", describe(result.error));
  return result.data;
}

/** Validate `req.body` (JSON). Throws AppError VALIDATION_FAILED (400). */
export function parseBody<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  return parseWith(schema, req.body ?? {});
}

/** Validate `req.query`. */
export function parseQuery<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  return parseWith(schema, req.query);
}

/** Validate a JSON string (e.g. the multipart `meta` field). */
export function parseJsonField<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  if (typeof raw !== "string") throw new AppError("VALIDATION_FAILED", "Missing JSON field.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Field is not valid JSON.");
  }
  return parseWith(schema, value);
}

/** Read a required route param as a string (Express 5 params are strings or undefined). */
export function param(req: Request, name: string): string {
  const v = (req.params as Record<string, string | undefined>)[name];
  if (typeof v !== "string" || v.length === 0 || v.length > 128) {
    throw new AppError("NOT_FOUND");
  }
  return v;
}
