import type { Box2d, ProductFacing } from "@symptomsketch/contracts";
import { MOTION, type MaskRect, type ProductRegion } from "./motion-sketch";

/** Below this share of the image width or height the product is too small to cut out and move. */
export const MIN_BOX_SIDE = 0.02;
/** Narrowest strip of background beside the product that can be tiled over the vacated area. */
export const MIN_PLATE_WIDTH = 0.04;

/**
 * Product region for the motion sketch from Gemini's box_2d ([ymin, xmin, ymax, xmax] in 0..1000 of
 * the reference image, GET /api/cases/:id/product-box). Mask: an ellipse inscribed in the box plus
 * a rounded core rect, so the cutout follows the product's silhouette loosely without its corners.
 * Clean plate: the widest band of background beside the box at the same height, tiled over the
 * hole. Null when the box is too small to move or no background strip exists beside it (the stage
 * then restyles the plain still and says why); never a guessed region.
 */
export function regionFromBox(box2d: Box2d, facing: ProductFacing): ProductRegion | null {
  const clamp = (v: number) => Math.min(1, Math.max(0, v / 1000));
  const [y0, x0, y1, x1] = [clamp(box2d[0]), clamp(box2d[1]), clamp(box2d[2]), clamp(box2d[3])];
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < MIN_BOX_SIDE || h < MIN_BOX_SIDE) return null;

  const left = x0;
  const right = 1 - x1;
  const side = Math.max(left, right);
  if (side < MIN_PLATE_WIDTH) return null;
  const plateW = Math.min(side * 0.9, w);
  const plateY = Math.max(0, y0 - h * 0.05);
  const plate: MaskRect = {
    kind: "rect",
    x: left >= right ? left - plateW - side * 0.05 : x1 + side * 0.05,
    y: plateY,
    w: plateW,
    h: Math.min(h * 1.1, 1 - plateY),
  };
  plate.x = Math.min(1 - plate.w, Math.max(0, plate.x));

  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  return {
    mask: [
      { kind: "ellipse", cx, cy, rx: w / 2, ry: h / 2 },
      { kind: "rect", x: x0 + w * 0.08, y: y0 + h * 0.12, w: w * 0.84, h: h * 0.76 },
    ],
    center: { x: cx, y: cy },
    box: { kind: "rect", x: x0, y: y0, w, h },
    cleanPlate: plate,
    forward: { x: facing === "left" ? -1 : 1, y: MOTION.minorAxis },
  };
}

/** Intersection over union of two normalized rects (sanity checks against a known region). */
export function rectIoU(a: MaskRect, b: MaskRect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
