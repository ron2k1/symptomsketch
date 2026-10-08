// Support-agent portraits for the live AI support call (Reactor Vidu S2 Avatar create_avatar).
// Base: one fictional agent generated once with Nano Banana by scripts/generate-support-agent.ts
// and committed as apps/web/public/assets/support-agent.jpg. Per ticket: Nano Banana composites
// that same fictional agent holding the customer's own product (the ticket's normalized reference
// photo), cached on disk. A failed or slow composite is an error the customer can retry; the
// call never silently swaps in the stock base portrait.
// Never uses a real person's photo: the only person in any input is the generated agent.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { LIMITS } from "@symptomsketch/contracts";
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

function cacheDir(ctx: AppContext): string {
  return path.join(ctx.paths.root, "media", "support-agents");
}

/** True once the ticket has a cached composite (no paid call needed). */
export function portraitSettled(ctx: AppContext, ticketId: string): boolean {
  return existsSync(path.join(cacheDir(ctx), `${ticketId}.jpg`));
}

const inflight = new Map<string, Promise<string>>();

/**
 * Path of this ticket's composite portrait. The first request per ticket generates it (single
 * flight, bounded by LIMITS.supportCallPortraitTimeoutMs); a failure rejects, nothing is cached,
 * and the next request (the customer's Retry) generates again.
 */
export function ticketPortrait(ctx: AppContext, ticket: TicketRow): Promise<string> {
  const dir = cacheDir(ctx);
  const composite = path.join(dir, `${ticket.id}.jpg`);
  if (existsSync(composite)) return Promise.resolve(composite);
  const running = inflight.get(ticket.id);
  if (running) return running;
  const work = (async (): Promise<string> => {
    try {
      const jpeg = await compositeForTicket(ctx, ticket);
      mkdirSync(dir, { recursive: true });
      const tmp = path.join(ctx.paths.tmp, `${ticket.id}-${Date.now()}.jpg`);
      writeFileSync(tmp, jpeg);
      renameSync(tmp, composite);
      return composite;
    } finally {
      inflight.delete(ticket.id);
    }
  })();
  inflight.set(ticket.id, work);
  return work;
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
    timeoutMs: LIMITS.supportCallPortraitTimeoutMs,
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
