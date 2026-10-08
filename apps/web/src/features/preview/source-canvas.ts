import {
  STAGE_FPS,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  drawLetterboxedStill,
  type StillImage,
} from "./geometry";

export interface StillSource {
  canvas: HTMLCanvasElement;
  track: MediaStreamTrack;
  stop(): void;
}

/**
 * The X2 SOURCE canvas (docs/providers/reactor-x2.md section 7): the product still letterboxed onto
 * a fixed 16:9 canvas, repainted at 24 fps because captureStream only emits on repaint.
 * Separate from the recording canvas and the decorative stage UI (spec 12).
 */
export function createStillSource(img: StillImage): StillSource {
  const canvas = document.createElement("canvas");
  canvas.width = STAGE_WIDTH;
  canvas.height = STAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");

  const draw = () => drawLetterboxedStill(ctx, img, STAGE_WIDTH, STAGE_HEIGHT);
  draw();

  const track = canvas.captureStream(STAGE_FPS).getVideoTracks()[0];
  if (!track) throw new Error("captureStream produced no video track");
  track.contentHint = "detail"; // hold resolution, trade framerate
  const timer = window.setInterval(draw, 1000 / STAGE_FPS);
  return {
    canvas,
    track,
    stop() {
      window.clearInterval(timer);
      track.stop();
    },
  };
}
