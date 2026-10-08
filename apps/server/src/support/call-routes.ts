import type { Router } from "express";
import {
  LIMITS,
  ROUTES,
  SUPPORT_CALL_MODEL,
  paths,
  CreateSupportCallTranscriptRequest,
  SaveSupportCallAvatarRequest,
  type OkResponse,
  type SupportCallBriefResponse,
  type SupportCallTokenResponse,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { now } from "../db/index.ts";
import { bumpSessionCounter, limiterFor } from "../domain/leases.ts";
import { AppError } from "../http/errors.ts";
import { sendFileWithRange } from "../http/range.ts";
import { requireSession } from "../http/session.ts";
import { param, parseBody } from "../http/validate.ts";
import { GeminiError } from "../providers/gemini-client.ts";
import { ReactorTokenError, mintReactorToken } from "../providers/reactor-token.ts";
import { loadTicketForViewer } from "./access.ts";
import { cachedPackage, ensureCallPackage, getCallRow } from "./call-brief.ts";
import { portraitForCall, portraitSettled } from "./call-portrait.ts";
import { saveCallTranscript } from "./call-transcripts.ts";

/** Exactly what the route asks the minter for; the JWT itself never leaves the response body. */
export interface SupportCallMintRequest {
  model: typeof SUPPORT_CALL_MODEL;
  maxSessions: 1;
  expiresAfterSeconds: number;
  maxSessionDurationSeconds: number;
}
export type SupportCallMinter = (
  ctx: AppContext,
  req: SupportCallMintRequest,
) => Promise<{ jwt: string; expiresAt: string }>;

const defaultMinter: SupportCallMinter = (ctx, req) =>
  mintReactorToken({ apiKey: ctx.config.reactorApiKey ?? undefined, ...req });
const minters = new WeakMap<AppContext, SupportCallMinter>();

/** Test seam: replace the avatar token minter for one context. */
export function setSupportCallMinterFor(ctx: AppContext, minter: SupportCallMinter): void {
  minters.set(ctx, minter);
}

/**
 * Live AI support agent call (Reactor Vidu S2 Avatar), scoped to one ticket. Owner customer or
 * Demo Support only (loadTicketForViewer: anything else is a 404).
 *   POST ROUTES.ticketSupportCallToken -> SupportCallTokenResponse (max_sessions=1, ~300 s cap)
 *   POST ROUTES.ticketSupportCallBrief -> SupportCallBriefResponse (Gemini once per ticket, cached)
 *   GET  ROUTES.ticketSupportCallPortrait -> image/jpeg (Nano Banana composite when ready within
 *        LIMITS.supportCallPortraitTimeoutMs, else the base portrait; X-Portrait-Source says which)
 *   PUT  ROUTES.ticketSupportCallAvatar  SaveSupportCallAvatarRequest -> OkResponse
 *   POST ROUTES.ticketSupportCallTranscripts CreateSupportCallTranscriptRequest
 *        -> SupportCallTranscript (201 new, 200 replay of the same idempotency key)
 */
export function registerSupportCall(router: Router, ctx: AppContext): void {
  router.post(ROUTES.ticketSupportCallToken, async (req, res) => {
    const session = requireSession(req);
    const ticket = loadTicketForViewer(ctx, session, param(req, "ticketId"));
    limiterFor(ctx).take("avatarToken", session.id);
    const mintRequest: SupportCallMintRequest = {
      model: SUPPORT_CALL_MODEL,
      maxSessions: 1,
      expiresAfterSeconds: LIMITS.supportCallTokenExpiresSeconds,
      maxSessionDurationSeconds: LIMITS.supportCallSessionMaxSeconds,
    };
    let token: { jwt: string; expiresAt: string };
    try {
      token = await (minters.get(ctx) ?? defaultMinter)(ctx, mintRequest);
    } catch (err) {
      if (err instanceof ReactorTokenError) {
        console.warn(
          `[support-call] token failed code=${err.code} reason=${err.reason} status=${err.status ?? "-"}`,
        );
        throw new AppError(err.code);
      }
      console.warn("[support-call] token failed code=REACTOR_UNAVAILABLE reason=unexpected");
      throw new AppError("REACTOR_UNAVAILABLE");
    }
    bumpSessionCounter(ctx.db, session.id, "token_issues");
    console.log(`[support-call] token issued ticket=${ticket.id} role=${session.role}`);
    const body: SupportCallTokenResponse = {
      jwt: token.jwt,
      expiresAt: token.expiresAt,
      model: SUPPORT_CALL_MODEL,
      maxSessionDurationSeconds: LIMITS.supportCallSessionMaxSeconds,
    };
    res.set("Cache-Control", "no-store");
    res.json(body);
  });

  router.post(ROUTES.ticketSupportCallBrief, async (req, res) => {
    const session = requireSession(req);
    const ticket = loadTicketForViewer(ctx, session, param(req, "ticketId"));
    if (!cachedPackage(ctx, ticket.id)) limiterFor(ctx).take("supportCallBrief", session.id);
    let written: Awaited<ReturnType<typeof ensureCallPackage>>;
    try {
      written = await ensureCallPackage(ctx, ticket);
    } catch (err) {
      throw providerError("brief", ticket.id, err);
    }
    const body: SupportCallBriefResponse = {
      package: written.pkg,
      modelId: written.modelId,
      avatarId: getCallRow(ctx, ticket.id)?.avatar_id ?? null,
      portraitUrl: paths.ticketSupportCallPortrait(ticket.id),
    };
    res.json(body);
  });

  router.get(ROUTES.ticketSupportCallPortrait, async (req, res) => {
    const session = requireSession(req);
    const ticket = loadTicketForViewer(ctx, session, param(req, "ticketId"));
    if (!portraitSettled(ctx, ticket.id)) limiterFor(ctx).take("supportCallPortrait", session.id);
    const portrait = await portraitForCall(ctx, ticket);
    res.set("X-Portrait-Source", portrait.source);
    await sendFileWithRange(res, portrait.path, "image/jpeg");
  });

  router.put(ROUTES.ticketSupportCallAvatar, (req, res) => {
    const session = requireSession(req);
    const ticket = loadTicketForViewer(ctx, session, param(req, "ticketId"));
    const input = parseBody(SaveSupportCallAvatarRequest, req);
    const ts = now();
    ctx.db
      .prepare(
        `INSERT INTO ticket_support_calls (ticket_id, avatar_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)
         ON CONFLICT(ticket_id) DO UPDATE SET avatar_id = excluded.avatar_id,
           updated_at = excluded.updated_at`,
      )
      .run(ticket.id, input.avatarId, ts, ts);
    const body: OkResponse = { ok: true };
    res.json(body);
  });

  router.post(ROUTES.ticketSupportCallTranscripts, (req, res) => {
    const session = requireSession(req);
    const ticket = loadTicketForViewer(ctx, session, param(req, "ticketId"));
    const input = parseBody(CreateSupportCallTranscriptRequest, req);
    const { transcript, created } = saveCallTranscript(ctx, session, ticket, input);
    res.status(created ? 201 : 200).json(transcript);
  });
}

/** Bounded AppError for a Gemini failure; logs code/reason/status only. */
function providerError(step: string, ticketId: string, err: unknown): AppError {
  if (!(err instanceof GeminiError)) {
    console.warn(`[support-call] ${step} failed ticket=${ticketId} code=INTERNAL_ERROR`);
    return new AppError("PROVIDER_FAILED");
  }
  console.warn(
    `[support-call] ${step} failed ticket=${ticketId} code=${err.code} reason=${err.reason} ` +
      `status=${err.httpStatus ?? "-"}`,
  );
  if (err.code === "ASSESSMENT_FAILED") {
    return new AppError(err.reason === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_FAILED");
  }
  return new AppError(err.code);
}
