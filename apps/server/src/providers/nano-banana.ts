// Nano Banana (Gemini image generation) over the Interactions API (@google/genai 2.28
// `ai.interactions.create` with an image `response_format`). Text plus optional reference images
// in, one image out. Used only for the fictional support-agent portrait and its per-ticket
// composite; never for a real person's likeness. See docs/providers/reactor-vidu-s2-avatar.md.
//
// Secret hygiene: never logs the key, prompts or image bytes; failures carry a bounded
// GeminiError code + reason + HTTP status only.
import { GoogleGenAI } from "@google/genai";
import {
  GeminiError,
  checkInteractionStatus,
  classifyThrown,
  raceAbort,
  type GeminiImagePart,
  type GeminiTextPart,
} from "./gemini-client.ts";

/**
 * Tried in order after GEMINI_IMAGE_MODEL (when set). A model that is unknown to this key or
 * rejects the request moves on to the next one; a block, timeout or abort stops the chain.
 */
export const NANO_BANANA_MODELS = [
  "gemini-nano-banana-2.1",
  "nano-banana-pro-preview",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
] as const;

export const NANO_BANANA_DEFAULT_TIMEOUT_MS = 90_000;

export function nanoBananaModels(configured: string | null | undefined): string[] {
  const first = configured?.trim();
  return [...new Set([...(first ? [first] : []), ...NANO_BANANA_MODELS])];
}

// ---- transport seam (real SDK in prod, a stub in unit tests) ----

export interface ImageResponseFormat {
  type: "image";
  aspect_ratio: string;
  image_size: "1K";
}

export interface ImageInteractionRequest {
  model: string;
  input: (GeminiTextPart | GeminiImagePart)[];
  response_format: ImageResponseFormat;
  store: false;
}

interface ImageBlock {
  type: string;
  data?: string;
  mime_type?: string;
}

export interface ImageInteractionLike {
  id?: string;
  status: string;
  model?: string;
  output_image?: ImageBlock;
  steps?: ReadonlyArray<{
    type: string;
    content?: ReadonlyArray<ImageBlock>;
    error?: { code?: number; message?: string };
  }>;
  errors?: ReadonlyArray<{ code?: string; message?: string }>;
}

export interface ImageTransport {
  create(
    request: ImageInteractionRequest,
    options: { signal: AbortSignal; maxRetries: number },
  ): Promise<ImageInteractionLike>;
}

function sdkTransport(apiKey: string): ImageTransport {
  const ai = new GoogleGenAI({ apiKey });
  return {
    create: async (request, options) =>
      (await ai.interactions.create(
        { ...request, stream: false } as never,
        options,
      )) as unknown as ImageInteractionLike,
  };
}

// ---- client ----

export interface GenerateImageRequest {
  prompt: string;
  /** Reference images, in the order the prompt names them. */
  images?: GeminiImagePart[];
  /** e.g. "3:4" (portrait, matches the avatar's 864x1152 output). */
  aspectRatio: string;
  /** Budget for the whole model chain. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  bytes: Buffer;
  mime: string;
  modelId: string;
  latencyMs: number;
}

export interface NanoBananaClient {
  generateImage(request: GenerateImageRequest): Promise<GeneratedImage>;
}

export interface NanoBananaOptions {
  apiKey: string | null | undefined;
  /** Model chain, first wins. Default: nanoBananaModels(null). */
  models?: readonly string[];
  maxRetries?: number;
  /** Test seam only. */
  transport?: ImageTransport;
  /** Per-model outcome hook (codes only), e.g. for the generation script's log. */
  onAttempt?: (attempt: {
    model: string;
    ok: boolean;
    latencyMs: number;
    code?: string;
    reason?: string;
    httpStatus?: number | null;
  }) => void;
}

/** Reasons that mean "this model id cannot serve this request", so the next model is tried. */
const NEXT_MODEL = new Set(["model_unavailable", "bad_request", "empty_output", "provider_error"]);

export function createNanoBanana(options: NanoBananaOptions): NanoBananaClient {
  const models = options.models?.length ? [...options.models] : nanoBananaModels(null);
  const maxRetries = options.maxRetries ?? 0;
  let transport = options.transport;
  return {
    async generateImage(request) {
      if (!transport) {
        const key = options.apiKey?.trim();
        if (!key) throw new GeminiError("CONFIG_MISSING", "missing_key");
        transport = sdkTransport(key);
      }
      const timeout = AbortSignal.timeout(request.timeoutMs ?? NANO_BANANA_DEFAULT_TIMEOUT_MS);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      let last: GeminiError = new GeminiError("CONFIG_MISSING", "model_unavailable");
      for (const model of models) {
        const started = Date.now();
        try {
          const image = await generateOnce(transport, maxRetries, model, request, signal);
          options.onAttempt?.({ model, ok: true, latencyMs: Date.now() - started });
          return { ...image, latencyMs: Date.now() - started };
        } catch (error) {
          let err: GeminiError;
          if (request.signal?.aborted) err = new GeminiError("ASSESSMENT_FAILED", "aborted");
          else if (timeout.aborted) err = new GeminiError("ASSESSMENT_FAILED", "timeout");
          else err = classifyThrown(error);
          options.onAttempt?.({
            model,
            ok: false,
            latencyMs: Date.now() - started,
            code: err.code,
            reason: err.reason,
            httpStatus: err.httpStatus,
          });
          last = err;
          if (!NEXT_MODEL.has(err.reason)) throw err;
        }
      }
      throw last;
    },
  };
}

async function generateOnce(
  transport: ImageTransport,
  maxRetries: number,
  model: string,
  request: GenerateImageRequest,
  signal: AbortSignal,
): Promise<Omit<GeneratedImage, "latencyMs">> {
  const body: ImageInteractionRequest = {
    model,
    input: [{ type: "text", text: request.prompt }, ...(request.images ?? [])],
    response_format: { type: "image", aspect_ratio: request.aspectRatio, image_size: "1K" },
    store: false,
  };
  const interaction = await raceAbort(transport.create(body, { signal, maxRetries }), signal);
  checkInteractionStatus(interaction);
  const block = firstImage(interaction);
  if (!block?.data) throw new GeminiError("ASSESSMENT_FAILED", "empty_output");
  const bytes = Buffer.from(block.data, "base64");
  if (bytes.length < 100) throw new GeminiError("ASSESSMENT_FAILED", "empty_output");
  return { bytes, mime: block.mime_type ?? "image/png", modelId: interaction.model ?? model };
}

/** `output_image` is the last image of the last model output; fall back to scanning steps. */
function firstImage(interaction: ImageInteractionLike): ImageBlock | undefined {
  if (interaction.output_image?.data) return interaction.output_image;
  const steps = interaction.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const found = steps[i]?.content?.findLast((c) => c.type === "image" && c.data);
    if (found) return found;
  }
  return undefined;
}
