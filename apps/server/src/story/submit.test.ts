// Send-to-support: upload caps, owner-only submit, ticket-scoped reads (labeled fixture bytes only).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  STORY_LIMITS,
  type StorySubmitResponse,
  type SupportInboxResponse,
  type TicketResponse,
  type TicketStoryResponse,
  paths,
  storyPaths,
} from "@symptomsketch/contracts";
import { getRow } from "../db/index.ts";
import { MIGRATIONS, runMigrations } from "../db/schema.ts";
import { callFacts } from "../support/call-brief.ts";
import type { TicketRow } from "../support/rows.ts";
import { type AiHarness, startAiServer } from "../routes/ai-harness.ts";
import { Browser, errorCode } from "../routes/core-harness.ts";
import {
  BEATS,
  FRAME,
  FULL_STORY,
  REEL,
  type StoryParts,
  openTicket as openStoryTicket,
  sendStory,
  storyCustomer,
  supportBrowser,
} from "./story-harness.ts";
import { setStoryUploadCapsFor } from "./submit.ts";

const CAPS = { reelMaxBytes: 4096, lastFrameMaxBytes: 512, beatsJsonMaxBytes: 4096 };

let h: AiHarness;
before(async () => {
  h = await startAiServer();
  setStoryUploadCapsFor(h.srv.ctx, CAPS);
});
after(() => h.srv.stop());

const send = (b: Browser, caseId: string, parts: StoryParts) => sendStory(b, caseId, parts);
const full = FULL_STORY;
const customer = () => storyCustomer(h);
const staff = () => supportBrowser(h);
const openTicket = (b: Browser, caseId: string, takeId: string) =>
  openStoryTicket({ b, caseId, takeId, sessionId: "" });

function ticketCount(caseId: string): number {
  return (
    getRow<{ n: number }>(
      h.srv.ctx.db,
      "SELECT COUNT(*) AS n FROM tickets WHERE case_id = ?",
      caseId,
    )?.n ?? 0
  );
}

function storyCount(caseId: string): number {
  return (
    getRow<{ n: number }>(
      h.srv.ctx.db,
      "SELECT COUNT(*) AS n FROM case_stories WHERE case_id = ?",
      caseId,
    )?.n ?? 0
  );
}

test("owner sends the story; it lands on the case's ticket and support streams the exact bytes", async () => {
  const me = customer();
  const ticketId = await openTicket(me.b, me.caseId, me.takeId);
  const res = await send(me.b, me.caseId, full);
  assert.equal(res.status, 201);
  const sent = (await res.json()) as StorySubmitResponse;
  assert.equal(sent.ticketId, ticketId);
  assert.equal(sent.story.beats.length, 3);
  assert.equal(sent.story.beats[2]!.custom, true);
  assert.equal(sent.story.reelBytes, REEL.length);
  assert.equal(sent.story.reelMime, "video/webm");

  const support = await staff();
  const read = await support.req(storyPaths.ticketStory(ticketId));
  assert.equal(read.status, 200);
  const { story } = (await read.json()) as TicketStoryResponse;
  assert.ok(story);
  assert.deepEqual(story.offered[1], ["STUB pick", "STUB other", "STUB third"]);
  assert.equal(story.durationMs, 17_000);

  const reel = await support.req(story.reelUrl!);
  assert.equal(reel.status, 200);
  assert.equal(reel.headers.get("content-type"), "video/webm");
  assert.ok(Buffer.from(await reel.arrayBuffer()).equals(REEL));
  const ranged = await support.req(story.reelUrl!, { headers: { range: "bytes=0-3" } });
  assert.equal(ranged.status, 206);
  const frame = await support.req(story.frameUrl!);
  assert.equal(frame.status, 200);
  assert.ok(Buffer.from(await frame.arrayBuffer()).equals(FRAME));

  // The owner can read it through their own ticket too.
  assert.equal((await me.b.req(storyPaths.ticketStory(ticketId))).status, 200);
});

test("only the case owner can send; strangers and anonymous callers store nothing", async () => {
  const me = customer();
  const stranger = customer();
  const foreign = await send(stranger.b, me.caseId, full);
  assert.equal(foreign.status, 404);
  assert.equal(await errorCode(foreign), "NOT_FOUND");
  const anon = await send(new Browser(h.srv.base), me.caseId, full);
  assert.ok(anon.status === 401 || anon.status === 403);
  assert.equal(storyCount(me.caseId), 0);
});

test("ticket story reads follow ticket membership: strangers get 404", async () => {
  const me = customer();
  const ticketId = await openTicket(me.b, me.caseId, me.takeId);
  assert.equal((await send(me.b, me.caseId, full)).status, 201);
  const stranger = customer();
  const read = await stranger.b.req(storyPaths.ticketStory(ticketId));
  assert.equal(read.status, 404);
  const reel = await stranger.b.req(storyPaths.ticketStoryReel(ticketId));
  assert.equal(reel.status, 404);
});

test("upload caps and types: too large is 413, wrong bytes are rejected, nothing is stored", async () => {
  const me = customer();
  const bigReel = Buffer.concat([REEL, Buffer.alloc(CAPS.reelMaxBytes)]);
  const big = await send(me.b, me.caseId, { ...full, reel: bigReel });
  assert.equal(big.status, 413);
  assert.equal(await errorCode(big), "PAYLOAD_TOO_LARGE");

  const bigFrame = Buffer.concat([FRAME, Buffer.alloc(CAPS.lastFrameMaxBytes)]);
  assert.equal((await send(me.b, me.caseId, { ...full, frame: bigFrame })).status, 413);

  const notWebm = await send(me.b, me.caseId, { ...full, reel: Buffer.from("TEST FIXTURE text") });
  assert.equal(notWebm.status, 422);
  assert.equal(await errorCode(notWebm), "RECORDING_UNSUPPORTED");

  const notPng = await send(me.b, me.caseId, { ...full, frame: Buffer.from("TEST FIXTURE") });
  assert.equal(notPng.status, 400);

  const noReel = await send(me.b, me.caseId, { frame: FRAME, beats: full.beats });
  assert.equal(noReel.status, 400);

  const badBeats = await send(me.b, me.caseId, { ...full, beats: JSON.stringify({ beats: [] }) });
  assert.equal(badBeats.status, 400);
  const hugeBeats = await send(me.b, me.caseId, { ...full, beats: "x".repeat(5000) });
  assert.ok(hugeBeats.status === 400 || hugeBeats.status === 413);
  assert.equal(storyCount(me.caseId), 0);
});

test("a story sent on a case with no ticket opens it, once, even on a double click", async () => {
  const me = customer();
  const [a, b] = await Promise.all([
    send(me.b, me.caseId, { reel: REEL, beats: full.beats }),
    send(me.b, me.caseId, full),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const sent = [(await a.json()) as StorySubmitResponse, (await b.json()) as StorySubmitResponse];
  const ticketId = sent[0]!.ticketId;
  assert.ok(ticketId);
  assert.equal(sent[1]!.ticketId, ticketId);
  assert.equal(sent.filter((x) => x.ticketOpened === true).length, 1);
  assert.equal(ticketCount(me.caseId), 1);
  const opener = sent.find((x) => x.ticketOpened)!;

  // The story is the ticket's first entry: no take, the customer's typed issue verbatim.
  const support = await staff();
  const read = await support.req(paths.ticket(ticketId));
  assert.equal(read.status, 200);
  const { ticket } = (await read.json()) as TicketResponse;
  const caseRow = getRow<{ original_account: string }>(
    h.srv.ctx.db,
    "SELECT original_account FROM cases WHERE id = ?",
    me.caseId,
  )!;
  assert.equal(ticket.snapshot.takeId, null);
  assert.equal(ticket.snapshot.takeNumber, null);
  assert.equal(ticket.snapshot.storyId, opener.story.id);
  assert.equal(ticket.snapshot.message, caseRow.original_account);
  assert.equal(ticket.snapshot.assessmentStatus, "unavailable");
  assert.deepEqual(
    ticket.attachments.map((x) => x.purpose),
    ["customer_reference"],
  );

  // It is in the Demo Support inbox like any other ticket.
  const inbox = (await (await support.req(paths.supportTickets())).json()) as SupportInboxResponse;
  assert.ok(inbox.tickets.some((t) => t.id === ticketId));

  // Staff read the story through the ticket and stream the reel.
  const { story } = (await (
    await support.req(storyPaths.ticketStory(ticketId))
  ).json()) as TicketStoryResponse;
  assert.ok(story?.reelUrl);
  assert.equal((await support.req(story.reelUrl)).status, 200);

  // Ownership unchanged: the owner reads it, a stranger gets 404.
  assert.equal((await me.b.req(paths.ticket(ticketId))).status, 200);
  const stranger = customer();
  assert.equal((await stranger.b.req(paths.ticket(ticketId))).status, 404);
  assert.equal((await stranger.b.req(storyPaths.ticketStory(ticketId))).status, 404);

  // A later story attaches to the same ticket instead of opening another.
  const again = (await (await send(me.b, me.caseId, full)).json()) as StorySubmitResponse;
  assert.equal(again.ticketId, ticketId);
  assert.equal(again.ticketOpened, false);
  assert.equal(ticketCount(me.caseId), 1);
});

test("a story on a case that already has a ticket attaches to it and opens nothing", async () => {
  const me = customer();
  const ticketId = await openTicket(me.b, me.caseId, me.takeId);
  const sent = (await (await send(me.b, me.caseId, full)).json()) as StorySubmitResponse;
  assert.equal(sent.ticketId, ticketId);
  assert.equal(sent.ticketOpened, false);
  assert.equal(ticketCount(me.caseId), 1);
});

test("Sam's brief on a story-only ticket is built from the story, not a clip", async () => {
  const me = customer();
  const sent = (await (await send(me.b, me.caseId, full)).json()) as StorySubmitResponse;
  const row = getRow<TicketRow>(
    h.srv.ctx.db,
    "SELECT * FROM tickets WHERE id = ?",
    sent.ticketId!,
  )!;
  const facts = callFacts(h.srv.ctx, row) as { story?: { caption: string; picked: string }[] };
  assert.ok(Array.isArray(facts.story));
  assert.deepEqual(
    facts.story.map((x) => x.caption),
    BEATS.beats.map((x) => x.caption),
  );
  assert.equal(facts.story[2]!.picked, BEATS.beats[2]!.label);
  assert.equal("clipCaption" in facts, false);

  // A take ticket keeps the clip facts.
  const other = customer();
  const takeTicket = await openTicket(other.b, other.caseId, other.takeId);
  const takeRow = getRow<TicketRow>(
    h.srv.ctx.db,
    "SELECT * FROM tickets WHERE id = ?",
    takeTicket,
  )!;
  const takeFacts = callFacts(h.srv.ctx, takeRow);
  assert.equal("story" in takeFacts, false);
  assert.ok("clipCaption" in takeFacts);
});

test("per-case story cap", async () => {
  const me = customer();
  for (let i = 0; i < STORY_LIMITS.storiesPerCaseMax; i += 1) {
    assert.equal((await send(me.b, me.caseId, full)).status, 201);
  }
  const over = await send(me.b, me.caseId, full);
  assert.equal(over.status, 429);
});

test("migration 5 rebuilds tickets without cascading into attachments or stories", async () => {
  const me = customer();
  const ticketId = await openTicket(me.b, me.caseId, me.takeId);
  assert.equal((await send(me.b, me.caseId, full)).status, 201);
  const db = h.srv.ctx.db;
  const count = (sql: string) => getRow<{ n: number }>(db, sql, ticketId)?.n ?? 0;
  const attachments = "SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_id = ?";
  const stories = "SELECT COUNT(*) AS n FROM case_stories WHERE ticket_id = ?";
  const before = [count(attachments), count(stories)];
  assert.ok(before[0]! > 0);
  assert.equal(before[1], 1);
  db.exec("PRAGMA user_version = 4");
  assert.equal(runMigrations(db), MIGRATIONS.length);
  assert.deepEqual([count(attachments), count(stories)], before);
  const fk = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
  assert.equal(fk.foreign_keys, 1);
  const takeCol = db
    .prepare("SELECT \"notnull\" AS nn FROM pragma_table_info('tickets') WHERE name = 'take_id'")
    .get() as { nn: number };
  assert.equal(takeCol.nn, 0);
});
