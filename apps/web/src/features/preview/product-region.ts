import { stillSize, type StillImage } from "./geometry";
import { DEMO_VACUUM_REGION, type ProductRegion } from "./motion-sketch";

/** 12x8 block-mean luma of assets/demo/demo-vacuum.jpg (BOX-resized to 48x32, then 4x4 blocks). */
const DEMO_VACUUM_LUMA = [
  98, 106, 101, 110, 92, 97, 109, 92, 88, 88, 84, 84, 103, 115, 112, 74, 77, 113, 136, 87, 60, 67,
  66, 36, 95, 74, 32, 53, 93, 98, 92, 78, 80, 67, 60, 92, 21, 60, 100, 131, 151, 154, 133, 143, 146,
  125, 131, 140, 122, 157, 176, 180, 191, 200, 209, 212, 198, 169, 166, 165, 174, 174, 167, 163,
  218, 232, 229, 200, 138, 140, 168, 173, 160, 174, 170, 172, 120, 49, 25, 35, 61, 171, 175, 170,
  167, 180, 180, 186, 187, 169, 164, 166, 173, 165, 166, 165,
];

interface KnownStill {
  aspect: number;
  luma: readonly number[];
  region: ProductRegion;
}

/** Stills whose product region was measured. The other demo stills differ by 60+ luma levels. */
const KNOWN_STILLS: KnownStill[] = [
  { aspect: 1600 / 1067, luma: DEMO_VACUUM_LUMA, region: DEMO_VACUUM_REGION },
];
const MAX_MEAN_LUMA_DIFF = 14;
const MAX_ASPECT_DIFF = 0.02;

/** Mean absolute difference between two equal-length luma fingerprints. */
export function lumaDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
}

/** Pure matcher: the measured region for a still with this aspect + fingerprint, else null. */
export function matchKnownRegion(aspect: number, luma: readonly number[]): ProductRegion | null {
  for (const known of KNOWN_STILLS) {
    if (Math.abs(aspect - known.aspect) / known.aspect > MAX_ASPECT_DIFF) continue;
    if (lumaDistance(luma, known.luma) <= MAX_MEAN_LUMA_DIFF) return known.region;
  }
  return null;
}

function fingerprint(img: StillImage): number[] | null {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 32;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, 48, 32);
  const { data } = ctx.getImageData(0, 0, 48, 32);
  const out: number[] = [];
  for (let by = 0; by < 8; by += 1) {
    for (let bx = 0; bx < 12; bx += 1) {
      let sum = 0;
      for (let y = by * 4; y < by * 4 + 4; y += 1) {
        for (let x = bx * 4; x < bx * 4 + 4; x += 1) {
          const i = (y * 48 + x) * 4;
          sum += 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
        }
      }
      out.push(sum / 16);
    }
  }
  return out;
}

/**
 * Product region for the motion sketch. Only stills with a measured region get one (today the
 * robot-vacuum demo photo); anything else returns null and stays a static still.
 */
export function detectProductRegion(img: StillImage): ProductRegion | null {
  const { w, h } = stillSize(img);
  if (w <= 0 || h <= 0) return null;
  try {
    const luma = fingerprint(img);
    return luma ? matchKnownRegion(w / h, luma) : null;
  } catch {
    return null; // tainted or undecodable still: no sketch
  }
}
