import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * TEST FIXTURES ONLY (never used by the live app). Synthetic MediaRecorder-like recordings made
 * with ffmpeg's lavfi sources: a solid red "lead-in" (the waiting/reference phase) followed by a
 * moving testsrc2 pattern (stand-in for generated output). Written through a pipe so the WebM has
 * no duration header, like Chrome's MediaRecorder output.
 */

export interface SyntheticRecordingOptions {
  dir: string;
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  leadInSeconds: number;
  generatedSeconds: number;
  codec?: "vp8" | "vp9";
  ffmpegPath?: string;
}

export async function makeSyntheticRecording(o: SyntheticRecordingOptions): Promise<string> {
  const w = o.width ?? 640;
  const h = o.height ?? 360;
  const fps = o.fps ?? 30;
  const out = path.join(o.dir, o.name ?? "synthetic-recording.webm");
  const graph =
    `color=c=red:s=${w}x${h}:r=${fps}:d=${o.leadInSeconds}[a];` +
    `testsrc2=s=${w}x${h}:r=${fps}:d=${o.generatedSeconds}[b];` +
    `[a][b]concat=n=2:v=1:a=0,format=yuv420p[v]`;
  const codec =
    o.codec === "vp9"
      ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1"]
      : ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8"];
  const args = [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-filter_complex",
    graph,
    "-map",
    "[v]",
    ...codec,
    "-b:v",
    "1500k",
    "-f",
    "webm",
    "pipe:1",
  ];
  const child = spawn(o.ffmpegPath ?? "ffmpeg", args, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  await pipeline(child.stdout, createWriteStream(out));
  const code = await exited;
  if (code !== 0) throw new Error(`synthetic recording failed (exit ${code})`);
  return out;
}

/** Average RGB of the first `count` frames (each frame scaled to 1x1). */
export async function firstFrameColors(
  file: string,
  count: number,
  ffmpegPath = "ffmpeg",
): Promise<[number, number, number][]> {
  const child = spawn(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostdin",
      "-v",
      "error",
      "-i",
      file,
      "-frames:v",
      String(count),
      "-vf",
      "scale=1:1:flags=area",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  const chunks: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => chunks.push(c));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
  const buf = Buffer.concat(chunks);
  const colors: [number, number, number][] = [];
  for (let i = 0; i + 2 < buf.length; i += 3) colors.push([buf[i]!, buf[i + 1]!, buf[i + 2]!]);
  return colors;
}

/** True for the solid red lead-in (allowing codec drift). */
export function isLeadInRed([r, g, b]: [number, number, number]): boolean {
  return r > 200 && g < 60 && b < 60;
}
