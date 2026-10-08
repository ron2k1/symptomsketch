import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { type ErrorCode, LIMITS } from "@symptomsketch/contracts";
import { JobError } from "../db/jobs.ts";
import {
  type EncodeRate,
  MediaToolError,
  encodeFinalMp4,
  extractThumbnail,
  retryBitrateKbps,
} from "./ffmpeg.ts";
import { isMp4Format, probeMedia, probePacketTiming } from "./probe.ts";

/**
 * DB-free export pipeline (spec 12 "Conversion and validation"): probe the raw MediaRecorder
 * WebM/MP4, trim the lead-in before the first generated frame, encode the final H.264 MP4 (one
 * bounded lower-bitrate pass if it exceeds 8 MiB), validate it with ffprobe, extract a thumbnail
 * and hash it. The DB/job side lives in export-worker.ts.
 */

export const TRIM_POLICY = {
  /**
   * Start the kept segment this many ms before the reported first-output offset so the first
   * generated frame survives recorder/offset clock skew (at most ~1 lead-in frame is kept).
   */
  leadGuardMs: 40,
  /** Output duration slack around the 4-12 s bounds (frame rounding at 24 fps). */
  durationToleranceSeconds: 0.1,
  /** Raw recordings may exceed the 35 s hard cap by this much (recorder stop latency). */
  rawToleranceSeconds: 1,
} as const;

export interface TrimWindow {
  startSeconds: number;
  durationSeconds: number;
}

/**
 * Pure trim decision. Generated footage = decoded duration - offset; it must be >= 4 s and is
 * capped at 12 s. Returns a bounded error code for recordings that cannot yield a valid take.
 */
export function planTrim(
  rawDurationSeconds: number,
  firstOutputOffsetMs: number,
): TrimWindow | { error: ErrorCode } {
  if (!Number.isFinite(rawDurationSeconds) || rawDurationSeconds <= 0) {
    return { error: "RECORDING_UNSUPPORTED" };
  }
  if (rawDurationSeconds > LIMITS.recordingMaxSeconds + TRIM_POLICY.rawToleranceSeconds) {
    return { error: "RECORDING_UNSUPPORTED" };
  }
  const offset = firstOutputOffsetMs / 1000;
  if (!Number.isFinite(offset) || offset < 0 || offset >= rawDurationSeconds) {
    return { error: "CAPTURE_INCOMPLETE" };
  }
  const generated = rawDurationSeconds - offset;
  if (generated < LIMITS.finalClipMinSeconds - TRIM_POLICY.durationToleranceSeconds) {
    return { error: "CAPTURE_INCOMPLETE" };
  }
  const start = Math.max(0, offset - TRIM_POLICY.leadGuardMs / 1000);
  const durationSeconds = Math.min(LIMITS.finalClipMaxSeconds, rawDurationSeconds - start);
  return { startSeconds: start, durationSeconds };
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

export interface ExportTools {
  ffmpegPath: string;
  ffprobePath: string;
}

export interface ExportedMedia {
  /** Temporary files in the work dir; the caller renames them into place. */
  mp4Path: string;
  thumbnailPath: string;
  sha256: string;
  sizeBytes: number;
  thumbnailSizeBytes: number;
  thumbnailSha256: string;
  durationMs: number;
  width: number;
  height: number;
  /** 1, or 2 when the bounded lower-bitrate pass was needed to fit 8 MiB. */
  passes: number;
}

/**
 * DB-free pipeline: probe raw -> trim/encode -> (one lower-bitrate pass if > 8 MiB) -> validate
 * with ffprobe -> thumbnail -> sha256. Writes only `<workDir>/<prefix>.*`; on any failure the
 * partial files are removed and a JobError with a bounded code is thrown.
 */
export async function exportRecording(
  tools: ExportTools,
  input: { rawPath: string; firstOutputOffsetMs: number; workDir: string; signal?: AbortSignal },
): Promise<ExportedMedia> {
  const prefix = `export-${randomBytes(8).toString("hex")}`;
  const mp4Path = path.join(input.workDir, `${prefix}.mp4`);
  const thumbnailPath = path.join(input.workDir, `${prefix}.jpg`);
  const cleanup = async () => {
    await rm(mp4Path, { force: true }).catch(() => undefined);
    await rm(thumbnailPath, { force: true }).catch(() => undefined);
  };
  await mkdir(input.workDir, { recursive: true });
  let stage: "probe_raw" | "encode" = "probe_raw";
  try {
    const raw = await probeMedia(tools.ffprobePath, input.rawPath, input.signal);
    if (!raw.video || !raw.video.width || !raw.video.height) {
      throw new JobError("RECORDING_UNSUPPORTED");
    }
    const timing = await probePacketTiming(tools.ffprobePath, input.rawPath, input.signal);
    stage = "encode";
    const window = planTrim(timing.durationSeconds, input.firstOutputOffsetMs);
    if ("error" in window) throw new JobError(window.error);

    let passes = 1;
    const encode = (rate: EncodeRate) =>
      encodeFinalMp4(
        tools.ffmpegPath,
        { input: input.rawPath, output: mp4Path, ...window, rate },
        input.signal,
      );
    await encode({ kind: "quality" });
    let size = (await stat(mp4Path)).size;
    if (size > LIMITS.finalMp4MaxBytes) {
      passes = 2;
      await encode({ kind: "bitrate", kbps: retryBitrateKbps(window.durationSeconds) });
      size = (await stat(mp4Path)).size;
      if (size > LIMITS.finalMp4MaxBytes) throw new JobError("EXPORT_FAILED");
    }

    const out = await probeMedia(tools.ffprobePath, mp4Path, input.signal);
    const v = out.video;
    const duration = out.formatDurationSeconds ?? v?.durationSeconds ?? null;
    const tol = TRIM_POLICY.durationToleranceSeconds;
    const valid =
      isMp4Format(out.formatName) &&
      v !== null &&
      v.codecName === "h264" &&
      v.pixFmt === "yuv420p" &&
      v.width !== null &&
      v.height !== null &&
      v.width % 2 === 0 &&
      v.height % 2 === 0 &&
      v.width <= LIMITS.finalMaxWidth &&
      v.height <= LIMITS.finalMaxHeight &&
      out.audioStreams === 0 &&
      duration !== null &&
      duration >= LIMITS.finalClipMinSeconds - tol &&
      duration <= LIMITS.finalClipMaxSeconds + tol;
    if (!valid || !v || v.width === null || v.height === null || duration === null) {
      throw new JobError("EXPORT_FAILED");
    }

    await extractThumbnail(
      tools.ffmpegPath,
      mp4Path,
      thumbnailPath,
      Math.min(1.5, duration / 2),
      input.signal,
    );
    const thumbStat = await stat(thumbnailPath).catch(() => null);
    if (!thumbStat || thumbStat.size === 0) throw new JobError("EXPORT_FAILED");

    return {
      mp4Path,
      thumbnailPath,
      sha256: await sha256File(mp4Path),
      sizeBytes: size,
      thumbnailSizeBytes: thumbStat.size,
      thumbnailSha256: await sha256File(thumbnailPath),
      durationMs: Math.round(duration * 1000),
      width: v.width,
      height: v.height,
      passes,
    };
  } catch (err) {
    await cleanup();
    if (err instanceof JobError) throw err;
    const aborted =
      input.signal?.aborted || (err instanceof MediaToolError && err.reason === "aborted");
    // An unreadable raw recording will not improve on retry; a crash/timeout later might.
    if (stage === "probe_raw" && !aborted) throw new JobError("RECORDING_UNSUPPORTED");
    throw new JobError("EXPORT_FAILED", { retryable: true });
  }
}
