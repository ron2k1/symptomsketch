import {
  STAGE_FPS,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  drawLetterboxedStill,
  stageRect,
  stillSize,
  type Rect,
  type StillImage,
} from "./geometry";
import {
  MOTION,
  poseAt,
  progressAt,
  type MaskShape,
  type MotionProgram,
  type ProductRegion,
} from "./motion-sketch";

export interface StillSource {
  canvas: HTMLCanvasElement;
  track: MediaStreamTrack;
  /** Where the still sits on the canvas (stageRect), for mapping image coords to the frame. */
  fore: Rect;
  /** Animate the product region from `t0` (performance.now() of the run's first real output frame). */
  play(program: MotionProgram, t0: number): void;
  /** Back to the untouched still (reset, or a run without a program). */
  rest(): void;
  stop(): void;
}

function traceMask(ctx: CanvasRenderingContext2D, mask: MaskShape[], grow: number): void {
  ctx.beginPath();
  for (const s of mask) {
    if (s.kind === "ellipse") {
      ctx.moveTo(s.cx + s.rx * grow, s.cy);
      ctx.ellipse(s.cx, s.cy, s.rx * grow, s.ry * grow, 0, 0, Math.PI * 2);
    } else {
      const cx = s.x + s.w / 2;
      const w = s.w * grow;
      ctx.rect(cx - w / 2, s.y, w, s.h);
    }
  }
}

/**
 * Product cut out of the still, its hole covered with a clean plate tiled from nearby empty floor,
 * then the cutout drawn translated + scaled about its centre (never the whole still: that reads as
 * a camera pan). Works in normalized image space mapped onto `fore`.
 */
function drawSketch(
  ctx: CanvasRenderingContext2D,
  img: StillImage,
  fore: Rect,
  region: ProductRegion,
  pose: { dx: number; dy: number; scale: number },
): void {
  const { w: iw, h: ih } = stillSize(img);
  const { box, cleanPlate: plate } = region;

  ctx.save();
  ctx.translate(fore.x, fore.y);
  ctx.scale(fore.w, fore.h);
  traceMask(ctx, region.mask, MOTION.maskGrow);
  ctx.clip();
  const pad = box.w * 0.05;
  for (let x = box.x - pad; x < box.x + box.w + pad; x += plate.w) {
    ctx.drawImage(
      img,
      plate.x * iw,
      plate.y * ih,
      plate.w * iw,
      plate.h * ih,
      x,
      box.y - box.h * 0.03,
      plate.w,
      plate.h,
    );
  }
  ctx.restore();

  const cx = fore.x + region.center.x * fore.w;
  const cy = fore.y + region.center.y * fore.h;
  ctx.save();
  ctx.translate(cx + pose.dx * STAGE_WIDTH, cy + pose.dy * STAGE_HEIGHT);
  ctx.scale(pose.scale, pose.scale);
  ctx.translate(-cx, -cy);
  ctx.translate(fore.x, fore.y);
  ctx.scale(fore.w, fore.h);
  traceMask(ctx, region.mask, 1);
  ctx.clip();
  ctx.drawImage(img, 0, 0, 1, 1);
  ctx.restore();
}

/**
 * The X2 SOURCE canvas (docs/providers/reactor-x2.md section 7): the product still placed on a
 * fixed 16:9 canvas by stageRect, repainted at 24 fps because captureStream only emits on repaint. With a
 * known product region, play() animates the motion sketch (section 9) on the same canvas and track.
 * Separate from the recording canvas and the decorative stage UI (spec 12).
 */
export function createStillSource(
  img: StillImage,
  region: ProductRegion | null = null,
): StillSource {
  const canvas = document.createElement("canvas");
  canvas.width = STAGE_WIDTH;
  canvas.height = STAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  const { w, h } = stillSize(img);
  const fore = stageRect(w, h, STAGE_WIDTH, STAGE_HEIGHT);
  let active: { program: MotionProgram; t0: number } | null = null;

  const draw = () => {
    drawLetterboxedStill(ctx, img, STAGE_WIDTH, STAGE_HEIGHT);
    if (!active || !region) return;
    const p = progressAt(active.program, performance.now() - active.t0);
    if (p <= 0) return; // start pose = the untouched still (no clean-plate seam before the move)
    drawSketch(ctx, img, fore, region, poseAt(active.program, p));
  };
  draw();

  const track = canvas.captureStream(STAGE_FPS).getVideoTracks()[0];
  if (!track) throw new Error("captureStream produced no video track");
  track.contentHint = "detail"; // hold resolution, trade framerate
  const timer = window.setInterval(draw, 1000 / STAGE_FPS);
  return {
    canvas,
    track,
    fore,
    play(program, t0) {
      active = region ? { program, t0 } : null;
    },
    rest() {
      active = null;
      draw();
    },
    stop() {
      window.clearInterval(timer);
      track.stop();
    },
  };
}
