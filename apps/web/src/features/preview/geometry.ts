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

/** Largest share of the photo's height (or width) the stage may trim to fill 16:9 edge to edge. */
export const STAGE_MAX_TRIM = 0.2;

/**
 * Where a still sits on the stage. A near-16:9 photo (a 3:2 product shot trims ~16%) fills the
 * frame: side bars were blurred backdrop that X2 extended on one edge and left dark on the other.
 * Anything that would lose more (portrait phone photos) stays contain-fit so the product survives.
 */
export function stageRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const cover = coverRect(srcW, srcH, dstW, dstH);
  const trim = 1 - Math.min(dstW / cover.w, dstH / cover.h);
  return trim <= STAGE_MAX_TRIM ? cover : containRect(srcW, srcH, dstW, dstH);
}

/** A decoded still with known pixel size (ImageBitmap or a loaded HTMLImageElement). */
export type StillImage = ImageBitmap | HTMLImageElement;

export function stillSize(img: StillImage): { w: number; h: number } {
  if (img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight };
  return { w: img.width, h: img.height };
}

/**
 * Draws the still at its stageRect; when that leaves bars, they are a blurred, darkened cover copy
 * of the still (no hard edges).
 */
export function drawLetterboxedStill(
  ctx: CanvasRenderingContext2D,
  img: StillImage,
  dstW: number,
  dstH: number,
): void {
  const { w, h } = stillSize(img);
  const fore = stageRect(w, h, dstW, dstH);
  if (fore.w < dstW || fore.h < dstH) {
    const back = coverRect(w, h, dstW, dstH);
    ctx.save();
    ctx.filter = "blur(24px) brightness(0.6)";
    ctx.drawImage(img, back.x, back.y, back.w, back.h);
    ctx.restore();
  }
  ctx.drawImage(img, fore.x, fore.y, fore.w, fore.h);
}
