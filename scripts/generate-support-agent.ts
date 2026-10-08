/**
 * Generates the fictional support-agent base portrait with Gemini Nano Banana (run once, commit the
 * result). The person does not exist; no real photo is used as input.
 *
 *   pnpm exec tsx scripts/generate-support-agent.ts            # writes apps/web/public/assets/support-agent.jpg
 *   pnpm exec tsx scripts/generate-support-agent.ts --out tmp/agent.jpg
 *
 * Reads GEMINI_API_KEY / GEMINI_IMAGE_MODEL through the server config (root .env). Prints only the
 * model id, outcome code and latency per attempt; never the key, the prompt or image bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "../apps/server/src/config.ts";
import { createNanoBanana, nanoBananaModels } from "../apps/server/src/providers/nano-banana.ts";
import {
  BASE_PORTRAIT_PROMPT,
  PORTRAIT_ASPECT_RATIO,
  toPortraitJpeg,
} from "../apps/server/src/support/call-portrait.ts";

const config = getConfig();
const outArg = process.argv.indexOf("--out");
const out = path.resolve(
  config.repoRoot,
  outArg > 0 && process.argv[outArg + 1]
    ? process.argv[outArg + 1]!
    : "apps/web/public/assets/support-agent.jpg",
);

const client = createNanoBanana({
  apiKey: config.geminiApiKey,
  models: nanoBananaModels(config.geminiImageModel),
  onAttempt: (a) =>
    console.log(
      `nano-banana model=${a.model} ok=${a.ok} ms=${a.latencyMs}` +
        (a.ok ? "" : ` code=${a.code} reason=${a.reason} status=${a.httpStatus ?? "-"}`),
    ),
});

const image = await client.generateImage({
  prompt: BASE_PORTRAIT_PROMPT,
  aspectRatio: PORTRAIT_ASPECT_RATIO,
  timeoutMs: 180_000,
});
const jpeg = await toPortraitJpeg(image.bytes);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, jpeg);
console.log(
  `wrote ${path.relative(config.repoRoot, out)} bytes=${jpeg.length} model=${image.modelId} ` +
    `sourceMime=${image.mime} ms=${image.latencyMs}`,
);
