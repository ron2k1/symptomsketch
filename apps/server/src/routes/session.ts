import type { Router } from "express";
import { CreateSessionRequest, ROUTES, type SessionState } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { grantCustomerAccess } from "../domain/sessions.ts";
import { sessionState } from "../http/session.ts";
import { parseBody } from "../http/validate.ts";

/**
 * GET  /api/session -> SessionState (lets the browser know whether its HttpOnly cookie is valid)
 * POST /api/session {accessCode} -> SessionState (constant-time DEMO_ACCESS_CODE check)
 * Neither response ever contains the code, the cookie token or any secret.
 */
export function register(router: Router, ctx: AppContext): void {
  router.get(ROUTES.session, (req, res) => {
    const body: SessionState = sessionState(req.session);
    res.json(body);
  });

  router.post(ROUTES.session, (req, res) => {
    const { accessCode } = parseBody(CreateSessionRequest, req);
    const body: SessionState = grantCustomerAccess(ctx, req, res, accessCode);
    res.json(body);
  });
}
