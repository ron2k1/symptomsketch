import type { Router } from "express";
import {
  PreviewLeaseRequest,
  ROUTES,
  ReactorTokenRequest,
  type PreviewLeaseResponse,
  type ReactorTokenResponse,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import {
  acquireLease,
  bumpSessionCounter,
  limiterFor,
  releaseLease,
  updateLease,
} from "../domain/leases.ts";
import { getPlanRow, previewPlanId, requireOwnedActiveCase } from "../domain/plans.ts";
import { AppError } from "../http/errors.ts";
import { requireCustomerAccess } from "../http/session.ts";
import { param, parseBody } from "../http/validate.ts";
import { type X2Token, ReactorTokenError, mintX2Token } from "../providers/reactor-token.ts";

type Minter = (ctx: AppContext) => Promise<X2Token>;

const defaultMinter: Minter = (ctx) =>
  mintX2Token({ apiKey: ctx.config.reactorApiKey ?? undefined, maxSessions: 1 });
const minters = new WeakMap<AppContext, Minter>();

/** Test seam: replace the Reactor token minter for one context. */
export function setReactorMinterFor(ctx: AppContext, minter: Minter): void {
  minters.set(ctx, minter);
}

/**
 * POST ROUTES.caseReactorToken  ReactorTokenRequest -> ReactorTokenResponse
 *   Owned active case + a ready plan that is the current pointer for its purpose (or, while a
 *   newer revision waits on a clarification, its newest ready ancestor) + a free live slot. One
 *   max_sessions=1 JWT per call. The JWT is never logged or stored.
 * POST ROUTES.casePreviewLease  PreviewLeaseRequest -> PreviewLeaseResponse (heartbeat/release)
 */
export function register(router: Router, ctx: AppContext): void {
  router.post(ROUTES.caseReactorToken, async (req, res) => {
    const session = requireCustomerAccess(req);
    const kase = requireOwnedActiveCase(ctx.db, session, param(req, "caseId"));
    const input = parseBody(ReactorTokenRequest, req);
    const plan = getPlanRow(ctx.db, input.planRevisionId);
    if (!plan || plan.case_id !== kase.id) throw new AppError("NOT_FOUND");
    if (plan.status !== "ready" || !plan.reactor_prompt) {
      throw new AppError("VALIDATION_FAILED", "Finish the plan before starting the preview.", 409);
    }
    if (
      previewPlanId(ctx.db, kase, plan.purpose) !== plan.id ||
      plan.product_revision_id !== kase.product_revision_id
    ) {
      throw new AppError("PLAN_CONFLICT");
    }
    limiterFor(ctx).take("reactorToken", session.id);
    const lease = acquireLease(ctx, {
      sessionId: session.id,
      caseId: kase.id,
      planRevisionId: plan.id,
    });
    let token: X2Token;
    try {
      token = await (minters.get(ctx) ?? defaultMinter)(ctx);
    } catch (err) {
      releaseLease(ctx.db, lease.id);
      if (err instanceof ReactorTokenError) {
        console.warn(
          `[reactor] token failed code=${err.code} reason=${err.reason} status=${err.status ?? "-"}`,
        );
        throw new AppError(err.code);
      }
      console.warn("[reactor] token failed code=REACTOR_UNAVAILABLE reason=unexpected");
      throw new AppError("REACTOR_UNAVAILABLE");
    }
    bumpSessionCounter(ctx.db, session.id, "token_issues");
    console.log(`[reactor] token issued case=${kase.id} lease=${lease.id}`);
    const body: ReactorTokenResponse = {
      jwt: token.jwt,
      expiresAt: token.expiresAt,
      leaseId: lease.id,
      leaseExpiresAt: lease.expires_at,
      reactorPrompt: plan.reactor_prompt,
    };
    res.set("Cache-Control", "no-store");
    res.json(body);
  });

  router.post(ROUTES.casePreviewLease, (req, res) => {
    const session = requireCustomerAccess(req);
    const caseId = param(req, "caseId");
    const input = parseBody(PreviewLeaseRequest, req);
    if (input.action === "heartbeat") requireOwnedActiveCase(ctx.db, session, caseId);
    const body: PreviewLeaseResponse = updateLease(ctx, {
      sessionId: session.id,
      caseId,
      leaseId: input.leaseId,
      action: input.action,
    });
    res.json(body);
  });
}
