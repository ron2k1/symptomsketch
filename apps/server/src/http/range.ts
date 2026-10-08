import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import { AppError } from "./errors.ts";

export interface SendFileOptions {
  /** When set, respond as an attachment with this filename (Content-Disposition). */
  download?: string;
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Parse a single `bytes=a-b` range. Returns null for absent/unsupported, "invalid" when unsatisfiable. */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range or unknown unit: ignore and send the full file
  const [, a = "", b = ""] = m;
  let start: number;
  let end: number;
  if (a === "" && b === "") return "invalid";
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return "invalid";
  }
  return { start, end };
}

/**
 * Stream an authorized file with byte-range support (video seeking). The caller has already
 * checked ownership / ticket grants and resolved a server-generated path. Never pass a
 * client-supplied path here.
 */
export async function sendFileWithRange(
  res: Response,
  filePath: string,
  mime: string,
  opts: SendFileOptions = {},
): Promise<void> {
  let size: number;
  try {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    throw new AppError("NOT_FOUND");
  }
  const req = res.req;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    opts.download ? contentDisposition(opts.download) : "inline",
  );

  const range = parseRange(req.headers.range, size);
  if (range === "invalid") {
    res.status(416).setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  if (range) {
    res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  } else {
    res.status(200);
  }
  res.setHeader("Content-Length", String(size === 0 ? 0 : end - start + 1));
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  try {
    await pipeline(createReadStream(filePath, { start, end }), res);
  } catch {
    // Client aborted (seek / navigation). Nothing to report.
    if (!res.writableEnded) res.destroy();
  }
}
