import type { AppContext } from "../context.ts";
import { AppError } from "../http/errors.ts";
import { resolveStoragePath as resolveRelative } from "../media/files.ts";

/**
 * DATA_DIR-relative storage paths (assets.storage_path, server-core convention
 * `media/<dir>/<caseId>/<fileId>.<ext>` from media/files.ts). Never sent to the browser.
 */

/** Absolute path for a stored file; a path that escapes DATA_DIR is reported as NOT_FOUND. */
export function resolveStoragePath(ctx: AppContext, storagePath: string): string {
  try {
    return resolveRelative(ctx.paths, storagePath);
  } catch {
    throw new AppError("NOT_FOUND");
  }
}
