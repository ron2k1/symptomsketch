import {
  STAGE_FPS,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  containRect,
  drawLetterboxedStill,
  type StillImage,
} from "@/features/preview/geometry";
import {
  fitSingleLine,
  labelFont,
  layoutCaption,
  readCanvasTheme,
  type CanvasTheme,
  type CaptionLayout,
  type RecordingLabels,
} from "./labels";

const PAD = 28;
const CAPTION_SIZES = [32, 28, 24] as const;
const CAPTION_MAX_LINES = 2;
const SCRIM_ALPHA = 0.78;

/**
 * The RECORDING canvas (spec 12): decoded main_video frames (or the canonical reference while
 * waiting for this run's first output) with permanent burned-in labels. Separate from the X2 source
 * canvas and from the stage UI; an HTML badge over the video would not reach the recorded pixels.
 */
export class RecordingCompositor {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly video: HTMLVideoElement;
  private readonly still: StillImage;
  private readonly labels: RecordingLabels;
  private readonly theme: CanvasTheme;
  private caption: CaptionLayout | null = null;
  private productText: string | null = null;
  private showOutput = false;
  private timer: number | null = null;

  constructor(
    video: HTMLVideoElement,
    still: StillImage,
    labels: RecordingLabels,
    theme: CanvasTheme = readCanvasTheme(),
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = STAGE_WIDTH;
    this.canvas.height = STAGE_HEIGHT;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unavailable");
    this.ctx = ctx;
    this.video = video;
    this.still = still;
    this.labels = labels;
    this.theme = theme;
  }

  /** Paints the reference + labels and keeps repainting at 24 fps (captureStream emits on paint). */
  start(): void {
    this.draw();
    if (this.timer === null) this.timer = window.setInterval(() => this.draw(), 1000 / STAGE_FPS);
  }

  /**
   * Call from the frame callback of a FRESH frame of this run: switches the canvas to decoded output
   * for good and paints that frame now, so the caller can timestamp the draw.
   */
  drawOutputFrame(): void {
    this.showOutput = true;
    this.draw();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private draw(): void {
    const { ctx } = this;
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    const { videoWidth, videoHeight } = this.video;
    if (this.showOutput && videoWidth > 0 && videoHeight > 0) {
      // X2 output (e.g. 1472x832) contain-fit into 1280x720: undistorted, never cropped.
      const r = containRect(videoWidth, videoHeight, STAGE_WIDTH, STAGE_HEIGHT);
      ctx.drawImage(this.video, r.x, r.y, r.w, r.h);
    } else {
      drawLetterboxedStill(ctx, this.still, STAGE_WIDTH, STAGE_HEIGHT);
    }
    this.drawLabels();
  }

  private measureAt = (s: string, px: number, weight = 600): number => {
    this.ctx.font = labelFont(weight, px);
    return this.ctx.measureText(s).width;
  };

  private drawLabels(): void {
    const { ctx, theme, labels } = this;
    ctx.save();
    ctx.textBaseline = "middle";

    // Top-left: permanent purpose label (+ generated concept note when applicable).
    const purposeLines = labels.generatedConcept
      ? [labels.purposeLabel, "Generated product concept"]
      : [labels.purposeLabel];
    const purposePx = 26;
    const purposeW = Math.max(...purposeLines.map((l) => this.measureAt(l, purposePx)));
    const lineH = purposePx * 1.35;
    const boxH = lineH * purposeLines.length + 16;
    this.scrim(PAD, PAD, purposeW + 40, boxH);
    ctx.fillStyle = theme.neon;
    ctx.fillRect(PAD, PAD, 5, boxH);
    ctx.font = labelFont(600, purposePx);
    ctx.fillStyle = theme.foreground;
    purposeLines.forEach((line, i) => {
      ctx.fillText(line, PAD + 22, PAD + 8 + lineH * i + lineH / 2);
    });

    // Top-right: product label.
    const productPx = 22;
    const maxProductW = STAGE_WIDTH * 0.38;
    this.productText ??= fitSingleLine(labels.productLabel, maxProductW, (s) =>
      this.measureAt(s, productPx, 500),
    );
    if (this.productText) {
      const w = this.measureAt(this.productText, productPx, 500);
      const x = STAGE_WIDTH - PAD - w - 32;
      this.scrim(x, PAD, w + 32, productPx * 1.35 + 16);
      ctx.fillStyle = theme.magenta;
      ctx.fillRect(x + w + 27, PAD, 5, productPx * 1.35 + 16);
      ctx.font = labelFont(500, productPx);
      ctx.fillStyle = theme.foreground;
      ctx.fillText(this.productText, x + 14, PAD + 8 + (productPx * 1.35) / 2);
    }

    // Bottom: the approved caption, full width band, never truncated.
    const maxCaptionW = STAGE_WIDTH - PAD * 4;
    this.caption ??= layoutCaption(
      labels.caption,
      maxCaptionW,
      CAPTION_MAX_LINES,
      CAPTION_SIZES,
      (s, px) => this.measureAt(s, px),
    );
    const { fontPx, lines } = this.caption;
    if (lines.length > 0) {
      const capLineH = fontPx * 1.3;
      const bandH = capLineH * lines.length + 28;
      const y = STAGE_HEIGHT - PAD - bandH;
      this.scrim(PAD, y, STAGE_WIDTH - PAD * 2, bandH);
      ctx.font = labelFont(600, fontPx);
      ctx.fillStyle = theme.foreground;
      ctx.textAlign = "center";
      lines.forEach((line, i) => {
        ctx.fillText(line, STAGE_WIDTH / 2, y + 14 + capLineH * i + capLineH / 2);
      });
    }
    ctx.restore();
  }

  private scrim(x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = SCRIM_ALPHA;
    ctx.fillStyle = this.theme.background;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.restore();
  }
}
