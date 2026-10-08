import { z } from "zod";
import { runMediaTool } from "./ffmpeg.ts";

/**
 * FFprobe wrappers (spec 12 "Validate decoded duration, dimensions, and video content").
 * MediaRecorder WebM usually has no container duration, so the decoded duration comes from the
 * video packet timestamps (pts + duration of the last packet), never from the client.
 */

const num = z.preprocess((v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && v !== "N/A") return Number(v);
  return undefined;
}, z.number().finite().optional());

const RawStream = z.object({
  index: z.number().int(),
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  pix_fmt: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  duration: num,
  nb_frames: num,
});

const RawProbe = z.object({
  streams: z.array(RawStream).default([]),
  format: z
    .object({
      format_name: z.string().optional(),
      duration: num,
      size: num,
    })
    .optional(),
});

export interface ProbeStream {
  index: number;
  codecType: string;
  codecName: string;
  width: number | null;
  height: number | null;
  pixFmt: string | null;
  /** Frames per second from avg_frame_rate (or r_frame_rate), null when unknown. */
  frameRate: number | null;
  durationSeconds: number | null;
  frames: number | null;
}

export interface ProbeResult {
  /** ffprobe format_name, e.g. "matroska,webm" or "mov,mp4,m4a,3gp,3g2,mj2". */
  formatName: string;
  /** Container duration; null for most MediaRecorder WebM files. */
  formatDurationSeconds: number | null;
  sizeBytes: number | null;
  video: ProbeStream | null;
  audioStreams: number;
  streams: ProbeStream[];
}

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [n, d] = rate.split("/").map(Number);
  if (n === undefined || !Number.isFinite(n) || n <= 0) return null;
  const den = d === undefined ? 1 : d;
  if (!Number.isFinite(den) || den <= 0) return null;
  return n / den;
}

export class ProbeError extends Error {
  constructor(reason: string) {
    super(`probe: ${reason}`);
    this.name = "ProbeError";
  }
}

/** ffprobe -show_format -show_streams as JSON, normalized. Throws MediaToolError / ProbeError. */
export async function probeMedia(
  ffprobePath: string,
  file: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const stdout = await runMediaTool(
    ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { signal, timeoutMs: 30_000, maxStdoutBytes: 1024 * 1024 },
  );
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new ProbeError("unparseable output");
  }
  const parsed = RawProbe.safeParse(json);
  if (!parsed.success) throw new ProbeError("unexpected output shape");
  const streams: ProbeStream[] = parsed.data.streams.map((s) => ({
    index: s.index,
    codecType: s.codec_type ?? "unknown",
    codecName: s.codec_name ?? "unknown",
    width: s.width ?? null,
    height: s.height ?? null,
    pixFmt: s.pix_fmt ?? null,
    frameRate: parseRate(s.avg_frame_rate) ?? parseRate(s.r_frame_rate),
    durationSeconds: s.duration ?? null,
    frames: s.nb_frames ?? null,
  }));
  return {
    formatName: parsed.data.format?.format_name ?? "",
    formatDurationSeconds: parsed.data.format?.duration ?? null,
    sizeBytes: parsed.data.format?.size ?? null,
    video: streams.find((s) => s.codecType === "video") ?? null,
    audioStreams: streams.filter((s) => s.codecType === "audio").length,
    streams,
  };
}

export interface PacketTiming {
  /** Number of video packets read (frames for VP8/VP9/H.264 without B-frame reordering). */
  packets: number;
  /** Timestamp of the earliest packet. */
  firstPtsSeconds: number;
  /** Decoded duration: end of the last packet minus the first timestamp. */
  durationSeconds: number;
}

/**
 * Read every video packet timestamp of stream v:0 (no decoding, fast) and derive the real
 * duration. Works when the container has no duration header.
 */
export async function probePacketTiming(
  ffprobePath: string,
  file: string,
  signal?: AbortSignal,
): Promise<PacketTiming> {
  const stdout = await runMediaTool(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      file,
    ],
    { signal, timeoutMs: 30_000, maxStdoutBytes: 16 * 1024 * 1024 },
  );
  let packets = 0;
  let first = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const gaps: number[] = [];
  let lastPts: number | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const [ptsRaw, durRaw] = line.split(",");
    const pts = Number(ptsRaw);
    if (!Number.isFinite(pts)) continue;
    const dur = Number(durRaw);
    packets += 1;
    if (lastPts !== null && pts > lastPts && gaps.length < 240) gaps.push(pts - lastPts);
    lastPts = pts;
    first = Math.min(first, pts);
    // Missing packet duration: assume the median frame gap seen so far (or 1/30 s).
    const d = Number.isFinite(dur) && dur > 0 ? dur : (median(gaps) ?? 1 / 30);
    end = Math.max(end, pts + d);
  }
  if (packets === 0) throw new ProbeError("no video packets");
  return { packets, firstPtsSeconds: first, durationSeconds: Math.max(0, end - first) };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/** True when ffprobe's format_name says the file is an MP4 (ISO BMFF) container. */
export function isMp4Format(formatName: string): boolean {
  return formatName.split(",").includes("mp4");
}
