import type { Router } from "express";
import {
  CreateReplyRequest,
  CreateTicketRequest,
  CreateWorkCaseRequest,
  ROUTES,
  type CaseTicketsResponse,
  type CreateWorkCaseResponse,
  type SupportInboxResponse,
  type TicketResponse,
} from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { now } from "../db/index.ts";
import { requireSession, requireSupport } from "../http/session.ts";
import { param, parseBody, parseWith } from "../http/validate.ts";
import { loadTicketForSupport, loadTicketForViewer } from "./access.ts";
import { listInbox } from "./dto.ts";
import { serveTicketAttachment } from "./media.ts";
import { createReply } from "./replies.ts";
import { createSupportSession } from "./staff-session.ts";
import { createTicket, listCaseTickets, ticketForViewer } from "./tickets.ts";
import { createWorkCase } from "./work-case.ts";

/**
 * Owner: server-support. Demo Support service (spec 5, 11, 13, 14).
 *   POST ROUTES.supportSession          CreateSupportSessionRequest -> SessionState
 *   POST ROUTES.caseTickets             CreateTicketRequest -> TicketResponse (201; 200 on replay)
 *   GET  ROUTES.caseTickets             -> CaseTicketsResponse (case owner)
 *   GET  ROUTES.ticket                  -> TicketResponse (owner customer or support)
 *   GET  ROUTES.supportTickets          -> SupportInboxResponse (support)
 *   POST ROUTES.ticketReplies           CreateReplyRequest -> TicketResponse (201; 200 on replay)
 *   POST ROUTES.ticketWorkCase          CreateWorkCaseRequest -> CreateWorkCaseResponse (201/200)
 *   GET  ROUTES.ticketAttachmentMedia   granted attachment bytes (Range)
 *   GET  ROUTES.ticketAttachmentDownload granted attachment as download
 * Every read is a handful of indexed queries: clients poll these every 3 s.
 */
export function register(router: Router, ctx: AppContext): void {
  router.post(ROUTES.supportSession, (req, res) => {
    res.json(createSupportSession(ctx, req, res));
  });

  router.post(ROUTES.caseTickets, (req, res) => {
    const session = requireSession(req);
    const body = parseBody(CreateTicketRequest, req);
    const { ticket, created } = createTicket(ctx, session, param(req, "caseId"), body);
    const out: TicketResponse = { ticket };
    res.status(created ? 201 : 200).json(out);
  });

  router.get(ROUTES.caseTickets, (req, res) => {
    const session = requireSession(req);
    const out: CaseTicketsResponse = {
      tickets: listCaseTickets(ctx, session, param(req, "caseId")),
    };
    res.json(out);
  });

  router.get(ROUTES.supportTickets, (req, res) => {
    requireSupport(req);
    const out: SupportInboxResponse = { tickets: listInbox(ctx.db, now()) };
    res.json(out);
  });

  router.get(ROUTES.ticket, (req, res) => {
    const session = requireSession(req);
    const row = loadTicketForViewer(ctx, session, param(req, "ticketId"));
    const out: TicketResponse = { ticket: ticketForViewer(ctx, session, row) };
    res.json(out);
  });

  router.post(ROUTES.ticketReplies, (req, res) => {
    const session = requireSupport(req);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    // attachTakeId is nullable in the contract; treat an omitted field as "no attachment".
    const body = parseWith(CreateReplyRequest, { attachTakeId: null, ...raw });
    const ticket = loadTicketForSupport(ctx, session, param(req, "ticketId"));
    const created = createReply(ctx, session, ticket, body);
    const fresh = loadTicketForViewer(ctx, session, ticket.id);
    const out: TicketResponse = { ticket: ticketForViewer(ctx, session, fresh) };
    res.status(created ? 201 : 200).json(out);
  });

  router.post(ROUTES.ticketWorkCase, async (req, res) => {
    const session = requireSupport(req);
    const body = parseBody(CreateWorkCaseRequest, req);
    const ticket = loadTicketForSupport(ctx, session, param(req, "ticketId"));
    const { caseId, created } = await createWorkCase(ctx, session, ticket, body);
    const out: CreateWorkCaseResponse = { caseId };
    res.status(created ? 201 : 200).json(out);
  });

  router.get(ROUTES.ticketAttachmentMedia, async (req, res) => {
    await serveTicketAttachment(ctx, req, res, false);
  });

  router.get(ROUTES.ticketAttachmentDownload, async (req, res) => {
    await serveTicketAttachment(ctx, req, res, true);
  });
}
