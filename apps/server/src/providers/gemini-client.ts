// Gemini adapter over the Interactions API (@google/genai 2.28 `ai.interactions.create`).
// Verified live against gemini-3.8-flash; request shapes and gotchas: docs/providers/gemini.md.
// Never surfaces raw provider messages: callers only ever see a bounded GeminiError code + reason.
import { GoogleGenAI } from "@google/genai";
import type { ErrorCode } from "@symptomsketch/contracts";

/** gemini-3.8-flash accepts low | medium | high; "minimal" is rejected with HTTP 400 (live 2026-10-08). */
export type ThinkingLevel = "low" | "medium" | "high";

/** Conservative ceiling for the whole inline request (base64 media + text), spec 9. */
export const GEMINI_INLINE_REQUEST_LIMIT_BYTES = 20_000_000;
export const GEMINI_DEFAULT_TIMEOUT_MS = 60_000;
export const GEMINI_DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";
/** SDK default is 4 retries with up to 30 s of backoff; one retry keeps latency predictable. */
export const GEMINI_DEFAULT_MAX_RETRIES = 1;

// ---- parts (structurally identical to the SDK's interactions content blocks) ----

export type GeminiImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface GeminiTextPart {
  type: "text";
  text: string;
}
export interface GeminiImagePart {
  type: "image";
  data: string;
  mime_type: GeminiImageMime;
}
export interface GeminiVideoPart {
  type: "video";
  data: string;
  mime_type: "video/mp4";
  processing: { type: "static"; fps: number };
}
export type GeminiPart = GeminiTextPart | GeminiImagePart | GeminiVideoPart;

export function textPart(text: string): GeminiTextPart {
  return { type: "text", text };
}

export function imagePart(bytes: Uint8Array, mime: GeminiImageMime): GeminiImagePart {
  return { type: "image", data: Buffer.from(bytes).toString("base64"), mime_type: mime };
}

/** `fps` maps to `processing: {type: "static", fps}`; the provider default is 1 fps. */
export function videoPart(bytes: Uint8Array, mime: "video/mp4", fps: number): GeminiVideoPart {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("videoPart fps must be > 0");
  return {
    type: "video",
    data: Buffer.from(bytes).toString("base64"),
    mime_type: mime,
    processing: { type: "static", fps },
  };
}

// ---- errors ----

/** Subset of the contract ErrorCode, so callers can return it to the client unchanged. */
export type GeminiErrorCode = Extract<
  ErrorCode,
  "CONFIG_MISSING" | "PROVIDER_BLOCKED" | "RATE_LIMITED" | "ASSESSMENT_FAILED"
>;

export type GeminiErrorReason =
  | "missing_key"
  | "auth"
  | "model_unavailable"
  | "rate_limited"
  | "blocked"
  | "timeout"
  | "aborted"
  | "request_too_large"
  | "bad_request"
  | "provider_error"
  | "network"
  | "incomplete"
  | "empty_output"
  | "invalid_json"
  | "invalid_output";

/** Bounded error. `message` is built from code/reason/status only, never provider text. */
export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  readonly reason: GeminiErrorReason;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(code: GeminiErrorCode, reason: GeminiErrorReason, httpStatus: number | null = null) {
    super(`gemini ${code}/${reason}${httpStatus === null ? "" : ` http ${httpStatus}`}`);
    this.name = "GeminiError";
    this.code = code;
    this.reason = reason;
    this.httpStatus = httpStatus;
    this.retryable = RETRYABLE.has(reason);
  }
}

const RETRYABLE = new Set<GeminiErrorReason>([
  "rate_limited",
  "timeout",
  "provider_error",
  "network",
  "incomplete",
  "empty_output",
  "invalid_json",
  "invalid_output",
]);

// ---- transport seam (real SDK in prod, a stub in unit tests) ----

export interface InteractionRequest {
  model: string;
  system_instruction: string;
  input: GeminiPart[];
  generation_config: { thinking_level: ThinkingLevel; max_output_tokens?: number };
  response_format: { type: "text"; mime_type: "application/json"; schema: Record<string, unknown> };
  store: false;
}

export interface InteractionLike {
  id?: string;
  status: string;
  model?: string;
  output_text?: string;
  steps?: ReadonlyArray<{ type: string; error?: { code?: number; message?: string } }>;
  errors?: ReadonlyArray<{ code?: string; message?: string }>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_thought_tokens?: number;
    total_tokens?: number;
  };
}

export interface InteractionsTransport {
  create(
    request: InteractionRequest,
    options: { signal: AbortSignal; maxRetries: number },
  ): Promise<InteractionLike>;
}

function sdkTransport(apiKey: string): InteractionsTransport {
  const ai = new GoogleGenAI({ apiKey });
  return {
    create: (request, options) => ai.interactions.create({ ...request, stream: false }, options),
  };
}

// ---- adapter ----

export interface GenerateStructuredRequest<T> {
  model: string;
  system: string;
  parts: GeminiPart[];
  /** JSON Schema object sent as response_format.schema. */
  jsonSchema: Record<string, unknown>;
  thinkingLevel?: ThinkingLevel;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  /** e.g. a zod `schema.parse`; a throw becomes ASSESSMENT_FAILED/invalid_output. */
  validate?: (value: unknown) => T;
}

export interface GeminiUsage {
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
}

export interface GenerateStructuredResult<T> {
  data: T;
  modelId: string;
  latencyMs: number;
  interactionId?: string;
  usage?: GeminiUsage;
}

export interface GeminiClient {
  generateStructured<T = unknown>(
    request: GenerateStructuredRequest<T>,
  ): Promise<GenerateStructuredResult<T>>;
}

export interface GeminiClientOptions {
  /** `config.geminiApiKey`; null/blank defers a CONFIG_MISSING error to the first call. */
  apiKey: string | null | undefined;
  maxRetries?: number;
  /** Test seam only. */
  transport?: InteractionsTransport;
}

export function createGeminiClient(options: GeminiClientOptions): GeminiClient {
  const maxRetries = options.maxRetries ?? GEMINI_DEFAULT_MAX_RETRIES;
  let transport = options.transport;
  return {
    async generateStructured<T = unknown>(
      request: GenerateStructuredRequest<T>,
    ): Promise<GenerateStructuredResult<T>> {
      if (!transport) {
        const key = options.apiKey?.trim();
        if (!key) throw new GeminiError("CONFIG_MISSING", "missing_key");
        transport = sdkTransport(key);
      }
      return runStructured(transport, maxRetries, request);
    },
  };
}

async function runStructured<T>(
  transport: InteractionsTransport,
  maxRetries: number,
  req: GenerateStructuredRequest<T>,
): Promise<GenerateStructuredResult<T>> {
  if (!req.model.trim()) throw new GeminiError("CONFIG_MISSING", "model_unavailable");
  if (requestBytes(req) > GEMINI_INLINE_REQUEST_LIMIT_BYTES) {
    throw new GeminiError("ASSESSMENT_FAILED", "request_too_large");
  }
  const body: InteractionRequest = {
    model: req.model,
    system_instruction: req.system,
    input: req.parts,
    generation_config: {
      thinking_level: req.thinkingLevel ?? GEMINI_DEFAULT_THINKING_LEVEL,
      ...(req.maxOutputTokens ? { max_output_tokens: req.maxOutputTokens } : {}),
    },
    response_format: { type: "text", mime_type: "application/json", schema: req.jsonSchema },
    store: false,
  };

  const timeout = AbortSignal.timeout(req.timeoutMs ?? GEMINI_DEFAULT_TIMEOUT_MS);
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
  const started = Date.now();
  let interaction: InteractionLike;
  try {
    interaction = await raceAbort(transport.create(body, { signal, maxRetries }), signal);
  } catch (error) {
    if (req.signal?.aborted) throw new GeminiError("ASSESSMENT_FAILED", "aborted");
    if (timeout.aborted) throw new GeminiError("ASSESSMENT_FAILED", "timeout");
    throw classifyThrown(error);
  }
  const latencyMs = Date.now() - started;

  checkInteractionStatus(interaction);
  const text = interaction.output_text?.trim();
  if (!text) throw new GeminiError("ASSESSMENT_FAILED", "empty_output");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new GeminiError("ASSESSMENT_FAILED", "invalid_json");
  }
  let data: T;
  try {
    data = req.validate ? req.validate(parsed) : (parsed as T);
  } catch {
    throw new GeminiError("ASSESSMENT_FAILED", "invalid_output");
  }
  return {
    data,
    modelId: interaction.model ?? req.model,
    latencyMs,
    ...(interaction.id ? { interactionId: interaction.id } : {}),
    ...(interaction.usage ? { usage: toUsage(interaction.usage) } : {}),
  };
}

function requestBytes(req: GenerateStructuredRequest<unknown>): number {
  let total = Buffer.byteLength(req.system) + Buffer.byteLength(JSON.stringify(req.jsonSchema));
  for (const part of req.parts) {
    total += part.type === "text" ? Buffer.byteLength(part.text) : part.data.length;
  }
  return total;
}

/** Shared with the Nano Banana image adapter. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

const BLOCK_HINT = /safety|block|prohibit|recitation|spii|blocklist/i;

export function checkInteractionStatus(interaction: InteractionLike): void {
  if (interaction.status === "completed") return;
  const hints = [
    ...(interaction.errors ?? []).flatMap((e) => [e.code ?? "", e.message ?? ""]),
    ...(interaction.steps ?? []).map((s) => s.error?.message ?? ""),
  ];
  if (hints.some((h) => BLOCK_HINT.test(h))) throw new GeminiError("PROVIDER_BLOCKED", "blocked");
  if (interaction.status === "incomplete" || interaction.status === "budget_exceeded") {
    throw new GeminiError("ASSESSMENT_FAILED", "incomplete");
  }
  throw new GeminiError("ASSESSMENT_FAILED", "provider_error");
}

export function classifyThrown(error: unknown): GeminiError {
  if (error instanceof GeminiError) return error;
  const status = httpStatusOf(error);
  const name = error instanceof Error ? error.name : "";
  if (status === null) {
    if (name === "APIConnectionTimeoutError") {
      return new GeminiError("ASSESSMENT_FAILED", "timeout");
    }
    if (name === "APIUserAbortError") return new GeminiError("ASSESSMENT_FAILED", "aborted");
    return new GeminiError("ASSESSMENT_FAILED", "network");
  }
  if (status === 429) return new GeminiError("RATE_LIMITED", "rate_limited", status);
  if (status === 401 || status === 403) return new GeminiError("CONFIG_MISSING", "auth", status);
  if (status === 404) return new GeminiError("CONFIG_MISSING", "model_unavailable", status);
  if (status === 400) {
    const hint = payloadHint(error);
    // An invalid key is a 400 INVALID_ARGUMENT with detail reason API_KEY_INVALID (live-verified).
    if (/API_KEY_INVALID/.test(hint)) return new GeminiError("CONFIG_MISSING", "auth", status);
    if (BLOCK_HINT.test(hint)) return new GeminiError("PROVIDER_BLOCKED", "blocked", status);
  }
  if (status === 408 || status === 504) {
    return new GeminiError("ASSESSMENT_FAILED", "timeout", status);
  }
  if (status >= 500) return new GeminiError("ASSESSMENT_FAILED", "provider_error", status);
  return new GeminiError("ASSESSMENT_FAILED", "bad_request", status);
}

function httpStatusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status > 0 ? status : null;
}

/** Inspected locally for classification only; never returned or logged. */
function payloadHint(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const { error: payload, body } = error as { error?: unknown; body?: unknown };
  let hint = typeof body === "string" ? body.slice(0, 4000) : "";
  if (payload !== undefined) {
    try {
      hint += JSON.stringify(payload).slice(0, 4000);
    } catch {
      // unserializable payload: classify on body alone
    }
  }
  return hint;
}

function stripJsonFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  return fenced?.[1] ?? text;
}

function toUsage(usage: NonNullable<InteractionLike["usage"]>): GeminiUsage {
  return {
    ...(usage.total_input_tokens !== undefined ? { inputTokens: usage.total_input_tokens } : {}),
    ...(usage.total_output_tokens !== undefined ? { outputTokens: usage.total_output_tokens } : {}),
    ...(usage.total_thought_tokens !== undefined
      ? { thoughtTokens: usage.total_thought_tokens }
      : {}),
    ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {}),
  };
}
