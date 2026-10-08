import type { Router } from "express";
import { RequestAssessmentRequest, ROUTES, type TakeResponse } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { registerAssessmentJob, requestAssessment } from "../domain/assessments.ts";
import { bumpSessionCounter, limiterFor } from "../domain/leases.ts";
import { getTakeDto, loadOwnedTake } from "../domain/takes.ts";
import { AppError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { param, parseBody } from "../http/validate.ts";

/**
 * POST ROUTES.takeAssessment  RequestAssessmentRequest -> TakeResponse (202)
 *   Owner only. Queues one critic attempt bound to the take's exact final MP4 and frozen
 *   revisions; repeats return the applicable attempt; `retry` re-runs an unavailable one.
 * Job: registers the JOB_KINDS.takeAssessment handler (critic call + server-side status).
 */
export function register(router: Router, ctx: AppContext): void {
  registerAssessmentJob(ctx);

  router.post(ROUTES.takeAssessment, (req, res) => {
    const session = requireSession(req);
    const { take, kase } = loadOwnedTake(ctx, session, param(req, "takeId"));
    const input = parseBody(RequestAssessmentRequest, req);
    requestAssessment(ctx, take.id, {
      idempotencyKey: input.idempotencyKey,
      retry: input.retry ?? false,
      beforeCreate: () => {
        if (session.role !== "support" && !session.accessGranted) {
          throw new AppError("ACCESS_REQUIRED", undefined, 403);
        }
        limiterFor(ctx).take("critic", session.id);
        bumpSessionCounter(ctx.db, session.id, "critic_calls");
      },
    });
    const dto = getTakeDto(ctx, take.id);
    if (!dto || dto.caseId !== kase.id) throw new AppError("NOT_FOUND");
    const body: TakeResponse = { take: dto };
    res.status(202).json(body);
  });
}
