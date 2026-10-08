import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Request, Response, Router } from "express";
import multer from "multer";
import {
  STORY_LIMITS,
  STORY_ROUTES,
  STORY_UPLOAD_FIELDS,
  StoryBeatsUpload,
  type StorySubmitResponse,
  type TicketStory,
  type TicketStoryResponse,
  storyPaths,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { type Db, fromJson, getRow, newId, now, toJson, tx } from "../db/index.ts";
import { sniffContainer } from "../domain/take-upload.ts";
import { AppError } from "../http/errors.ts";
import { sendFileWithRange } from "../http/range.ts";
import { guard, requireCustomerAccess, requireSession } from "../http/session.ts";
import { param, parseJsonField } from "../http/validate.ts";
import { sha256File } from "../media/export-pipeline.ts";
import { caseStoragePath, resolveStoragePath } from "../media/files.ts";
import { getLiveAsset } from "../support/accepted-take.ts";
import { loadTicketForViewer } from "../support/access.ts";
import { loadOwnedCase } from "../support/tickets.ts";

/**
 * "Send this story to support" (P1). The customer's browser recorded the FastH3 stream it played
 * (webm, video + generated sound); it uploads that reel, the last frame (PNG) and the beats JSON.
 * The story belongs to the case: support reads it through the case's ticket, with the same
 * membership rules as every other ticket attachment (owner customer or a support session; anything
 * else, a revoked ticket or a dead case is a plain 404).
 *
 * The table is created here with IF NOT EXISTS instead of a numbered migration: parallel branches
 * append their own migrations, and a second "migration 2" would desync PRAGMA user_version.
 */
const STORY_TABLE = `
CREATE TABLE IF NOT EXISTS case_stories (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  owner_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  reel_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  frame_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  beats_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_stories_case ON case_stories(case_id, created_at);
`;

export interface StoryRow {
  id: string;
  case_id: string;
  ticket_id: string | null;
  reel_asset_id: string;
  frame_asset_id: string | null;
  beats_json: string;
  created_at: string;
}

export interface StoryUploadCaps {
  reelMaxBytes: number;
  lastFrameMaxBytes: number;
  beatsJsonMaxBytes: number;
}

const DEFAULT_CAPS: StoryUploadCaps = {
  reelMaxBytes: STORY_LIMITS.reelMaxBytes,
  lastFrameMaxBytes: STORY_LIMITS.lastFrameMaxBytes,
  beatsJsonMaxBytes: STORY_LIMITS.beatsJsonMaxBytes,
};
const capsByCtx = new WeakMap<AppContext, StoryUploadCaps>();

/** Test seam: smaller caps so tests can prove 413s without 80 MB bodies. */
export function setStoryUploadCapsFor(ctx: AppContext, caps: StoryUploadCaps): void {
  capsByCtx.set(ctx, caps);
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function isPng(file: string): Promise<boolean> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(8);
    const { bytesRead } = await fh.read(buf, 0, 8, 0);
    return bytesRead === 8 && buf.equals(PNG_MAGIC);
  } finally {
    await fh.close();
  }
}

function filesOf(req: Request): Record<string, Express.Multer.File[]> {
  const files = req.files;
  if (!files || Array.isArray(files)) return {};
  return files;
}

/** Newest live ticket of the case, if any. */
function liveTicketId(db: Db, caseId: string): string | null {
  const row = getRow<{ id: string }>(
    db,
    `SELECT id FROM tickets WHERE case_id = ? AND status != 'revoked'
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    caseId,
  );
  return row?.id ?? null;
}

export function latestStory(db: Db, caseId: string, storyId?: string): StoryRow | undefined {
  if (storyId) {
    return getRow<StoryRow>(
      db,
      "SELECT * FROM case_stories WHERE id = ? AND case_id = ?",
      storyId,
      caseId,
    );
  }
  return getRow<StoryRow>(
    db,
    "SELECT * FROM case_stories WHERE case_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    caseId,
  );
}

function storyDto(db: Db, row: StoryRow, viaTicketId: string | null): TicketStory {
  const upload = fromJson<StoryBeatsUpload | null>(row.beats_json, null);
  const reel = getLiveAsset(db, row.reel_asset_id);
  const v = `?story=${encodeURIComponent(row.id)}`;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    caseId: row.case_id,
    beats: upload?.beats ?? [],
    offered: upload?.offered ?? [],
    clipSeconds: upload?.clipSeconds ?? STORY_LIMITS.clipSeconds,
    durationMs: upload?.durationMs ?? 0,
    reelMime: reel?.mime ?? "video/webm",
    reelBytes: reel?.size_bytes ?? 0,
    reelUrl: viaTicketId ? `${storyPaths.ticketStoryReel(viaTicketId)}${v}` : null,
    frameUrl:
      viaTicketId && row.frame_asset_id ? `${storyPaths.ticketStoryFrame(viaTicketId)}${v}` : null,
    createdAt: row.created_at,
  };
}

function storyQuery(req: Request): string | undefined {
  const q = req.query.story;
  return typeof q === "string" && q.length > 0 && q.length <= 128 ? q : undefined;
}

async function serveStoryAsset(
  ctx: AppContext,
  req: Request,
  res: Response,
  which: "reel" | "frame",
): Promise<void> {
  const ticket = loadTicketForViewer(ctx, requireSession(req), param(req, "ticketId"));
  const story = latestStory(ctx.db, ticket.case_id, storyQuery(req));
  const assetId = story ? (which === "reel" ? story.reel_asset_id : story.frame_asset_id) : null;
  const asset = assetId ? getLiveAsset(ctx.db, assetId) : undefined;
  if (!asset || asset.case_id !== ticket.case_id) throw new AppError("NOT_FOUND");
  let file: string;
  try {
    file = resolveStoragePath(ctx.paths, asset.storage_path);
  } catch {
    throw new AppError("NOT_FOUND");
  }
  res.set("Cache-Control", "private, no-store");
  await sendFileWithRange(res, file, asset.mime);
}

interface StoredFile {
  assetId: string;
  rel: string;
  mime: string;
  size: number;
  sha256: string;
}

async function store(
  ctx: AppContext,
  caseId: string,
  file: Express.Multer.File,
  dir: "recordings" | "thumbnails",
  ext: string,
  mime: string,
): Promise<StoredFile> {
  const assetId = newId("ast");
  const rel = caseStoragePath(dir, caseId, assetId, ext);
  const abs = resolveStoragePath(ctx.paths, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await rename(file.path, abs);
  return { assetId, rel, mime, size: file.size, sha256: await sha256File(abs) };
}

/**
 * POST STORY_ROUTES.submit      multipart reel (webm/mp4) + frame (png, optional) + beats (JSON)
 *                               -> StorySubmitResponse (201; owner of the live case only)
 * GET  STORY_ROUTES.ticketStory -> TicketStoryResponse (ticket owner or support)
 * GET  STORY_ROUTES.ticketStoryReel / ticketStoryFrame  the bytes (Range), same membership
 */
export function registerStorySubmit(router: Router, ctx: AppContext): void {
  ctx.db.exec(STORY_TABLE);

  router.post(
    STORY_ROUTES.submit,
    guard.customerAccess(),
    // Reject before any bytes hit disk when the case is not the caller's live case.
    (req, _res, next) => {
      loadOwnedCase(ctx, requireCustomerAccess(req), param(req, "caseId"));
      next();
    },
    (req, res, next) => {
      const caps = capsByCtx.get(ctx) ?? DEFAULT_CAPS;
      multer({
        dest: ctx.paths.tmp,
        limits: {
          fileSize: Math.max(caps.reelMaxBytes, caps.lastFrameMaxBytes),
          files: 2,
          fields: 1,
          parts: 3,
          fieldSize: caps.beatsJsonMaxBytes,
        },
      }).fields([
        { name: STORY_UPLOAD_FIELDS.reel, maxCount: 1 },
        { name: STORY_UPLOAD_FIELDS.frame, maxCount: 1 },
      ])(req, res, next);
    },
    async (req, res) => {
      const caps = capsByCtx.get(ctx) ?? DEFAULT_CAPS;
      const files = filesOf(req);
      const all = Object.values(files).flat();
      try {
        const session = requireCustomerAccess(req);
        const kase = loadOwnedCase(ctx, session, param(req, "caseId"));
        const reel = files[STORY_UPLOAD_FIELDS.reel]?.[0];
        const frame = files[STORY_UPLOAD_FIELDS.frame]?.[0];
        if (!reel || reel.size === 0) {
          throw new AppError("VALIDATION_FAILED", "The story recording is missing.");
        }
        if (reel.size > caps.reelMaxBytes) throw new AppError("PAYLOAD_TOO_LARGE");
        if (frame && frame.size > caps.lastFrameMaxBytes) throw new AppError("PAYLOAD_TOO_LARGE");
        const raw = (req.body ?? {}) as Record<string, unknown>;
        const beats = parseJsonField(StoryBeatsUpload, raw[STORY_UPLOAD_FIELDS.beats]);
        const container = await sniffContainer(reel.path);
        if (!container) {
          throw new AppError("RECORDING_UNSUPPORTED", "The story recording is not WebM or MP4.");
        }
        if (frame && !(await isPng(frame.path))) {
          throw new AppError("VALIDATION_FAILED", "The last frame must be a PNG image.");
        }
        const count = getRow<{ n: number }>(
          ctx.db,
          "SELECT COUNT(*) AS n FROM case_stories WHERE case_id = ?",
          kase.id,
        );
        if ((count?.n ?? 0) >= STORY_LIMITS.storiesPerCaseMax) {
          throw new AppError("RATE_LIMITED", "This case already has the most stories it can send.");
        }

        const reelFile = await store(
          ctx,
          kase.id,
          reel,
          "recordings",
          container,
          container === "webm" ? "video/webm" : "video/mp4",
        );
        const frameFile = frame
          ? await store(ctx, kase.id, frame, "thumbnails", "png", "image/png")
          : null;
        const storyId = `story_${randomBytes(16).toString("base64url")}`;
        const ticketId = liveTicketId(ctx.db, kase.id);
        const ts = now();
        tx(ctx.db, () => {
          const insert = ctx.db.prepare(
            `INSERT INTO assets (id, case_id, owner_session_id, kind, mime, size_bytes, duration_ms,
               sha256, filename, storage_path, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          insert.run(
            reelFile.assetId,
            kase.id,
            session.id,
            "recording",
            reelFile.mime,
            reelFile.size,
            beats.durationMs,
            reelFile.sha256,
            `story-reel.${container}`,
            reelFile.rel,
            ts,
          );
          if (frameFile) {
            insert.run(
              frameFile.assetId,
              kase.id,
              session.id,
              "thumbnail",
              frameFile.mime,
              frameFile.size,
              null,
              frameFile.sha256,
              "story-last-frame.png",
              frameFile.rel,
              ts,
            );
          }
          ctx.db
            .prepare(
              `INSERT INTO case_stories (id, case_id, owner_session_id, ticket_id, reel_asset_id,
                 frame_asset_id, beats_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              storyId,
              kase.id,
              session.id,
              ticketId,
              reelFile.assetId,
              frameFile?.assetId ?? null,
              toJson(beats),
              ts,
            );
        });
        console.log(
          `[story] sent case=${kase.id} beats=${beats.beats.length} reelBytes=${reelFile.size} ticket=${ticketId ? "yes" : "none"}`,
        );
        const row = latestStory(ctx.db, kase.id, storyId)!;
        const body: StorySubmitResponse = { ticketId, story: storyDto(ctx.db, row, ticketId) };
        res.status(201).json(body);
      } finally {
        // No-op for files already moved into private storage.
        await Promise.all(all.map((f) => rm(f.path, { force: true }).catch(() => undefined)));
      }
    },
  );

  router.get(STORY_ROUTES.ticketStory, (req, res) => {
    const ticket = loadTicketForViewer(ctx, requireSession(req), param(req, "ticketId"));
    const row = latestStory(ctx.db, ticket.case_id);
    const body: TicketStoryResponse = { story: row ? storyDto(ctx.db, row, ticket.id) : null };
    res.json(body);
  });

  router.get(STORY_ROUTES.ticketStoryReel, async (req, res) => {
    await serveStoryAsset(ctx, req, res, "reel");
  });

  router.get(STORY_ROUTES.ticketStoryFrame, async (req, res) => {
    await serveStoryAsset(ctx, req, res, "frame");
  });
}
