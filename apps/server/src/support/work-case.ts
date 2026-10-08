import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { LIMITS, type CreateWorkCaseRequest } from "@symptomsketch/contracts";
import type { AppContext } from "../context.ts";
import { fromJson, fromNow, getRow, newId, now, toJson, tx } from "../db/index.ts";
import { AppError } from "../http/errors.ts";
import type { SessionInfo } from "../http/session.ts";
import { getLiveAsset } from "./accepted-take.ts";
import { parseSnapshot } from "./dto.ts";
import { caseStoragePath, removeCaseDirs } from "../media/files.ts";
import { resolveStoragePath } from "./storage.ts";
import type { AssetRow, AttachmentRow, ProductRevisionRow, TicketRow } from "./rows.ts";

/**
 * POST /api/tickets/:ticketId/work-case (support only, spec 5 step 3 + attachment permissions).
 * Creates an agent-owned solution case with lineage to the ticket and a case-owned COPY of the
 * submitted normalized reference (never a pointer to the customer's asset id). One per
 * ticket + support session; repeated calls return the same case.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function existingWorkCase(ctx: AppContext, ticketId: string, sessionId: string): string | null {
  const row = getRow<{ id: string }>(
    ctx.db,
    `SELECT id FROM cases WHERE source_ticket_id = ? AND owner_session_id = ?
       AND owner_role = 'support' AND status = 'active' ORDER BY created_at LIMIT 1`,
    ticketId,
    sessionId,
  );
  return row?.id ?? null;
}

interface CopiedFile {
  assetId: string;
  abs: string;
  storagePath: string;
  source: AssetRow;
  grant: AttachmentRow;
  kind: "original" | "normalized";
}

/** Copy the granted bytes to a new case-owned file and verify the hash matches the grant. */
async function copyGranted(
  ctx: AppContext,
  caseId: string,
  grant: AttachmentRow,
  kind: "original" | "normalized",
): Promise<CopiedFile> {
  const source = getLiveAsset(ctx.db, grant.asset_id);
  if (!source || source.sha256 !== grant.sha256) {
    throw new AppError("NOT_FOUND", "The submitted reference is no longer available.");
  }
  const assetId = newId("ast");
  const ext = path.extname(source.storage_path).slice(1).toLowerCase();
  const storagePath = caseStoragePath(
    kind === "original" ? "originals" : "normalized",
    caseId,
    assetId,
    /^[a-z0-9]{1,8}$/.test(ext) ? ext : "jpg",
  );
  const abs = resolveStoragePath(ctx, storagePath);
  try {
    await mkdir(path.dirname(abs), { recursive: true });
    await copyFile(resolveStoragePath(ctx, source.storage_path), abs, fsConstants.COPYFILE_EXCL);
  } catch {
    throw new AppError("NOT_FOUND", "The submitted reference is no longer available.");
  }
  const digest = createHash("sha256")
    .update(await readFile(abs))
    .digest("hex");
  if (digest !== grant.sha256) {
    await rm(abs, { force: true });
    throw new AppError("NOT_FOUND", "The submitted reference is no longer available.");
  }
  return { assetId, abs, storagePath, source, grant, kind };
}

function grantFor(ctx: AppContext, ticketId: string, purpose: string): AttachmentRow | undefined {
  return getRow<AttachmentRow>(
    ctx.db,
    `SELECT * FROM ticket_attachments WHERE ticket_id = ? AND purpose = ? AND revoked_at IS NULL
     ORDER BY created_at LIMIT 1`,
    ticketId,
    purpose,
  );
}

export async function createWorkCase(
  ctx: AppContext,
  session: SessionInfo,
  ticket: TicketRow,
  body: CreateWorkCaseRequest,
): Promise<{ caseId: string; created: boolean }> {
  const prior = existingWorkCase(ctx, ticket.id, session.id);
  if (prior) return { caseId: prior, created: false };

  const referenceGrant = grantFor(ctx, ticket.id, "customer_reference");
  if (!referenceGrant) {
    throw new AppError("NOT_FOUND", "The submitted reference is no longer available.");
  }
  // The work case's "original" is the customer's untouched original only if they included it.
  const originalGrant = grantFor(ctx, ticket.id, "customer_original") ?? referenceGrant;
  const lineage = fromJson<{ productRevisionId?: unknown }>(referenceGrant.lineage_json, {});
  const sourceProduct =
    typeof lineage.productRevisionId === "string"
      ? getRow<ProductRevisionRow>(
          ctx.db,
          "SELECT * FROM product_revisions WHERE id = ?",
          lineage.productRevisionId,
        )
      : undefined;
  const snap = parseSnapshot(ticket);

  const caseId = newId("case");
  const copies: CopiedFile[] = [];
  // The new case id is uncommitted until the tx below, so its folders hold only these copies.
  const removeCopies = () => removeCaseDirs(ctx.paths, caseId);
  try {
    copies.push(await copyGranted(ctx, caseId, referenceGrant, "normalized"));
    copies.push(await copyGranted(ctx, caseId, originalGrant, "original"));
  } catch (err) {
    await removeCopies();
    throw err;
  }
  const [normalized, original] = copies as [CopiedFile, CopiedFile];

  let result: { caseId: string; created: boolean };
  try {
    result = insertWorkCase(ctx, session, ticket, body, {
      caseId,
      snap,
      sourceProduct,
      original,
      normalized,
    });
  } catch (err) {
    await removeCopies();
    throw err;
  }
  if (!result.created) await removeCopies();
  return result;
}

interface WorkCaseSources {
  caseId: string;
  snap: ReturnType<typeof parseSnapshot>;
  sourceProduct: ProductRevisionRow | undefined;
  original: CopiedFile;
  normalized: CopiedFile;
}

/** All rows for the new work case in one transaction. */
function insertWorkCase(
  ctx: AppContext,
  session: SessionInfo,
  ticket: TicketRow,
  body: CreateWorkCaseRequest,
  src: WorkCaseSources,
): { caseId: string; created: boolean } {
  const { caseId, snap, sourceProduct, original, normalized } = src;
  return tx(ctx.db, () => {
    // Re-check inside the write lock: a concurrent request may have finished first.
    const raced = existingWorkCase(ctx, ticket.id, session.id);
    if (raced) return { caseId: raced, created: false };
    const live = getRow<{ status: string }>(
      ctx.db,
      "SELECT status FROM tickets WHERE id = ?",
      ticket.id,
    );
    if (!live || live.status === "revoked") throw new AppError("NOT_FOUND");

    const ts = now();
    const title = (body.title?.trim() || `Solution: ${snap.caseTitle || snap.productLabel}`).slice(
      0,
      LIMITS.titleMaxChars,
    );
    ctx.db
      .prepare(
        `INSERT INTO cases (id, owner_session_id, owner_role, title, mode, status, model_label,
           fixture_id, source_ticket_id, created_at, updated_at, expires_at)
         VALUES (?, ?, 'support', ?, 'solution', 'active', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        caseId,
        session.id,
        title,
        snap.modelLabel ?? null,
        sourceProduct?.fixture_id ?? null,
        ticket.id,
        ts,
        ts,
        fromNow(ctx.config.caseRetentionDays * DAY_MS),
      );
    const insertAsset = ctx.db.prepare(
      `INSERT INTO assets (id, case_id, owner_session_id, kind, mime, size_bytes, width, height,
         duration_ms, sha256, filename, storage_path, source_asset_id, lineage_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of [original, normalized]) {
      insertAsset.run(
        c.assetId,
        caseId,
        session.id,
        c.kind,
        c.source.mime,
        c.source.size_bytes,
        c.source.width,
        c.source.height,
        c.source.duration_ms,
        c.source.sha256,
        c.grant.filename,
        c.storagePath,
        c.source.id,
        toJson({
          copiedFrom: "ticket_attachment",
          ticketId: ticket.id,
          ticketAttachmentId: c.grant.id,
          sourceAssetId: c.source.id,
          sourceCaseId: ticket.case_id,
        }),
        ts,
      );
    }
    const productRevisionId = newId("prod");
    ctx.db
      .prepare(
        `INSERT INTO product_revisions (id, case_id, source_type, fixture_id, original_asset_id,
           normalized_asset_id, model_label, confirmed_features_json, source_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        productRevisionId,
        caseId,
        snap.sourceType,
        sourceProduct?.fixture_id ?? null,
        original.assetId,
        normalized.assetId,
        snap.modelLabel ?? null,
        sourceProduct?.confirmed_features_json ?? "[]",
        sourceProduct?.source_hash ?? original.source.sha256,
        ts,
      );
    ctx.db
      .prepare("UPDATE cases SET product_revision_id = ? WHERE id = ?")
      .run(productRevisionId, caseId);
    return { caseId, created: true };
  });
}
