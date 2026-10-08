// Send-to-support: upload caps, owner-only submit, ticket-scoped reads (labeled fixture bytes only).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  STORY_LIMITS,
  STORY_UPLOAD_FIELDS,
  type StoryBeatsUpload,
  type StorySubmitResponse,
  type TicketResponse,
  type TicketStoryResponse,
  paths,
  storyPaths,
} from "@symptomsketch/contracts";
import { getRow } from "../db/index.ts";
import { type AiHarness, startAiServer } from "../routes/ai-harness.ts";
import { Browser, errorCode } from "../routes/core-harness.ts";
import { seedCase, seedCustomerSession, seedTake } from "../support/test-harness.ts";
import { setStoryUploadCapsFor } from "./submit.ts";

// TEST FIXTURE bytes: a WebM EBML magic / PNG magic followed by a label. Never served live.
const REEL = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from("TEST FIXTURE story reel ".repeat(40)),
]);
const FRAME = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("TEST FIXTURE last frame"),
]);
const CAPS = { reelMaxBytes: 4096, lastFrameMaxBytes: 512, beatsJsonMaxBytes: 4096 };

const BEATS: StoryBeatsUpload = {
  beats: [
    {
      label: "STUB opening",
      caption: "STUB caption 1",
      prompt: "STUB prompt 1 with a motor whine",
      custom: false,
    },
    { label: "STUB pick", caption: "STUB caption 2", prompt: "STUB prompt 2", custom: false },
    { label: "STUB typed", caption: "STUB caption 3", prompt: "STUB prompt 3", custom: true },
  ],
  offered: [[], ["STUB pick", "STUB other", "STUB third"], []],
  clipSeconds: STORY_LIMITS.clipSeconds,
  durationMs: 17_000,
};

let h: AiHarness;
before(async () => {
  h = await startAiServer();
  setStoryUploadCapsFor(h.srv.ctx, CAPS);
});
after(() => h.srv.stop());

function form(parts: { reel?: Buffer; frame?: Buffer; beats?: string }): FormData {
  const f = new FormData();
  if (parts.reel) {
    f.append(
      STORY_UPLOAD_FIELDS.reel,
      new Blob([new Uint8Array(parts.reel)], { type: "video/webm" }),
      "s.webm",
    );
  }
  if (parts.frame) {
    f.append(
      STORY_UPLOAD_FIELDS.frame,
      new Blob([new Uint8Array(parts.frame)], { type: "image/png" }),
      "f.png",
    );
  }
  if (parts.beats !== undefined) f.append(STORY_UPLOAD_FIELDS.beats, parts.beats);
  return f;
}

function send(b: Browser, caseId: string, parts: Parameters<typeof form>[0]): Promise<Response> {
  return b.req(storyPaths.submit(caseId), { method: "POST", body: form(parts) });
}

const full = { reel: REEL, frame: FRAME, beats: JSON.stringify(BEATS) };

/** A customer whose case may get an accepted (fixture) take + a real ticket through the API. */
function customer(): { b: Browser; sessionId: string; caseId: string; takeId: string } {
  const s = seedCustomerSession(h.srv.ctx);
  const c = seedCase(h.srv.ctx, s.id);
  const take = seedTake(h.srv.ctx, c, s.id, { accepted: true, number: 1 });
  const b = new Browser(h.srv.base);
  b.cookie = s.cookie;
  return { b, sessionId: s.id, caseId: c.caseId, takeId: take.takeId };
}

async function openTicket(b: Browser, caseId: string, takeId: string): Promise<string> {
  const res = await b.json(paths.caseTickets(caseId), "POST", {
    takeId,
    message: "TEST FIXTURE message",
    includeOriginal: false,
    idempotencyKey: `idem-${caseId}`,
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as TicketResponse).ticket.id;
}

async function staff(): Promise<Browser> {
  const s = new Browser(h.srv.base);
  const res = await s.json(paths.supportSession(), "POST", { supportCode: "test-support-code" });
  assert.equal(res.status, 200);
  return s;
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

test("a story sent before any ticket waits on the case and shows on the ticket sent later", async () => {
  const me = customer();
  const res = await send(me.b, me.caseId, { reel: REEL, beats: full.beats });
  assert.equal(res.status, 201);
  const sent = (await res.json()) as StorySubmitResponse;
  assert.equal(sent.ticketId, null);
  assert.equal(sent.story.reelUrl, null);
  assert.equal(sent.story.frameUrl, null);

  const ticketId = await openTicket(me.b, me.caseId, me.takeId);
  const support = await staff();
  const { story } = (await (
    await support.req(storyPaths.ticketStory(ticketId))
  ).json()) as TicketStoryResponse;
  assert.equal(story?.id, sent.story.id);
  assert.equal(story?.frameUrl, null);
  assert.equal((await support.req(story!.reelUrl!)).status, 200);
});

test("per-case story cap", async () => {
  const me = customer();
  for (let i = 0; i < STORY_LIMITS.storiesPerCaseMax; i += 1) {
    assert.equal((await send(me.b, me.caseId, full)).status, 201);
  }
  const over = await send(me.b, me.caseId, full);
  assert.equal(over.status, 429);
});
