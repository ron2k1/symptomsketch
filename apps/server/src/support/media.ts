import type { Request, Response } from "express";
import type { AppContext } from "../context.ts";
import { getRow } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import { sendFileWithRange } from "../http/range.ts";
import { requireSession } from "../http/session.ts";
import { param } from "../http/validate.ts";
import { getLiveAsset } from "./accepted-take.ts";
import { loadTicketForViewer } from "./access.ts";
import { caseIsLive, getCaseLifecycle } from "./lifecycle.ts";
import type { AttachmentRow } from "./rows.ts";
import { resolveStoragePath } from "./storage.ts";

/**
 * GET /api/tickets/:ticketId/attachments/:assetId/{media,download} (spec 5, 11). Checks ticket
 * membership AND attachment membership AND the exact granted hash; the asset's own case must still
 * be live. This is the only path by which support sees customer media (no owner-route bypass).
 * `:assetId` is the attachment's assetId (contract); the attachment id is accepted too.
 */
export async function serveTicketAttachment(
  ctx: AppContext,
  req: Request,
  res: Response,
  download: boolean,
): Promise<void> {
  const session = requireSession(req);
  const ticket = loadTicketForViewer(ctx, session, param(req, "ticketId"));
  const key = param(req, "assetId");
  const grant = getRow<AttachmentRow>(
    ctx.db,
    `SELECT * FROM ticket_attachments
     WHERE ticket_id = ? AND (asset_id = ? OR id = ?) AND revoked_at IS NULL LIMIT 1`,
    ticket.id,
    key,
    key,
  );
  if (!grant) throw new AppError("NOT_FOUND");
  const asset = getLiveAsset(ctx.db, grant.asset_id);
  if (!asset || asset.sha256 !== grant.sha256) throw new AppError("NOT_FOUND");
  if (!caseIsLive(getCaseLifecycle(ctx, asset.case_id))) throw new AppError("NOT_FOUND");
  await sendFileWithRange(
    res,
    resolveStoragePath(ctx, asset.storage_path),
    asset.mime,
    download ? { download: grant.filename } : {},
  );
}
