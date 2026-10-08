import sharp, { type Metadata, type OutputInfo } from "sharp";
import { LIMITS } from "@symptomsketch/contracts";

/**
 * Product photo validation + normalization (spec 3). The file signature decides the type (never
 * the extension or the browser-declared MIME), sharp must decode the whole image, and the working
 * copy is auto-oriented, capped at 1280 px on the long edge, stripped of metadata (EXIF/GPS) and
 * re-encoded as JPEG.
 */

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_EXT: Record<ImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const SHARP_FORMAT: Record<ImageMime, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Refuse decompression bombs well before libvips allocates (about 80 MP, e.g. 10000 x 8000). */
const MAX_INPUT_PIXELS = 80_000_000;
const NORMALIZED_JPEG_QUALITY = 88;

/** Thrown for anything that is not a decodable JPEG/PNG/WebP photo. Message is never user-facing. */
export class ImageRejectedError extends Error {
  readonly reason: "signature" | "decode" | "dimensions";
  constructor(reason: "signature" | "decode" | "dimensions") {
    super(`image rejected: ${reason}`);
    this.name = "ImageRejectedError";
    this.reason = reason;
  }
}

/** Detect JPEG / PNG / WebP from magic bytes. */
export function detectImageMime(buf: Uint8Array): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) return "image/png";
  if (
    buf.length >= 12 &&
    Buffer.from(buf.subarray(0, 4)).toString("latin1") === "RIFF" &&
    Buffer.from(buf.subarray(8, 12)).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export interface ProcessedImage {
  mime: ImageMime;
  /** Display (auto-oriented) dimensions of the untouched original. */
  width: number;
  height: number;
  normalized: {
    data: Buffer;
    mime: "image/jpeg";
    width: number;
    height: number;
  };
}

/**
 * Validate a still image and build its normalized working copy. The original bytes are not
 * modified (the caller stores them untouched). Throws ImageRejectedError.
 */
export async function processProductImage(input: Buffer): Promise<ProcessedImage> {
  const mime = detectImageMime(input);
  if (!mime || !LIMITS.uploadMimeTypes.includes(mime)) throw new ImageRejectedError("signature");

  const opts = { failOn: "error" as const, limitInputPixels: MAX_INPUT_PIXELS };
  let meta: Metadata;
  try {
    meta = await sharp(input, opts).metadata();
  } catch {
    throw new ImageRejectedError("decode");
  }
  if (meta.format !== SHARP_FORMAT[mime]) throw new ImageRejectedError("signature");
  const rawW = meta.width ?? 0;
  const rawH = meta.height ?? 0;
  if (rawW < 16 || rawH < 16) throw new ImageRejectedError("dimensions");
  // EXIF orientations 5-8 swap the displayed axes.
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? rawH : rawW;
  const height = swap ? rawW : rawH;

  const max = LIMITS.referenceMaxLongEdge;
  let out: { data: Buffer; info: OutputInfo };
  try {
    // Full decode happens here; corrupt or truncated data throws. Without keepMetadata/withMetadata
    // sharp drops EXIF (including GPS), XMP and ICC (converted to sRGB) from the output.
    out = await sharp(input, opts)
      .rotate()
      .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: NORMALIZED_JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageRejectedError("decode");
  }
  return {
    mime,
    width,
    height,
    normalized: {
      data: out.data,
      mime: "image/jpeg",
      width: out.info.width,
      height: out.info.height,
    },
  };
}
