import { LIMITS } from "@symptomsketch/contracts";
import { formatBytes } from "@/lib/format";

export type PhotoCheck = { ok: true; mime: string } | { ok: false; message: string };

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const PHOTO_ACCEPT = [...LIMITS.uploadMimeTypes, ".jpg", ".jpeg", ".png", ".webp"].join(",");

/**
 * Client pre-check only (spec 3): type + size before any upload. The server still validates
 * the file signature and decodes the image; this just saves a round trip for obvious misses.
 */
export function precheckPhoto(file: Pick<File, "name" | "type" | "size">): PhotoCheck {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const mime = file.type || EXTENSION_MIME[ext] || "";
  if (!LIMITS.uploadMimeTypes.includes(mime)) {
    return { ok: false, message: "Choose a JPEG, PNG or WebP photo." };
  }
  if (file.size <= 0) {
    return { ok: false, message: "That file is empty. Choose another photo." };
  }
  if (file.size > LIMITS.uploadMaxBytes) {
    return {
      ok: false,
      message: `That photo is ${formatBytes(file.size)}. The limit is ${formatBytes(LIMITS.uploadMaxBytes)}.`,
    };
  }
  return { ok: true, mime };
}
