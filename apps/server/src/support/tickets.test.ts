import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  SUPPORT_QUEUE_LABEL,
  Ticket,
  paths,
  type CaseTicketsResponse,
  type SessionState,
  type SupportInboxResponse,
  type TicketResponse,
} from "@symptomsketch/contracts";
import { newId, now } from "../db/index.ts";
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
  type SeededTake,
} from "./test-harness.ts";

let h: Harness;
let alice: { id: string; cookie: string };
let bob: { id: string; cookie: string };
let supportCookie: string;
let aliceCase: SeededCase;
let accepted: SeededTake;
let alternate: SeededTake;

before(async () => {
  h = await startHarness();
  alice = seedCustomerSession(h.ctx);
  bob = seedCustomerSession(h.ctx);
  aliceCase = seedCase(h.ctx, alice.id);
  accepted = seedTake(h.ctx, aliceCase, alice.id, { accepted: true, number: 1 });
  alternate = seedTake(h.ctx, aliceCase, alice.id, { accepted: false, number: 2 });
  const login = await call<SessionState>(h.base, "POST", paths.supportSession(), {
    body: { supportCode: SUPPORT_CODE },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.role, "support");
  supportCookie = cookieFrom(login.res);
});

after(async () => {
  await h.close();
});

function submit(key: string, overrides: Record<string, unknown> = {}, cookie = alice.cookie) {
  return call<TicketResponse>(h.base, "POST", paths.caseTickets(aliceCase.caseId), {
    cookie,
    body: {
      takeId: accepted.takeId,
      message: "The vacuum stops and jerks backward once.",
      includeOriginal: false,
      idempotencyKey: key,
      ...overrides,
    },
  });
}

test("support role comes only from the support code; client flags are ignored", async () => {
  const wrong = await call(h.base, "POST", paths.supportSession(), {
    body: { supportCode: "guess", role: "support" },
  });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, "SUPPORT_FORBIDDEN");
  assert.equal(wrong.res.headers.getSetCookie().length, 0);

  const flagged = await call(h.base, "GET", `${paths.supportTickets()}?role=support`, {
    cookie: `${alice.cookie}; role=support`,
    headers: { "x-role": "support" },
  });
  assert.equal(flagged.status, 403);
  assert.equal(flagged.body.code, "SUPPORT_FORBIDDEN");

  const anon = await call(h.base, "GET", paths.supportTickets());
  assert.equal(anon.status, 401);
});

test("ticket creation is idempotent and conflicts on a reused key with a new payload", async () => {
  const key = "idem-key-0001";
  const first = await submit(key);
  assert.equal(first.status, 201);
  const ticket = Ticket.parse(first.body.ticket);
  assert.equal(ticket.queue, SUPPORT_QUEUE_LABEL);
  assert.equal(ticket.status, "submitted");
  assert.deepEqual(ticket.workCaseIds, []);
  assert.deepEqual(
    ticket.attachments.map((a) => a.purpose),
    ["customer_reference", "customer_take"],
  );
  const take = ticket.attachments.find((a) => a.purpose === "customer_take")!;
  assert.equal(take.sha256, accepted.sha);
  assert.equal(take.mediaUrl, paths.ticketAttachmentMedia(ticket.id, take.assetId));
  const snap = ticket.snapshot;
  assert.equal(snap.takeId, accepted.takeId);
  assert.equal(snap.finalSha256, accepted.sha);
  assert.equal(snap.originalAccount, "It stops then jerks backward once.");
  assert.equal(snap.actionsTried, "Restarted it twice.");
  assert.deepEqual(snap.unresolved, ["cause unknown", "how often it happens"]);
  assert.equal(snap.assessmentStatus, "matches");
  assert.match(snap.assessmentSummary ?? "", /direction: supported/);
  assert.equal(snap.reviewState, "accepted");
  assert.equal(snap.modelLabel, "RV-100");
  assert.equal(snap.purposeLabel, "AI-generated reenactment");

  const again = await submit(key);
  assert.equal(again.status, 200);
  assert.equal(again.body.ticket.id, ticket.id);
  const count = h.ctx.db
    .prepare("SELECT COUNT(*) AS n FROM tickets WHERE owner_session_id = ?")
    .get(alice.id) as { n: number };
  assert.equal(count.n, 1);

  const conflict = await submit(key, { message: "A different message" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "TICKET_CONFLICT");
  const conflictOriginal = await submit(key, { includeOriginal: true });
  assert.equal(conflictOriginal.status, 409);
});

test("only an accepted take from the customer's own case can be submitted", async () => {
  const unaccepted = await submit("idem-key-0002", { takeId: alternate.takeId });
  assert.equal(unaccepted.status, 409);
  assert.equal(unaccepted.body.code, "REVIEW_CONFLICT");
  const bobSubmits = await submit("idem-key-0003", {}, bob.cookie);
  assert.equal(bobSubmits.status, 404);
  const supportSubmits = await submit("idem-key-0004", {}, supportCookie);
  assert.equal(supportSubmits.status, 403);
});

test("snapshot is immutable after later case and review edits", async () => {
  const created = await submit("idem-key-0005", { includeOriginal: true });
  assert.equal(created.status, 201);
  const { ticket } = created.body;
  assert.equal(ticket.attachments.length, 3);
  h.ctx.db
    .prepare(
      "UPDATE cases SET title = 'edited', original_account = 'rewritten', model_label = 'X' WHERE id = ?",
    )
    .run(aliceCase.caseId);
  h.ctx.db
    .prepare(
      `INSERT INTO reviews (id, take_id, final_sha256, decision, resulting_state,
         reviewer_session_id, reviewer_role, created_at)
       VALUES (?, ?, ?, 'refine', 'rejected', ?, 'customer', ?)`,
    )
    .run(newId("rev"), accepted.takeId, accepted.sha, alice.id, now());
  const read = await call<TicketResponse>(h.base, "GET", paths.ticket(ticket.id), {
    cookie: alice.cookie,
  });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.ticket.snapshot, ticket.snapshot);
  assert.equal(read.body.ticket.snapshot.originalAccount, "It stops then jerks backward once.");
  // Restore so other tests see the accepted state.
  h.ctx.db
    .prepare("DELETE FROM reviews WHERE take_id = ? AND decision = 'refine'")
    .run(accepted.takeId);
  h.ctx.db
    .prepare("UPDATE cases SET title = 'Vacuum jerks backward', original_account = ? WHERE id = ?")
    .run("It stops then jerks backward once.", aliceCase.caseId);
});

test("support reads submitted tickets and granted bytes only", async () => {
  const { body } = await submit("idem-key-0006");
  const ticket = body.ticket;
  const inbox = await call<SupportInboxResponse>(h.base, "GET", paths.supportTickets(), {
    cookie: supportCookie,
  });
  assert.equal(inbox.status, 200);
  const row = inbox.body.tickets.find((t) => t.id === ticket.id);
  assert.ok(row, "ticket in inbox");
  assert.equal(row.excerpt, "The vacuum stops and jerks backward once.");

  const asSupport = await call<TicketResponse>(h.base, "GET", paths.ticket(ticket.id), {
    cookie: supportCookie,
  });
  assert.equal(asSupport.status, 200);

  const take = ticket.attachments.find((a) => a.purpose === "customer_take")!;
  const ranged = await fetch(`${h.base}${take.mediaUrl}`, {
    headers: { cookie: supportCookie, range: "bytes=0-3" },
  });
  assert.equal(ranged.status, 206);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), accepted.bytes.subarray(0, 4));
  const dl = await fetch(`${h.base}${take.downloadUrl}`, { headers: { cookie: supportCookie } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(sha256(Buffer.from(await dl.arrayBuffer())), accepted.sha);

  // Not submitted on this ticket: the alternate take and the (not included) original.
  for (const assetId of [alternate.finalAssetId, aliceCase.originalAssetId]) {
    const denied = await call(h.base, "GET", paths.ticketAttachmentMedia(ticket.id, assetId), {
      cookie: supportCookie,
    });
    assert.equal(denied.status, 404, `support must not read ${assetId}`);
  }
});

test("another customer cannot read the ticket, its media, or the case ticket list", async () => {
  const { body } = await submit("idem-key-0007");
  const ticket = body.ticket;
  const take = ticket.attachments.find((a) => a.purpose === "customer_take")!;
  for (const url of [paths.ticket(ticket.id), take.mediaUrl, take.downloadUrl]) {
    const res = await call(h.base, "GET", url, { cookie: bob.cookie });
    assert.equal(res.status, 404, url);
  }
  const list = await call(h.base, "GET", paths.caseTickets(aliceCase.caseId), {
    cookie: bob.cookie,
  });
  assert.equal(list.status, 404);
  const own = await call<CaseTicketsResponse>(h.base, "GET", paths.caseTickets(aliceCase.caseId), {
    cookie: alice.cookie,
  });
  assert.equal(own.status, 200);
  assert.ok(own.body.tickets.some((t) => t.id === ticket.id));
  const reply = await call(h.base, "POST", paths.ticketReplies(ticket.id), {
    cookie: alice.cookie,
    body: { text: "self reply", attachTakeId: null, idempotencyKey: "idem-reply-x" },
  });
  assert.equal(reply.status, 403);
  assert.equal(reply.body.code, "SUPPORT_FORBIDDEN");
});
