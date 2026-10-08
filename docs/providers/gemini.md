# Gemini provider facts (verified live 2026-10-08, ~03:00-03:30 ET)

Everything below was checked with real calls on this project's key through the installed
`@google/genai@2.28.0` (`apps/server/node_modules/@google/genai/dist/genai.d.ts`). Nothing here is
inferred from docs alone unless it says "not verified".

## Decision: Interactions API, not generateContent

- `ai.interactions.create(...)` exists in 2.28.0 (`GoogleGenAI.interactions` getter, class
  `GeminiNextGenInteractions`) and works on this key with `gemini-3.8-flash`, `gemini-3.5-flash` and
  `gemini-3.1-pro-preview` for text, image and inline video input with JSON-schema output.
- So the app uses the spec's preferred path (spec 9 + CLI prompt appendix "Verified Interactions
  fields"): `generation_config.thinking_level`, `response_format` with a JSON schema, and a video
  block with `processing: {type: "static", fps}`.
- `models.generateContent` (camelCase `thinkingConfig`, `responseJsonSchema`, `videoMetadata.fps`)
  was not needed and is not verified. Do not mix its field names into interactions requests.

Adapter: `apps/server/src/providers/gemini-client.ts`. Server code should call the adapter, not the
SDK directly.

## Model ids

| Role            | Env var               | Default                  | Verified on interactions           |
| --------------- | --------------------- | ------------------------ | ---------------------------------- |
| Planner         | `GEMINI_TEXT_MODEL`   | `gemini-3.8-flash`       | yes (text, nested schema, ~5-10 s) |
| Critic          | `GEMINI_CRITIC_MODEL` | `gemini-3.8-flash`       | yes (mp4 @ 8 fps + png, ~10-15 s)  |
| Faster fallback |                       | `gemini-3.5-flash`       | yes (text ~2.7 s, video ~4 s)      |
| Pro fallback    |                       | `gemini-3.1-pro-preview` | yes (text ~3.4 s)                  |

The response's `model` field echoes the requested id; the adapter returns it as `modelId`, which is
what assessments store (spec 9: store the model id with the result).

## Using the adapter (what server-ai should write)

```ts
import { z } from "zod";
import {
  createGeminiClient,
  GeminiError,
  imagePart,
  textPart,
  videoPart,
} from "../providers/gemini-client.ts";

// Build once at startup from config.ts values. A missing key does not throw here; the first call
// throws GeminiError CONFIG_MISSING/missing_key so the server can still boot and show the state.
const gemini = createGeminiClient({ apiKey: config.geminiApiKey });

const Plan = z.object({ summary: z.string(), constraints: z.array(z.object({ id: z.string() })) });

const result = await gemini.generateStructured({
  model: config.geminiTextModel, // "gemini-3.8-flash"
  system: PLANNER_SYSTEM_PROMPT,
  parts: [textPart(JSON.stringify(canonicalTaskData))],
  jsonSchema: planJsonSchema, // plain JSON Schema object, see "Schema gotchas"
  thinkingLevel: config.geminiThinkingLevel, // "low" | "medium" | "high" (default medium)
  timeoutMs: 60_000,
  signal: job.abortSignal, // optional
  validate: (v) => Plan.parse(v), // throw -> GeminiError ASSESSMENT_FAILED/invalid_output
});
result.data; // typed by validate
result.modelId; // "gemini-3.8-flash"
result.latencyMs; // measured around the HTTP call
result.usage; // { inputTokens, outputTokens, thoughtTokens, totalTokens }

// Critic: full MP4 inline, then the canonical reference image, then the text task.
await gemini.generateStructured({
  model: config.geminiCriticModel,
  system: CRITIC_SYSTEM_PROMPT,
  parts: [
    videoPart(mp4Bytes, "video/mp4", config.criticFps), // default 8; store as inputCoverage.requestedFps
    imagePart(sourceJpegBytes, "image/jpeg"),
    textPart(criticTaskText),
  ],
  jsonSchema: criticJsonSchema,
  timeoutMs: 90_000,
  validate: (v) => CriticOutput.parse(v),
});
```

On `GeminiError`, store an unavailable check ("Check unavailable"), never a fabricated assessment
(spec 9, 19). Persist `error.code` (+ optionally `error.reason`), never anything else from the error.

## Exact wire shape (raw SDK, copyable)

```ts
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey });
const interaction = await ai.interactions.create(
  {
    model: "gemini-3.8-flash",
    system_instruction: "You check what a short video visibly shows. Return only JSON.",
    input: [
      {
        type: "video",
        data: mp4.toString("base64"),
        mime_type: "video/mp4",
        processing: { type: "static", fps: 8 },
      },
      { type: "image", data: png.toString("base64"), mime_type: "image/png" },
      { type: "text", text: "Report direction, movement count and time range." },
    ],
    generation_config: { thinking_level: "medium" },
    response_format: { type: "text", mime_type: "application/json", schema: jsonSchema },
    store: false,
    stream: false,
  },
  { signal, maxRetries: 1 },
);
interaction.status; // "completed" on success
interaction.output_text; // SDK-added: concatenated text of the last model_output step = the JSON
interaction.steps; // [{ type: "thought" }, { type: "model_output", content: [...] }]
interaction.usage; // total_input_tokens, total_output_tokens, total_thought_tokens, total_tokens, ...
```

Field notes:

- Thinking: `generation_config.thinking_level`. On `gemini-3.8-flash`, `low` and `medium` succeed;
  `minimal` is rejected with HTTP 400 (`invalid_request`), although the SDK type allows it. The
  adapter type is `"low" | "medium" | "high"`. Do not send `thinkingConfig`/`reasoning_effort`.
- The response includes a `thought` step and `usage.total_thought_tokens`. Never surface or store
  thought content (spec 9: no internal chain-of-thought); the adapter reads only `output_text`.
- Structured output: `response_format: {type: "text", mime_type: "application/json", schema}`.
  `response_mime_type` exists on the type but is marked deprecated; do not use it.
- `store: false` worked and keeps the provider from retaining the interaction for later retrieval;
  the app never uses `previous_interaction_id` (spec 9: each request rebuilt from canonical data).
- Video: `processing: {type: "static", fps: <number>}`. Image: `{type: "image", data, mime_type}`.
  Both are inline base64. The Files API / `uri` path is not used and not verified.
- Request options: top-level `signal` is forwarded to `fetch`. `maxRetries` maps to the SDK's
  attempt-count backoff. Without it the SDK retries up to 4 times on 408/409/429/5XX with up to 30 s
  of backoff, so the adapter passes `maxRetries: 1` and also races the call against its own
  `AbortSignal.timeout(timeoutMs)` so the total wall time is bounded.

## Video sampling evidence (fps is honored)

Test clip: 6 s, 320x240, 24 fps H.264 yuv420p, white square rests right 0-2 s, slides left 2-4 s,
rests 4-6 s (`ffmpeg ... overlay=x='if(lt(t,2),230,if(lt(t,4),230-(t-2)*100,30))'`, generated by the
live test into `tmp/gemini-spike/`).

| Model            | fps | Video tokens | Answer                                 | Latency |
| ---------------- | --- | ------------ | -------------------------------------- | ------- |
| gemini-3.8-flash | 8   | 3024 (48x63) | left, 1 movement, 2.375-4.0 s          | 9.8 s   |
| gemini-3.8-flash | 1   | 378 (6x63)   | left, 1 movement, 1.7-4.2 s            | 6.5 s   |
| gemini-3.8-flash | 8   | (+ png)      | left, 1, 2.25-4.0 s, start matches ref | 14.5 s  |
| gemini-3.5-flash | 8   |              | left, 1 movement, 2.38-3.5 s           | 4.0 s   |

Video tokens scale exactly with fps x duration (63 tokens per sampled frame), so `fps: 8` is applied.
8 fps gave tighter timing than 1 fps. This proves sampling density, not frame-level accuracy (spec 9).
Budget: an 8 s clip at 8 fps is about 64 x 63 = ~4k input tokens.

## Observed latencies (gemini-3.8-flash, thinking medium unless noted)

| Call                                                     | Latency     | Thought tokens |
| -------------------------------------------------------- | ----------- | -------------- |
| Small flat schema, text only                             | 5.3 s       | 309            |
| Planner-like nested schema (constraints array, nullable) | 10.3-12.1 s | 848-994        |
| Same small call, thinking `low`                          | 1.9 s       | -              |
| Critic-like: 6 s mp4 @ 8 fps + png + text                | 9.8-17.8 s  | 1348-2054      |

Use `timeoutMs` of 60 s for the planner and 90 s for the critic; show progress copy meanwhile.

## Schema gotchas (all accepted by the API live)

- Accepted: `type: "object"` with `properties` + `required`, nested arrays of objects, `enum`,
  `integer`, `number`, `boolean`, `minItems`/`maxItems`, and nullable unions written as
  `type: ["string", "null"]` / `type: ["array", "null"]`.
- A nullable field is not a promise of null: asked for a nullable `clarificationQuestion`, the model
  returned a question string. Enforce app rules (at most one question, unresolved criticals) in zod
  and deterministic server validation, not in the schema alone.
- Prompt gotcha for the planner: with only a one-line system prompt, the model phrased the
  direction constraint's `expected` as the desired product behavior ("The vacuum should not move
  backward ...") instead of the reported symptom to reenact (`backward`). The planner prompt and
  schema should ask for short observable values (`backward`, `one`, `after stopping`) of what the
  illustration must show, and zod/server checks should keep them short.
- Schema conformance is not validation. Always pass `validate` (zod) and then the spec 9 server checks
  (constraint ID coverage, time ranges within the real duration, derived status).
- The adapter tolerates a ```json fenced reply, though none was observed with `response_format`.
- Do not use zod-to-JSON-schema features like `$ref`/`definitions`; inline everything (not tested).

## Error mapping (bounded, no provider text)

`GeminiError` has `code`, `reason`, `httpStatus`, `retryable`; its `message` contains only those.

| Situation                             | Observed                               | code / reason                                                          |
| ------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Missing/blank key                     | no call made                           | `CONFIG_MISSING` / `missing_key`                                       |
| Invalid key                           | live: HTTP 400, detail API_KEY_INVALID | `CONFIG_MISSING` / `auth`                                              |
| Unknown model id                      | live: HTTP 404                         | `CONFIG_MISSING` / `model_unavailable`                                 |
| 401 / 403                             | mapped, not observed                   | `CONFIG_MISSING` / `auth`                                              |
| 429                                   | mapped, not observed                   | `RATE_LIMITED` / `rate_limited`                                        |
| Safety block (400 or failed status)   | mapped by keyword, not observed        | `PROVIDER_BLOCKED` / `blocked`                                         |
| Our timeout fired                     | live: 300 ms budget -> 307 ms          | `ASSESSMENT_FAILED` / `timeout`                                        |
| Caller aborted                        | unit-tested                            | `ASSESSMENT_FAILED` / `aborted`                                        |
| Other 400 (e.g. `minimal`)            | live: HTTP 400                         | `ASSESSMENT_FAILED` / `bad_request`                                    |
| 5xx / network                         | mapped                                 | `ASSESSMENT_FAILED` / `provider_error` or `network`                    |
| status incomplete/budget_exceeded     | mapped                                 | `ASSESSMENT_FAILED` / `incomplete`                                     |
| Empty, non-JSON or zod-invalid output | unit-tested                            | `ASSESSMENT_FAILED` / `empty_output`, `invalid_json`, `invalid_output` |
| Inline request > 20 MB                | rejected before calling out            | `ASSESSMENT_FAILED` / `request_too_large`                              |

SDK error facts used for the mapping: interactions errors are `APIError` subclasses with numeric
`status` and a string `body` (e.g. `BadRequestError`); connection timeout/abort surface as
`APIConnectionTimeoutError` / `APIUserAbortError` with no status. The invalid-key body is a JSON
array whose `error.details[].reason` is `API_KEY_INVALID`. Bodies are inspected in-process for
classification only and never logged or returned.

## Tests

- `apps/server/src/providers/gemini-client.test.ts`: offline, stub transport; request shape, parse,
  validate, every error path. Runs in `pnpm test`.
- `apps/server/src/providers/gemini-client.live.test.ts`: real API, skipped unless `LIVE_GEMINI=1`.
  Reads key, `geminiTextModel`, `geminiCriticModel`, `geminiThinkingLevel` and `criticFps` through
  `getConfig()` (`apps/server/src/config.ts`, root `.env`); needs ffmpeg on PATH. From `apps/server`
  in PowerShell: `$env:LIVE_GEMINI = "1"; npx tsx --test src/providers/gemini-client.live.test.ts`.
  Last three runs: 2 passed each (planner 9.9-12.1 s; critic 13.2-17.8 s, always left, 1 movement,
  2.0-4.0 s or 2.25-4.0 s against a true 2.0-4.0 s, start matches the reference frame).

## Not verified

Files API upload/ACTIVE polling, the exact shape of a safety block, a real 429, streaming, and
`generateContent`. The 20 MB inline ceiling is the spec's conservative bound, not a measured limit.
