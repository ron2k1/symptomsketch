// Live Gemini check against the real provider. Skipped unless LIVE_GEMINI=1, e.g. from apps/server:
//   $env:LIVE_GEMINI = "1"; npx tsx --test src/providers/gemini-client.live.test.ts
// Reads the key, model ids and critic fps through config.ts (root .env); needs ffmpeg on PATH.
// Prints only model id, latency, token usage and validated enum/number fields; never the key.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import { getConfig, REPO_ROOT } from "../config.ts";
import { createGeminiClient, imagePart, textPart, videoPart } from "./gemini-client.ts";

const LIVE = process.env.LIVE_GEMINI === "1";
const workDir = path.join(REPO_ROOT, "tmp", "gemini-spike");
const videoPath = path.join(workDir, "square-left.mp4");
const framePath = path.join(workDir, "square-left-start.png");

function report(label: string, fields: Record<string, unknown>): void {
  console.log(`[gemini-live] ${label} ${JSON.stringify(fields)}`);
}

function ffmpeg(args: string[]): void {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  assert.equal(run.status, 0, `ffmpeg exited ${run.status}`);
}

describe("gemini live", { skip: LIVE ? false : "set LIVE_GEMINI=1 to call the real API" }, () => {
  let client: ReturnType<typeof createGeminiClient>;
  let config: ReturnType<typeof getConfig>;

  before(() => {
    config = getConfig();
    client = createGeminiClient({ apiKey: config.geminiApiKey });

    // 6 s, 24 fps H.264 yuv420p: a white square rests right (0-2 s), slides left once (2-4 s), rests.
    mkdirSync(workDir, { recursive: true });
    ffmpeg([
      ...["-f", "lavfi", "-i", "color=c=black:s=320x240:d=6:r=24"],
      ...["-f", "lavfi", "-i", "color=c=white:s=60x60:d=6:r=24"],
      "-filter_complex",
      "[0:v][1:v]overlay=x='if(lt(t,2),230,if(lt(t,4),230-(t-2)*100,30))':y=90:eval=frame:shortest=1,format=yuv420p",
      ...[
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-t",
        "6",
        videoPath,
      ],
    ]);
    ffmpeg(["-ss", "0.5", "-i", videoPath, "-frames:v", "1", framePath]);
  });

  test("planner-like structured text call (configured thinking level)", async () => {
    const result = await client.generateStructured({
      model: config.geminiTextModel,
      system:
        "You turn a customer's account of product behavior into visible constraints. " +
        "Never invent causes. Return only JSON matching the schema.",
      parts: [
        textPart("The vacuum stops and then jerks backward once. It only happens sometimes."),
      ],
      jsonSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          constraints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                kind: { type: "string", enum: ["direction", "repetition", "timing", "frequency"] },
                expected: { type: "string" },
                critical: { type: "boolean" },
              },
              required: ["id", "kind", "expected", "critical"],
            },
          },
          clarificationQuestion: { type: ["string", "null"] },
        },
        required: ["summary", "constraints", "clarificationQuestion"],
      },
      thinkingLevel: config.geminiThinkingLevel,
      timeoutMs: 60_000,
    });
    const data = result.data as {
      summary?: unknown;
      constraints?: Array<{ kind?: string; expected?: string }>;
      clarificationQuestion?: unknown;
    };
    assert.ok(Array.isArray(data.constraints) && data.constraints.length > 0);
    const kinds = data.constraints.map((c) => c.kind);
    assert.ok(kinds.includes("direction"), "has a direction constraint");
    const direction = data.constraints.find((c) => c.kind === "direction")?.expected ?? "";
    assert.match(direction, /back/i);
    report("planner", {
      model: result.modelId,
      latencyMs: result.latencyMs,
      keys: Object.keys(data),
      kinds,
      direction: direction.slice(0, 20),
      clarificationIsNull: data.clarificationQuestion === null,
      usage: result.usage,
    });
  });

  test("critic-like video call (inline mp4 at config.criticFps + reference image)", async () => {
    const result = await client.generateStructured({
      model: config.geminiCriticModel,
      system:
        "You check what a short video visibly shows. Judge motion only from visible object " +
        "changes. Return only JSON matching the schema.",
      parts: [
        videoPart(readFileSync(videoPath), "video/mp4", config.criticFps),
        imagePart(readFileSync(framePath), "image/png"),
        textPart(
          "The image is the reference start frame. For the moving object in the video, report " +
            "its screen-relative direction, how many separate movements it makes, the time range " +
            "of the movement in seconds, and whether the video starts like the reference image.",
        ),
      ],
      jsonSchema: {
        type: "object",
        properties: {
          object: { type: "string" },
          direction: { type: "string", enum: ["left", "right", "up", "down", "none", "mixed"] },
          movementCount: { type: "integer" },
          timeRangeSeconds: {
            type: ["array", "null"],
            items: { type: "number" },
            minItems: 2,
            maxItems: 2,
          },
          startMatchesReference: { type: "boolean" },
          observation: { type: "string" },
        },
        required: [
          "object",
          "direction",
          "movementCount",
          "timeRangeSeconds",
          "startMatchesReference",
          "observation",
        ],
      },
      thinkingLevel: config.geminiThinkingLevel,
      timeoutMs: 90_000,
    });
    const data = result.data as {
      direction?: string;
      movementCount?: number;
      timeRangeSeconds?: [number, number] | null;
      startMatchesReference?: boolean;
    };
    assert.equal(data.direction, "left");
    assert.equal(data.movementCount, 1);
    assert.equal(data.startMatchesReference, true);
    report("critic", {
      requestedFps: config.criticFps,
      model: result.modelId,
      latencyMs: result.latencyMs,
      direction: data.direction,
      movementCount: data.movementCount,
      timeRangeSeconds: data.timeRangeSeconds,
      startMatchesReference: data.startMatchesReference,
      usage: result.usage,
    });
  });
});
