import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { LIMITS } from "@symptomsketch/contracts";
import { JobError } from "../db/jobs.ts";
import { exportRecording, planTrim, sha256File, TRIM_POLICY } from "./export-pipeline.ts";
import { buildEncodeArgs, retryBitrateKbps } from "./ffmpeg.ts";
import { probeMedia, probePacketTiming } from "./probe.ts";
import { firstFrameColors, isLeadInRed, makeSyntheticRecording } from "./testing.ts";

const tools = { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" };
let dir: string;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ss-export-"));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("planTrim", () => {
  test("keeps the generated segment, guards the first frame, caps at 12 s", () => {
    const w = planTrim(10, 1500);
    assert.ok(!("error" in w));
    assert.equal(w.startSeconds, 1.5 - TRIM_POLICY.leadGuardMs / 1000);
    assert.ok(Math.abs(w.durationSeconds - (10 - w.startSeconds)) < 1e-9);
    const capped = planTrim(30, 2000);
    assert.ok(!("error" in capped));
    assert.equal(capped.durationSeconds, LIMITS.finalClipMaxSeconds);
  });
  test("rejects too little generated footage, bad offsets and over-long raw media", () => {
    assert.deepEqual(planTrim(5, 2000), { error: "CAPTURE_INCOMPLETE" });
    assert.deepEqual(planTrim(10, 10_000), { error: "CAPTURE_INCOMPLETE" });
    assert.deepEqual(planTrim(10, 12_000), { error: "CAPTURE_INCOMPLETE" });
    assert.deepEqual(planTrim(40, 1000), { error: "RECORDING_UNSUPPORTED" });
    assert.deepEqual(planTrim(0, 0), { error: "RECORDING_UNSUPPORTED" });
  });
});

test("encode args are a fixed array: H.264, yuv420p, 24 fps CFR, no audio, faststart", () => {
  const args = buildEncodeArgs({
    input: "in.webm",
    output: "out.mp4",
    startSeconds: 1.46,
    durationSeconds: 8.54,
    rate: { kind: "quality" },
  });
  const joined = args.join(" ");
  for (const needle of ["libx264", "yuv420p", "+faststart", "-an", "fps=24", "-fps_mode cfr"]) {
    assert.ok(joined.includes(needle), needle);
  }
  assert.ok(joined.includes("trim=start=1.460:duration=8.540"));
  assert.ok(joined.includes("min(1280,iw)") && joined.includes("min(720,ih)"));
  assert.ok(retryBitrateKbps(12) * 1000 * 12 < LIMITS.finalMp4MaxBytes * 8);
});

test("MediaRecorder-like WebM without a duration header: packet timing gives the real length", async () => {
  const raw = await makeSyntheticRecording({
    dir,
    name: "nodur.webm",
    leadInSeconds: 1,
    generatedSeconds: 4,
  });
  const probe = await probeMedia("ffprobe", raw);
  assert.equal(probe.formatDurationSeconds, null);
  const timing = await probePacketTiming("ffprobe", raw);
  assert.ok(Math.abs(timing.durationSeconds - 5) < 0.05, `duration ${timing.durationSeconds}`);
});

test("export: 10 s VP8 WebM at offset 1500 ms -> trimmed H.264 MP4 within bounds", async () => {
  const raw = await makeSyntheticRecording({
    dir,
    name: "raw-720p.webm",
    width: 1280,
    height: 720,
    leadInSeconds: 1.5,
    generatedSeconds: 8.5,
  });
  const work = path.join(dir, "work");
  const out = await exportRecording(tools, {
    rawPath: raw,
    firstOutputOffsetMs: 1500,
    workDir: work,
  });

  const probe = await probeMedia("ffprobe", out.mp4Path);
  assert.ok(probe.formatName.split(",").includes("mp4"));
  assert.equal(probe.video?.codecName, "h264");
  assert.equal(probe.video?.pixFmt, "yuv420p");
  assert.equal(probe.audioStreams, 0);
  assert.equal(out.width, 1280);
  assert.equal(out.height, 720);
  assert.equal(probe.video?.frameRate, 24);
  const seconds = out.durationMs / 1000;
  assert.ok(seconds >= 4 && seconds <= 12, `duration ${seconds}`);
  // The whole generated segment survives: 8.5 s of generated footage (+ the 40 ms guard).
  assert.ok(Math.abs(seconds - 8.5) <= 0.15, `duration ${seconds}`);
  assert.ok(out.sizeBytes < LIMITS.finalMp4MaxBytes);
  assert.equal(statSync(out.mp4Path).size, out.sizeBytes);
  assert.ok(existsSync(out.thumbnailPath) && statSync(out.thumbnailPath).size > 0);
  // Hash is of the exact bytes and stable.
  assert.equal(await sha256File(out.mp4Path), out.sha256);
  assert.equal(await sha256File(out.mp4Path), out.sha256);
  assert.match(out.sha256, /^[a-f0-9]{64}$/);

  // Lead-in removed: at most one guard frame of the red reference, then generated frames.
  const colors = await firstFrameColors(out.mp4Path, 4);
  assert.equal(colors.length, 4);
  assert.ok(
    colors.slice(1).every((c) => !isLeadInRed(c)),
    JSON.stringify(colors),
  );
});

test("export: 1080p VP9 is contained in 1280x720 (even dims), small sources are not upscaled", async () => {
  const big = await makeSyntheticRecording({
    dir,
    name: "raw-1080p.webm",
    width: 1920,
    height: 1080,
    leadInSeconds: 0.5,
    generatedSeconds: 4.6,
    codec: "vp9",
  });
  const a = await exportRecording(tools, {
    rawPath: big,
    firstOutputOffsetMs: 500,
    workDir: path.join(dir, "work-big"),
  });
  assert.deepEqual([a.width, a.height], [1280, 720]);

  const small = await makeSyntheticRecording({
    dir,
    name: "raw-small.webm",
    width: 480,
    height: 270,
    leadInSeconds: 0.2,
    generatedSeconds: 4.5,
  });
  const b = await exportRecording(tools, {
    rawPath: small,
    firstOutputOffsetMs: 200,
    workDir: path.join(dir, "work-small"),
  });
  assert.deepEqual([b.width, b.height], [480, 270]);
});

test("export: under 4 s of generated footage fails with a bounded code and leaves no partials", async () => {
  const raw = await makeSyntheticRecording({
    dir,
    name: "short.webm",
    leadInSeconds: 2,
    generatedSeconds: 2.5,
  });
  const work = path.join(dir, "work-short");
  await assert.rejects(
    exportRecording(tools, { rawPath: raw, firstOutputOffsetMs: 2000, workDir: work }),
    (err: unknown) =>
      err instanceof JobError && err.code === "CAPTURE_INCOMPLETE" && !err.retryable,
  );
  assert.deepEqual(readdirSync(work), []);
});

test("export: a non-video file is RECORDING_UNSUPPORTED (not retryable)", async () => {
  const work = path.join(dir, "work-bad");
  const bogus = path.join(dir, "bogus.webm");
  (await import("node:fs")).writeFileSync(bogus, Buffer.from("not a video at all"));
  await assert.rejects(
    exportRecording(tools, { rawPath: bogus, firstOutputOffsetMs: 0, workDir: work }),
    (err: unknown) =>
      err instanceof JobError && err.code === "RECORDING_UNSUPPORTED" && !err.retryable,
  );
  assert.deepEqual(readdirSync(work), []);
});

test("export: an aborted job is EXPORT_FAILED and retryable", async () => {
  const raw = path.join(dir, "raw-720p.webm");
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    exportRecording(tools, {
      rawPath: raw,
      firstOutputOffsetMs: 1500,
      workDir: path.join(dir, "work-abort"),
      signal: ac.signal,
    }),
    (err: unknown) => err instanceof JobError && err.code === "EXPORT_FAILED" && err.retryable,
  );
});
