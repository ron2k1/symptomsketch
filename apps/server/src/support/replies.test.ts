import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  paths,
  type CreateWorkCaseResponse,
  type SessionState,
  type SupportInboxResponse,
  type Ticket,
  type TicketResponse,
} from "@symptomsketch/contracts";
import { getRow } from "../db/index.ts";
import { revokeTicketsForCase } from "./lifecycle.ts";
import {
  SUPPORT_CODE,
  call,
  cookieFrom,
  seedCase,
  seedCustomerSession,
  seedTake,
  sha256,
  startHarness,
  type Harness,
  type SeededCase,
} from "./test-harness.ts";

let h: Harness;
let alice: { id: string; cookie: string };
let support: { id: string; cookie: string };
let aliceCase: SeededCase;
let seq = 0;

before(async () => {
  h = await startHarness();
  alice = seedCustomerSession(h.ctx);
  aliceCase = seedCase(h.ctx, alice.id);
  const login = await call<SessionState>(h.base, "POST", paths.supportSession(), {
    body: { supportCode: SUPPORT_CODE },
  });
  support = { id: "", cookie: cookieFrom(login.res) };
  const row = getRow<{ id: string }>(
    h.ctx.db,
    "SELECT id FROM sessions WHERE role = 'support' ORDER BY created_at DESC LIMIT 1",
  );
  support.id = row!.id;
});

after(async () => {
  await h.close();
});

/** A fresh accepted take + submitted ticket on `c`. */
async function submitTicket(c: SeededCase, includeOriginal = false): Promise<Ticket> {
  seq += 1;
  const take = seedTake(h.ctx, c, alice.id, { accepted: true, number: 100 + seq });
  const res = await call<TicketResponse>(h.base, "POST", paths.caseTickets(c.caseId), {
    cookie: alice.cookie,
    body: {
      takeId: take.takeId,
      message: `Ticket ${seq}`,
      includeOriginal,
      idempotencyKey: `ticket-key-${seq}`,
    },
  });
  assert.equal(res.status, 201);
  return res.body.ticket;
}

async function workCase(ticketId: string, key = "work-case-key-1") {
  return call<CreateWorkCaseResponse>(h.base, "POST", paths.ticketWorkCase(ticketId), {
    cookie: support.cookie,
    body: { idempotencyKey: key },
  });
}

function reply(ticketId: string, key: string, text: string, attachTakeId: string | null = null) {
  return call<TicketResponse>(h.base, "POST", paths.ticketReplies(ticketId), {
    cookie: support.cookie,
    body: { text, attachTakeId, idempotencyKey: key },
  });
}

/** Seed the work case's own product/plan rows reference and a take (test fixture, not output). */
function workCaseTake(
  caseId: string,
  accepted: boolean,
  purpose: "solution" | "problem" = "solution",
) {
  const c = seedCase(h.ctx, support.id, { role: "support", purpose, existingCaseId: caseId });
  seq += 1;
  return seedTake(h.ctx, c, support.id, { accepted, purpose, number: seq });
}

test("support text reply is persisted and visible to the customer, idempotently", async () => {
  const ticket = await submitTicket(aliceCase);
  const first = await reply(ticket.id, "reply-key-0001", "Try moving it off the rug edge.");
  assert.equal(first.status, 201);
  assert.equal(first.body.ticket.status, "replied");
  const replay = await reply(ticket.id, "reply-key-0001", "Try moving it off the rug edge.");
  assert.equal(replay.status, 200);
  const conflict = await reply(ticket.id, "reply-key-0001", "Different text");
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "TICKET_CONFLICT");

  const seen = await call<TicketResponse>(h.base, "GET", paths.ticket(ticket.id), {
    cookie: alice.cookie,
  });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.ticket.replies.length, 1);
  const r = seen.body.ticket.replies[0]!;
  assert.equal(r.text, "Try moving it off the rug edge.");
  assert.equal(r.authorRole, "support");
  assert.ok(Date.parse(r.createdAt) > 0);
  assert.deepEqual(seen.body.ticket.workCaseIds, []);
});

test("work case is an idempotent agent-owned copy with lineage to the ticket", async () => {
  const ticket = await submitTicket(aliceCase, true);
  const created = await workCase(ticket.id);
  assert.equal(created.status, 201);
  const again = await workCase(ticket.id, "work-case-key-2");
  assert.equal(again.status, 200);
  assert.equal(again.body.caseId, created.body.caseId);

  const wc = getRow<Record<string, string>>(
    h.ctx.db,
    "SELECT * FROM cases WHERE id = ?",
    created.body.caseId,
  )!;
  assert.equal(wc.owner_session_id, support.id);
  assert.equal(wc.owner_role, "support");
  assert.equal(wc.mode, "solution");
  assert.equal(wc.source_ticket_id, ticket.id);
  const pr = getRow<Record<string, string>>(
    h.ctx.db,
    "SELECT * FROM product_revisions WHERE id = ?",
    wc.product_revision_id!,
  )!;
  const ref = ticket.attachments.find((a) => a.purpose === "customer_reference")!;
  const copy = getRow<Record<string, string>>(
    h.ctx.db,
    "SELECT * FROM assets WHERE id = ?",
    pr.normalized_asset_id!,
  )!;
  assert.notEqual(copy.id, ref.assetId, "work case owns a copy, not the customer asset");
  assert.equal(copy.case_id, wc.id);
  assert.equal(copy.sha256, ref.sha256);
  assert.equal(copy.source_asset_id, ref.assetId);
  assert.match(copy.lineage_json!, new RegExp(ticket.id));

  const asSupport = await call<TicketResponse>(h.base, "GET", paths.ticket(ticket.id), {
    cookie: support.cookie,
  });
  assert.deepEqual(asSupport.body.ticket.workCaseIds, [created.body.caseId]);
  const customerTry = await call(h.base, "POST", paths.ticketWorkCase(ticket.id), {
    cookie: alice.cookie,
    body: { idempotencyKey: "work-case-key-3" },
  });
  assert.equal(customerTry.status, 403);
});

test("reply attachments: own accepted solution take only; customer gets exact bytes", async () => {
  const ticketA = await submitTicket(aliceCase);
  const ticketB = await submitTicket(aliceCase);
  const caseA = (await workCase(ticketA.id)).body.caseId;
  const caseB = (await workCase(ticketB.id)).body.caseId;
  const takeA = workCaseTake(caseA, true);
  const takeB = workCaseTake(caseB, true);
  const unacceptedA = workCaseTake(caseA, false);
  const problemA = workCaseTake(caseA, true, "problem");

  const foreign = await reply(ticketA.id, "reply-key-0101", "See clip", takeB.takeId);
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.code, "SUPPORT_FORBIDDEN");
  const notAccepted = await reply(ticketA.id, "reply-key-0102", "See clip", unacceptedA.takeId);
  assert.equal(notAccepted.status, 409);
  const wrongPurpose = await reply(ticketA.id, "reply-key-0103", "See clip", problemA.takeId);
  assert.equal(wrongPurpose.status, 409);
  const customerTake = ticketA.attachments.find((a) => a.purpose === "customer_take")!;
  const customerTakeId = getRow<{ id: string }>(
    h.ctx.db,
    "SELECT id FROM takes WHERE final_asset_id = ?",
    customerTake.assetId,
  )!.id;
  const customersOwn = await reply(ticketA.id, "reply-key-0104", "See clip", customerTakeId);
  assert.equal(customersOwn.status, 403);

  const ok = await reply(ticketA.id, "reply-key-0105", "Here is the right way.", takeA.takeId);
  assert.equal(ok.status, 201);
  const att = ok.body.ticket.replies.at(-1)!.attachment!;
  assert.equal(att.purpose, "support_reply_take");
  assert.equal(att.sha256, takeA.sha);

  const play = await fetch(`${h.base}${att.mediaUrl}`, {
    headers: { cookie: alice.cookie, range: "bytes=0-" },
  });
  assert.equal(play.status, 206);
  const dl = await fetch(`${h.base}${att.downloadUrl}`, { headers: { cookie: alice.cookie } });
  assert.equal(dl.status, 200);
  assert.equal(sha256(Buffer.from(await dl.arrayBuffer())), takeA.sha);
  // The grant is per ticket: the same asset is not reachable through ticket B.
  const crossTicket = await call(
    h.base,
    "GET",
    paths.ticketAttachmentMedia(ticketB.id, att.assetId),
    {
      cookie: alice.cookie,
    },
  );
  assert.equal(crossTicket.status, 404);
});

test("case deletion revokes tickets, grants, and derived work cases", async () => {
  const doomed = seedCase(h.ctx, alice.id);
  const ticket = await submitTicket(doomed);
  const wcId = (await workCase(ticket.id)).body.caseId;
  const solution = workCaseTake(wcId, true);
  const ok = await reply(ticket.id, "reply-key-0201", "Steps attached.", solution.takeId);
  assert.equal(ok.status, 201);
  const replyAtt = ok.body.ticket.replies.at(-1)!.attachment!;
  const take = ticket.attachments.find((a) => a.purpose === "customer_take")!;

  // server-core's delete marks the case inactive; reads fail closed even before it calls revoke.
  h.ctx.db.prepare("UPDATE cases SET status = 'deleted' WHERE id = ?").run(doomed.caseId);
  for (const [url, cookie] of [
    [paths.ticket(ticket.id), alice.cookie],
    [paths.ticket(ticket.id), support.cookie],
    [take.mediaUrl, support.cookie],
    [replyAtt.mediaUrl, alice.cookie],
  ] as const) {
    assert.equal((await call(h.base, "GET", url, { cookie })).status, 404, url);
  }
  const inbox = await call<SupportInboxResponse>(h.base, "GET", paths.supportTickets(), {
    cookie: support.cookie,
  });
  assert.equal(
    inbox.body.tickets.some((t) => t.id === ticket.id),
    false,
  );
  const late = await reply(ticket.id, "reply-key-0202", "Late reply");
  assert.equal(late.status, 404);

  const t = getRow<{ status: string }>(
    h.ctx.db,
    "SELECT status FROM tickets WHERE id = ?",
    ticket.id,
  );
  assert.equal(t!.status, "revoked");
  const live = getRow<{ n: number }>(
    h.ctx.db,
    "SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_id = ? AND revoked_at IS NULL",
    ticket.id,
  );
  assert.equal(live!.n, 0);
  const wc = getRow<{ status: string }>(h.ctx.db, "SELECT status FROM cases WHERE id = ?", wcId);
  assert.equal(wc!.status, "deleted");
  const cleanup = getRow<{ n: number }>(
    h.ctx.db,
    "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'case_cleanup' AND case_id = ?",
    wcId,
  );
  assert.equal(cleanup!.n, 1);
  // Idempotent when server-core calls it explicitly afterwards.
  const again = revokeTicketsForCase(h.ctx, doomed.caseId);
  assert.deepEqual(again.workCaseIds, []);
  assert.equal(again.attachmentsRevoked, 0);
});
