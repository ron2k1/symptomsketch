import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import {
  ERROR_COPY,
  ERROR_HTTP_STATUS,
  type ApiError,
  type ErrorCode,
} from "@symptomsketch/contracts";

/**
 * Throw this from any handler. The message is user-facing: never put provider bodies,
 * file paths, tokens, or keys in it.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, message?: string, status?: number) {
    super(message ?? ERROR_COPY[code]);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? ERROR_HTTP_STATUS[code];
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

function body(code: ErrorCode, message?: string): ApiError {
  return { code, message: message ?? ERROR_COPY[code] };
}

/** 404 for unmatched /api routes (mount after all API routers). */
export const apiNotFound: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith("/api/") && req.path !== "/api") return next();
  res.status(404).json(body("NOT_FOUND"));
};

interface MaybeHttpError {
  type?: string;
  status?: number;
  statusCode?: number;
  code?: string;
  name?: string;
}

/** Final error middleware: always `{ code, message }`, never raw error text from libraries/providers. */
export const errorMiddleware: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof AppError) {
    res.status(err.status).json(body(err.code, err.message));
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json(body("VALIDATION_FAILED"));
    return;
  }
  const e = (err ?? {}) as MaybeHttpError;
  // body-parser
  if (e.type === "entity.too.large") {
    res.status(413).json(body("PAYLOAD_TOO_LARGE"));
    return;
  }
  if (e.type === "entity.parse.failed") {
    res.status(400).json(body("VALIDATION_FAILED", "Request body is not valid JSON."));
    return;
  }
  // multer
  if (e.name === "MulterError") {
    if (e.code === "LIMIT_FILE_SIZE") {
      res.status(413).json(body("PAYLOAD_TOO_LARGE"));
      return;
    }
    res.status(400).json(body("VALIDATION_FAILED", "Upload was not accepted."));
    return;
  }
  console.error(`[http] unhandled ${e.name ?? "Error"}${e.code ? ` code=${e.code}` : ""}`);
  res.status(500).json(body("INTERNAL_ERROR"));
};
