import { spawn } from "node:child_process";
import { LIMITS } from "@symptomsketch/contracts";

/**
 * FFmpeg / FFprobe process runner + the fixed argument arrays used by the export pipeline
 * (spec 12). Every call uses spawn with an argument array and `shell: false`; output paths are
 * server-generated. Tool stderr is kept on the error object for local debugging and is never
 * logged or returned to clients (it contains file paths).
 */

export type MediaToolFailure = "spawn_failed" | "exit_nonzero" | "aborted" | "output_too_large";

export class MediaToolError extends Error {
  readonly tool: string;
  readonly reason: MediaToolFailure;
  readonly exitCode: number | null;
  /** Last few KB of stderr. Debug only: never log or send to a client. */
  readonly stderrTail: string;
  constructor(tool: string, reason: MediaToolFailure, exitCode: number | null, stderrTail = "") {
    super(`${tool} ${reason}${exitCode === null ? "" : ` (exit ${exitCode})`}`);
    this.name = "MediaToolError";
    this.tool = tool;
    this.reason = reason;
    this.exitCode = exitCode;
    this.stderrTail = stderrTail;
  }
}

export interface RunToolOptions {
  signal?: AbortSignal;
  /** Kill the process after this many ms (in addition to `signal`). */
  timeoutMs?: number;
  /** Cap on buffered stdout. Default 8 MiB. */
  maxStdoutBytes?: number;
}

const STDERR_TAIL_BYTES = 4096;

function toolName(bin: string): string {
  return (bin.split(/[\\/]/).pop() ?? bin).replace(/\.exe$/i, "");
}

/** Run a media tool to completion and return its stdout. Rejects with MediaToolError. */
export function runMediaTool(
  bin: string,
  args: readonly string[],
  opts: RunToolOptions = {},
): Promise<string> {
  const name = toolName(bin);
  const maxStdout = opts.maxStdoutBytes ?? 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new MediaToolError(name, "aborted", null));
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, [...args], {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      reject(new MediaToolError(name, "spawn_failed", null));
      return;
    }
    const out: Buffer[] = [];
    let outBytes = 0;
    let errTail = "";
    let failure: MediaToolFailure | null = null;
    const kill = (reason: MediaToolFailure) => {
      if (failure === null) failure = reason;
      child.kill("SIGKILL");
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxStdout) return kill("output_too_large");
      out.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errTail = (errTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });
    const onAbort = () => kill("aborted");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer =
      opts.timeoutMs !== undefined ? setTimeout(() => kill("aborted"), opts.timeoutMs) : null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    child.once("error", () => {
      cleanup();
      reject(new MediaToolError(name, failure ?? "spawn_failed", null, errTail));
    });
    child.once("close", (code) => {
      cleanup();
      if (failure !== null) return reject(new MediaToolError(name, failure, code, errTail));
      if (code !== 0) return reject(new MediaToolError(name, "exit_nonzero", code, errTail));
      resolve(Buffer.concat(out).toString("utf8"));
    });
  });
}

/** Encoder settings for the final MP4. First pass is quality-based with a bitrate ceiling. */
export const ENCODE_POLICY = {
  preset: "veryfast",
  crf: 23,
  /** 5 Mbps x 12 s = 7.5 MB, under the 8 MiB target even at the duration cap. */
  maxrateKbps: 5000,
  bufsizeKbps: 10000,
  /** Second pass: average bitrate = budget * safety / duration. */
  retryBudgetSafety: 0.8,
  retryMinKbps: 300,
  thumbnailWidth: 480,
} as const;

export type EncodeRate = { kind: "quality" } | { kind: "bitrate"; kbps: number };

export interface EncodeArgsInput {
  input: string;
  output: string;
  /** Seconds into the raw recording where the kept segment starts (frame-accurate). */
  startSeconds: number;
  /** Length of the kept segment in seconds (already capped to finalClipMaxSeconds). */
  durationSeconds: number;
  rate: EncodeRate;
}

const secs = (n: number) => n.toFixed(3);

/**
 * Fixed ffmpeg arguments for the final MP4 (spec 12): frame-accurate trim of the lead-in, constant
 * 24 fps, contained in 1280x720 without upscaling, even dimensions, yuv420p H.264, no audio,
 * fast-start. The trim runs inside the filter graph so frames before `startSeconds` are dropped
 * after decoding (no keyframe snapping) and the first kept frame becomes t=0.
 */
export function buildEncodeArgs(o: EncodeArgsInput): string[] {
  const maxW = LIMITS.finalMaxWidth;
  const maxH = LIMITS.finalMaxHeight;
  const vf = [
    `trim=start=${secs(o.startSeconds)}:duration=${secs(o.durationSeconds)}`,
    "setpts=PTS-STARTPTS",
    `fps=${LIMITS.finalFps}`,
    `scale=w='min(${maxW},iw)':h='min(${maxH},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
  const rate =
    o.rate.kind === "quality"
      ? [
          "-crf",
          String(ENCODE_POLICY.crf),
          "-maxrate",
          `${ENCODE_POLICY.maxrateKbps}k`,
          "-bufsize",
          `${ENCODE_POLICY.bufsizeKbps}k`,
        ]
      : [
          "-b:v",
          `${o.rate.kbps}k`,
          "-maxrate",
          `${o.rate.kbps}k`,
          "-bufsize",
          `${o.rate.kbps * 2}k`,
        ];
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-v",
    "error",
    "-i",
    o.input,
    "-map",
    "0:v:0",
    "-an",
    "-sn",
    "-dn",
    "-vf",
    vf,
    "-t",
    secs(o.durationSeconds),
    "-c:v",
    "libx264",
    "-preset",
    ENCODE_POLICY.preset,
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    ...rate,
    "-fps_mode",
    "cfr",
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    o.output,
  ];
}

/** Bitrate (kbps) for the bounded second pass so the file lands under the 8 MiB target. */
export function retryBitrateKbps(durationSeconds: number): number {
  const bits = LIMITS.finalMp4MaxBytes * 8 * ENCODE_POLICY.retryBudgetSafety;
  const kbps = Math.floor(bits / Math.max(durationSeconds, 1) / 1000);
  return Math.max(ENCODE_POLICY.retryMinKbps, kbps);
}

/** Single JPEG frame from the final MP4 (take shelf by default; never upscaled). */
export function buildThumbnailArgs(
  input: string,
  output: string,
  atSeconds: number,
  maxWidth: number = ENCODE_POLICY.thumbnailWidth,
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-v",
    "error",
    "-ss",
    secs(Math.max(0, atSeconds)),
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    `scale=w='min(${maxWidth},iw)':h=-2`,
    "-q:v",
    "4",
    "-f",
    "image2",
    "-c:v",
    "mjpeg",
    output,
  ];
}

export async function encodeFinalMp4(
  ffmpegPath: string,
  input: EncodeArgsInput,
  signal?: AbortSignal,
): Promise<void> {
  await runMediaTool(ffmpegPath, buildEncodeArgs(input), { signal, maxStdoutBytes: 64 * 1024 });
}

export async function extractThumbnail(
  ffmpegPath: string,
  input: string,
  output: string,
  atSeconds: number,
  signal?: AbortSignal,
  maxWidth?: number,
): Promise<void> {
  await runMediaTool(ffmpegPath, buildThumbnailArgs(input, output, atSeconds, maxWidth), {
    signal,
    maxStdoutBytes: 64 * 1024,
  });
}
