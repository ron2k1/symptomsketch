import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DataPaths } from "../context.ts";

/**
 * File helpers for everything stored under DATA_DIR (spec 14). Storage paths in the database are
 * relative to DATA_DIR with forward slashes; they never leave the server. Writes go to the tmp
 * directory first and are renamed into place so readers never see a partial file.
 */

/** Media directories that hold per-case subfolders (`<dir>/<caseId>/<file>`). */
export const MEDIA_DIRS = [
  "originals",
  "normalized",
  "recordings",
  "finals",
  "thumbnails",
] as const;
export type MediaDir = (typeof MEDIA_DIRS)[number];

/** Server-generated ids only (`<prefix>_<base64url>`); anything else is rejected before touching disk. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

function assertSafeSegment(value: string): void {
  if (!SAFE_SEGMENT.test(value)) throw new Error("unsafe storage path segment");
}

export function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Relative storage path for a case file: `media/<dir>/<caseId>/<fileId>.<ext>`. */
export function caseStoragePath(
  dir: MediaDir,
  caseId: string,
  fileId: string,
  ext: string,
): string {
  assertSafeSegment(caseId);
  assertSafeSegment(fileId);
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new Error("unsafe storage extension");
  return `media/${dir}/${caseId}/${fileId}.${ext}`;
}

/** Resolve a stored relative path to an absolute one, refusing anything outside DATA_DIR. */
export function resolveStoragePath(paths: DataPaths, rel: string): string {
  if (path.isAbsolute(rel)) throw new Error("storage path must be relative");
  const abs = path.resolve(paths.root, rel);
  const root = paths.root.endsWith(path.sep) ? paths.root : paths.root + path.sep;
  if (!abs.startsWith(root)) throw new Error("storage path escapes DATA_DIR");
  return abs;
}

/** Write bytes atomically: tmp file in DATA_DIR/tmp, then rename into the final location. */
export async function writeFileAtomic(
  paths: DataPaths,
  rel: string,
  data: Uint8Array,
): Promise<void> {
  const dest = resolveStoragePath(paths, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await mkdir(paths.tmp, { recursive: true });
  const part = path.join(paths.tmp, `${randomBytes(12).toString("hex")}.part`);
  try {
    await writeFile(part, data, { flag: "wx" });
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Remove one stored file (missing files are fine). Never throws. */
export async function removeStoredFile(paths: DataPaths, rel: string): Promise<boolean> {
  try {
    await rm(resolveStoragePath(paths, rel), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Remove every per-case media folder for `caseId` (deletion / expiry). Never throws. */
export async function removeCaseDirs(paths: DataPaths, caseId: string): Promise<void> {
  assertSafeSegment(caseId);
  await Promise.all(
    MEDIA_DIRS.map((dir) =>
      rm(path.join(paths.root, "media", dir, caseId), { recursive: true, force: true }).catch(
        () => undefined,
      ),
    ),
  );
}

/** Make an uploaded filename safe to store and echo back (no paths, no control characters). */
export function sanitizeFilename(name: string | undefined | null, fallback: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}
