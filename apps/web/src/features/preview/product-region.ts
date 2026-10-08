import type { ProductRegion } from "./motion-sketch";

/**
 * Product region for the motion sketch. There is no live source for it yet, so every photo gets
 * null and X2 receives the plain still plus the compiled prompt. A region measured by hand for one
 * demo photo and matched by fingerprint used to live here; it made the demo product move on the
 * source canvas while any other photo stayed still, so it was removed. A Gemini-detected region
 * (box_2d) is the intended replacement.
 */
export function detectProductRegion(): ProductRegion | null {
  return null;
}
