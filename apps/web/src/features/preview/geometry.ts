import { LIMITS } from "@symptomsketch/contracts";

/** Fixed 16:9 frame shared by the X2 source canvas and the recording canvas (spec 12). */
export const STAGE_WIDTH = LIMITS.sourceCanvasWidth;
export const STAGE_HEIGHT = LIMITS.sourceCanvasHeight;
/** Repaint rate of both canvases; captureStream only emits a frame when the canvas is painted. */
export const STAGE_FPS = 24;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Largest rect with the source aspect that fits inside dst, centered (never crops, never stretches). */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** Smallest rect with the source aspect that covers dst, centered (used only for blurred backdrops). */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** A decoded still with known pixel size (ImageBitmap or a loaded HTMLImageElement). */
export type StillImage = ImageBitmap | HTMLImageElement;

export function stillSize(img: StillImage): { w: number; h: number } {
  if (img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight };
  return { w: img.width, h: img.height };
}

/** Draws the still contain-fit over a blurred, darkened cover copy of itself (no hard bars). */
export function drawLetterboxedStill(
  ctx: CanvasRenderingContext2D,
  img: StillImage,
  dstW: number,
  dstH: number,
): void {
  const { w, h } = stillSize(img);
  const back = coverRect(w, h, dstW, dstH);
  ctx.save();
  ctx.filter = "blur(24px) brightness(0.6)";
  ctx.drawImage(img, back.x, back.y, back.w, back.h);
  ctx.restore();
  const fore = containRect(w, h, dstW, dstH);
  ctx.drawImage(img, fore.x, fore.y, fore.w, fore.h);
}
