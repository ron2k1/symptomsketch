import type { Request, Router } from "express";
import {
  FAST_H3_MODEL_NAME,
  STORY_LIMITS,
  STORY_ROUTES,
  StoryDirectorRequest,
  StoryEndingRequest,
  type StoryBeatRecord,
  type StoryDirectorResponse,
  type StoryEndingResponse,
  type StoryTokenResponse,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { fromJson, getRow } from "../db/index.ts";
import { bumpSessionCounter, limiterFor } from "../domain/leases.ts";
import { getFixture } from "../domain/catalog.ts";
import {
  type AiCaseRow,
  loadProductRevision,
  loadReferenceImage,
  requireOwnedActiveCase,
} from "../domain/plans.ts";
import { AppError } from "../http/errors.ts";
import { requireCustomerAccess, requireSupport } from "../http/session.ts";
import { param, parseBody } from "../http/validate.ts";
import { GeminiError } from "../providers/gemini-client.ts";
import { geminiFor } from "../providers/planner.ts";
import {
  FAST_H3_MODEL_RESOURCE,
  ReactorTokenError,
  mintReactorToken,
  type ReactorToken,
} from "../providers/reactor-token.ts";
import { loadTicketForSupport } from "../support/access.ts";
import { type StoryCaseData, arcState, actForBeat, runDirector } from "./director.ts";
import { runEndingDirector } from "./ending.ts";
import { latestStory, registerStorySubmit } from "./submit.ts";

type Minter = (ctx: AppContext) => Promise<ReactorToken>;

const defaultMinter: Minter = (ctx) =>
  mintReactorToken({
    apiKey: ctx.config.reactorApiKey ?? undefined,
    model: FAST_H3_MODEL_RESOURCE,
    maxSessions: 1,
    expiresAfterSeconds: 15 * 60,
    maxSessionDurationSeconds: STORY_LIMITS.tokenSessionMaxSeconds,
  });
const minters = new WeakMap<AppContext, Minter>();

/** Test seam: replace the FastH3 token minter for one context (stubs only in tests). */
export function setStoryMinterFor(ctx: AppContext, minter: Minter): void {
  minters.set(ctx, minter);
}

/** The case's account + product photo; a story needs both (the opening starts from the photo). */
async function storyCaseData(
  ctx: AppContext,
  kase: AiCaseRow & { title?: string },
  withPhoto: boolean,
): Promise<StoryCaseData> {
  const account = kase.original_account.trim();
  if (!account) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Describe what happened before telling it as a story.",
      409,
    );
  }
  const product = kase.product_revision_id
    ? loadProductRevision(ctx.db, kase.product_revision_id)
    : undefined;
  if (!product) throw new AppError("VALIDATION_FAILED", "Add a product photo first.", 409);
  const fixture = kase.fixture_id ? getFixture(ctx.config, kase.fixture_id) : null;
  return {
    productName: fixture?.name ?? kase.title ?? "the product",
    modelLabel: product.model_label ?? kase.model_label,
    account,
    actionsTried: kase.actions_tried ?? "",
    photo: withPhoto ? await loadReferenceImage(ctx, product) : null,
  };
}

function mapDirectorError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof GeminiError) {
    console.warn(
      `[story] director failed code=${err.code} reason=${err.reason} http=${err.httpStatus ?? "-"}`,
    );
    if (err.code === "ASSESSMENT_FAILED") {
      return new AppError(err.reason === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_FAILED");
    }
    return new AppError(err.code);
  }
  console.warn("[story] director failed reason=unexpected");
  return new AppError("PROVIDER_FAILED");
}

/** Rate-limit, mint one max_sessions=1 FastH3 token, count it. Errors are code-only. */
async function mintFor(ctx: AppContext, sessionId: string): Promise<StoryTokenResponse> {
  limiterFor(ctx).take("reactorToken", sessionId);
  let token: ReactorToken;
  try {
    token = await (minters.get(ctx) ?? defaultMinter)(ctx);
  } catch (err) {
    if (err instanceof ReactorTokenError) {
      console.warn(
        `[story] token failed code=${err.code} reason=${err.reason} status=${err.status ?? "-"}`,
      );
      throw new AppError(err.code);
    }
    console.warn("[story] token failed code=REACTOR_UNAVAILABLE reason=unexpected");
    throw new AppError("REACTOR_UNAVAILABLE");
  }
  bumpSessionCounter(ctx.db, sessionId, "token_issues");
  return {
    jwt: token.jwt,
    expiresAt: token.expiresAt,
    modelName: FAST_H3_MODEL_NAME,
    clipSeconds: STORY_LIMITS.clipSeconds,
    sessionMaxSeconds: STORY_LIMITS.sessionMaxSeconds,
  };
}

/** P2: support-only access to a ticket's customer story (it must have a last frame to start from). */
function endingContext(ctx: AppContext, req: Request) {
  const session = requireSupport(req);
  const ticket = loadTicketForSupport(ctx, session, param(req, "ticketId"));
  const kase = getRow<AiCaseRow & { title: string }>(
    ctx.db,
    "SELECT * FROM cases WHERE id = ?",
    ticket.case_id,
  );
  if (!kase) throw new AppError("NOT_FOUND");
  const story = latestStory(ctx.db, ticket.case_id);
  if (!story) throw new AppError("NOT_FOUND", "This ticket has no customer story yet.");
  if (!story.frame_asset_id) {
    throw new AppError("VALIDATION_FAILED", "This story has no last frame to continue from.", 409);
  }
  const beats = fromJson<{ beats?: StoryBeatRecord[] }>(story.beats_json, {}).beats ?? [];
  return { session, kase, beats };
}

/**
 * POST STORY_ROUTES.token          -> StoryTokenResponse (owner of an active case, customer access)
 * POST STORY_ROUTES.director       StoryDirectorRequest -> StoryDirectorResponse (same auth)
 * POST STORY_ROUTES.endingToken    -> StoryTokenResponse (support, on a ticket with a story)
 * POST STORY_ROUTES.endingDirector StoryEndingRequest -> StoryEndingResponse (support)
 * Send-to-support + ticket reads: ./submit.ts
 */
export function register(router: Router, ctx: AppContext): void {
  router.post(STORY_ROUTES.token, async (req, res) => {
    const session = requireCustomerAccess(req);
    const kase = requireOwnedActiveCase(ctx.db, session, param(req, "caseId"));
    await storyCaseData(ctx, kase, false);
    const body = await mintFor(ctx, session.id);
    console.log(`[story] fast-h3 token issued case=${kase.id}`);
    res.set("Cache-Control", "no-store");
    res.json(body);
  });

  router.post(STORY_ROUTES.endingToken, async (req, res) => {
    const { session, kase } = endingContext(ctx, req);
    const body = await mintFor(ctx, session.id);
    console.log(`[story] fast-h3 ending token issued case=${kase.id}`);
    res.set("Cache-Control", "no-store");
    res.json(body);
  });

  router.post(STORY_ROUTES.endingDirector, async (req, res) => {
    const { session, kase, beats } = endingContext(ctx, req);
    const input = parseBody(StoryEndingRequest, req);
    const data = await storyCaseData(ctx, kase, false);
    limiterFor(ctx).take("plan", session.id);
    bumpSessionCounter(ctx.db, session.id, "plan_calls");
    let out;
    try {
      out = await runEndingDirector(geminiFor(ctx), { beats, text: input.text }, data, {
        model: ctx.config.geminiTextModel,
      });
    } catch (err) {
      throw mapDirectorError(err);
    }
    console.log(
      `[story] ending ok case=${kase.id} scenes=${out.scenes.length} ms=${out.latencyMs}`,
    );
    const body: StoryEndingResponse = {
      scenes: out.scenes,
      modelId: out.modelId,
      latencyMs: out.latencyMs,
    };
    res.json(body);
  });

  router.post(STORY_ROUTES.director, async (req, res) => {
    const session = requireCustomerAccess(req);
    const kase = requireOwnedActiveCase(ctx.db, session, param(req, "caseId"));
    const input = parseBody(StoryDirectorRequest, req);
    const played = input.kind === "opening" ? 0 : input.beats.length;
    // Choices are for the scene after the last one played (custom writes that scene itself).
    const nextBeat = played + 1;
    const arcAfterNext = arcState(input.kind === "next" ? played : nextBeat);
    if (input.kind === "next" && arcState(played).atCap) {
      const body: StoryDirectorResponse = {
        scene: null,
        choices: [],
        act: actForBeat(played),
        offerEnd: true,
        atCap: true,
        modelId: "none",
        latencyMs: 0,
      };
      res.json(body);
      return;
    }
    const data = await storyCaseData(ctx, kase, input.kind === "opening");
    limiterFor(ctx).take("plan", session.id);
    bumpSessionCounter(ctx.db, session.id, "plan_calls");
    let out;
    try {
      out = await runDirector(geminiFor(ctx), input, data, { model: ctx.config.geminiTextModel });
    } catch (err) {
      throw mapDirectorError(err);
    }
    console.log(`[story] director ok case=${kase.id} kind=${input.kind} ms=${out.latencyMs}`);
    const opening = input.kind === "opening";
    const body: StoryDirectorResponse = {
      scene: out.scene,
      choices: out.choices,
      act: actForBeat(opening ? 2 : nextBeat),
      offerEnd: opening ? false : arcAfterNext.offerEnd,
      atCap: opening ? false : arcAfterNext.atCap,
      modelId: out.modelId,
      latencyMs: out.latencyMs,
    };
    res.json(body);
  });

  registerStorySubmit(router, ctx);
}
