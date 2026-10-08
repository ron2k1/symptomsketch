import type { Router } from "express";
import {
  LIMITS,
  ROUTES,
  SUPPORT_CALL_MODEL,
  type SupportCallTokenResponse,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { bumpSessionCounter, limiterFor } from "../domain/leases.ts";
import { AppError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { param } from "../http/validate.ts";
import { ReactorTokenError, mintReactorToken } from "../providers/reactor-token.ts";
import { loadTicketForViewer } from "./access.ts";

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
}
