// Support-agent portraits for the live AI support call (Reactor Vidu S2 Avatar create_avatar).
// Base: one fictional agent generated once with Nano Banana by scripts/generate-support-agent.ts
// and committed as apps/web/public/assets/support-agent.jpg. Per ticket: Nano Banana composites
// that same fictional agent holding the customer's own product (the ticket's normalized reference
// photo), cached on disk. Generation starts when the ticket is sent (warmTicketPortrait), so the
// composite is usually cached before the customer clicks "Talk to support now". A call that cannot
// wait for it gets the base portrait while generation finishes in the background; only a failure
// that a retry cannot fix (no product photo, a safety block) keeps the base portrait for good.
// The only generated person is the fictional agent. The customer's product photo is passed as is
// and is not screened for people.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { LIMITS, type SupportCallPortraitSource } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { getRow } from "../db/index.ts";
import { imagePart, type GeminiImageMime } from "../providers/gemini-client.ts";
import {
  createNanoBanana,
  nanoBananaModels,
  type NanoBananaClient,
} from "../providers/nano-banana.ts";
import { getLiveAsset } from "./accepted-take.ts";
import { parseSnapshot } from "./dto.ts";
import type { AttachmentRow, TicketRow } from "./rows.ts";
import { resolveStoragePath } from "./storage.ts";

/** Same aspect as the avatar's 864x1152 output. */
export const PORTRAIT_ASPECT_RATIO = "3:4";
const PORTRAIT_LONG_EDGE = 1152;

export const BASE_PORTRAIT_PROMPT = [
  "Photorealistic portrait photo of a fictional customer support agent who does not exist.",
  "One person only, framed from the head down to the waist, facing the camera straight on,",
  "centered, looking into the lens, friendly relaxed expression, mouth closed, both hands",
  "resting loosely in front at waist height. Plain forest-green crew-neck top with no logo,",
  "badge, name tag or text. Neutral light warm-grey seamless studio background, soft even",
  "front lighting, sharp focus, natural skin texture. No headset, no props, no text, no",
  "watermark. Must not resemble any real or famous person.",
].join(" ");

export function compositePrompt(productLabel: string): string {
  const product = productLabel.trim().slice(0, 120) || "the product";
  return [
    "Image 1 is a fictional AI customer support agent. Image 2 is a customer's product photo",
    `(${product}). Create a new photorealistic photo of the same fictional agent from image 1:`,
    "same face, hair, skin tone, clothing, neutral studio background and lighting, framed from",
    "the head down to the waist, facing the camera straight on, looking into the lens, mouth",
    "closed, friendly expression. The agent holds the exact product from image 2 in front of",
    "their chest with both hands so it is clearly visible, keeping the product's real shape,",
    "colors, materials and markings. If the product is too large to hold, the agent stands",
    "beside it and rests one hand on it. One person only. No text, captions, logos or watermark.",
  ].join(" ");
}

/** EXIF-free JPEG, upright, long edge <= 1152 (avatar output height). */
export async function toPortraitJpeg(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize({
      width: PORTRAIT_LONG_EDGE,
      height: PORTRAIT_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

export function basePortraitPath(ctx: AppContext): string {
  return path.join(ctx.config.repoRoot, "apps", "web", "public", "assets", "support-agent.jpg");
}

export function nanoBananaFor(ctx: AppContext): NanoBananaClient {
  let client = clients.get(ctx);
  if (!client) {
    client = createNanoBanana({
      apiKey: ctx.config.geminiApiKey,
      models: nanoBananaModels(ctx.config.geminiImageModel),
    });
    clients.set(ctx, client);
  }
  return client;
}
const clients = new WeakMap<AppContext, NanoBananaClient>();

/** Test seam: replace the image generator for one context. */
export function setNanoBananaFor(ctx: AppContext, client: NanoBananaClient): void {
  clients.set(ctx, client);
}

export type PortraitSource = SupportCallPortraitSource;

export interface TicketPortrait {
  path: string;
  source: PortraitSource;
}

function cacheDir(ctx: AppContext): string {
  return path.join(ctx.paths.root, "media", "support-agents");
}

/** True once the ticket has a composite or a remembered permanent failure (no paid call needed). */
export function portraitSettled(ctx: AppContext, ticketId: string): boolean {
  const dir = cacheDir(ctx);
  return (
    existsSync(path.join(dir, `${ticketId}.jpg`)) ||
    existsSync(path.join(dir, `${ticketId}.fallback`))
  );
}

/**
 * Failures a retry cannot fix: the ticket has no usable product photo, or the provider blocked the
 * input. Anything else (timeout, rate limit, network, provider error, config) is retried on the
 * next request instead of costing the ticket its composite for good.
 */
const PERMANENT_FAILURES = new Set(["NOT_FOUND", "PROVIDER_BLOCKED"]);

const inflight = new Map<string, Promise<TicketPortrait>>();

/**
 * The portrait this ticket's call uses, once generation settles. The composite is generated once
 * per ticket (single flight, bounded by LIMITS.supportCallPortraitGenerateTimeoutMs) and cached.
 * A permanent failure is remembered as a marker; any other failure serves the base portrait this
 * time and leaves the ticket free to try again.
 */
export function ticketPortrait(ctx: AppContext, ticket: TicketRow): Promise<TicketPortrait> {
  const dir = cacheDir(ctx);
  const composite = path.join(dir, `${ticket.id}.jpg`);
  const fallback = path.join(dir, `${ticket.id}.fallback`);
  const base: TicketPortrait = { path: basePortraitPath(ctx), source: "base" };
  if (existsSync(composite)) return Promise.resolve({ path: composite, source: "composite" });
  if (existsSync(fallback)) return Promise.resolve(base);
  const running = inflight.get(ticket.id);
  if (running) return running;
  const work = (async (): Promise<TicketPortrait> => {
    try {
      const jpeg = await compositeForTicket(ctx, ticket);
      mkdirSync(dir, { recursive: true });
      const tmp = path.join(ctx.paths.tmp, `${ticket.id}-${Date.now()}.jpg`);
      writeFileSync(tmp, jpeg);
      renameSync(tmp, composite);
      return { path: composite, source: "composite" };
    } catch (err) {
      const e = err as { code?: string; reason?: string; httpStatus?: number | null };
      const permanent = PERMANENT_FAILURES.has(e.code ?? "");
      console.warn(
        `[support-call] portrait fallback ticket=${ticket.id} code=${e.code ?? "-"} ` +
          `reason=${e.reason ?? "-"} status=${e.httpStatus ?? "-"} ` +
          (permanent ? "kept" : "will retry"),
      );
      if (permanent) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(fallback, `${e.code ?? "error"}/${e.reason ?? "-"}\n`);
      }
      return base;
    } finally {
      inflight.delete(ticket.id);
    }
  })();
  inflight.set(ticket.id, work);
  return work;
}

/**
 * What a call gets now: the composite if it is ready within waitMs, else the base portrait. A
 * composite still generating keeps going and is cached for the next call on this ticket.
 */
export async function portraitForCall(
  ctx: AppContext,
  ticket: TicketRow,
  waitMs: number = LIMITS.supportCallPortraitTimeoutMs,
): Promise<TicketPortrait> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    const ready = await Promise.race([ticketPortrait(ctx, ticket), late]);
    if (ready) return ready;
    console.warn(
      `[support-call] portrait still generating ticket=${ticket.id} waited ms=${Date.now() - started}`,
    );
    return { path: basePortraitPath(ctx), source: "base" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start the composite as soon as the ticket is sent, so it is usually cached before the first
 * call. No-op without a Gemini key (or an injected test generator); never throws.
 */
export function warmTicketPortrait(ctx: AppContext, ticketId: string): void {
  if (!ctx.config.geminiApiKey && !clients.has(ctx)) return;
  const ticket = getRow<TicketRow>(ctx.db, "SELECT * FROM tickets WHERE id = ?", ticketId);
  if (ticket) void ticketPortrait(ctx, ticket).catch(() => undefined);
}

async function compositeForTicket(ctx: AppContext, ticket: TicketRow): Promise<Buffer> {
  const grant = getRow<AttachmentRow>(
    ctx.db,
    `SELECT * FROM ticket_attachments WHERE ticket_id = ? AND purpose = 'customer_reference'
       AND revoked_at IS NULL LIMIT 1`,
    ticket.id,
  );
  const asset = grant ? getLiveAsset(ctx.db, grant.asset_id) : null;
  if (!grant || !asset || asset.sha256 !== grant.sha256) {
    throw Object.assign(new Error("no product reference"), { code: "NOT_FOUND" });
  }
  const product = readFileSync(resolveStoragePath(ctx, asset.storage_path));
  const agent = readFileSync(basePortraitPath(ctx));
  const snapshot = parseSnapshot(ticket);
  const started = Date.now();
  const image = await nanoBananaFor(ctx).generateImage({
    prompt: compositePrompt(snapshot.productLabel),
    images: [imagePart(agent, "image/jpeg"), imagePart(product, imageMime(asset.mime))],
    aspectRatio: PORTRAIT_ASPECT_RATIO,
    timeoutMs: LIMITS.supportCallPortraitGenerateTimeoutMs,
  });
  console.log(
    `[support-call] portrait composite ticket=${ticket.id} model=${image.modelId} ` +
      `ms=${Date.now() - started}`,
  );
  return toPortraitJpeg(image.bytes);
}

function imageMime(mime: string): GeminiImageMime {
  return mime === "image/png" || mime === "image/webp" ? mime : "image/jpeg";
}
