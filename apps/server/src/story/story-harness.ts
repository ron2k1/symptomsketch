/**
 * TEST FIXTURE ONLY (never imported by the live app). Story test helpers on top of the AI harness:
 * a customer with an accepted fixture take and a real ticket through the API, a support browser,
 * and labeled placeholder reel / frame bytes. Nothing here is Reactor or Gemini output.
 */
import assert from "node:assert/strict";
import {
  STORY_LIMITS,
  STORY_UPLOAD_FIELDS,
  type StoryBeatsUpload,
  type TicketResponse,
  paths,
  storyPaths,
} from "@symptomsketch/contracts";
import type { AiHarness } from "../routes/ai-harness.ts";
import { Browser } from "../routes/core-harness.ts";
import { seedCase, seedCustomerSession, seedTake } from "../support/test-harness.ts";

/** WebM EBML magic + a label. */
export const REEL = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from("TEST FIXTURE story reel ".repeat(40)),
]);
/** PNG magic + a label. */
export const FRAME = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("TEST FIXTURE last frame"),
]);

export const BEATS: StoryBeatsUpload = {
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

export interface StoryParts {
  reel?: Buffer;
  frame?: Buffer;
  beats?: string;
}

export const FULL_STORY: StoryParts = { reel: REEL, frame: FRAME, beats: JSON.stringify(BEATS) };

export function storyForm(parts: StoryParts): FormData {
  const f = new FormData();
  if (parts.reel) {
    const reel = new Blob([new Uint8Array(parts.reel)], { type: "video/webm" });
    f.append(STORY_UPLOAD_FIELDS.reel, reel, "s.webm");
  }
  if (parts.frame) {
    const frame = new Blob([new Uint8Array(parts.frame)], { type: "image/png" });
    f.append(STORY_UPLOAD_FIELDS.frame, frame, "f.png");
  }
  if (parts.beats !== undefined) f.append(STORY_UPLOAD_FIELDS.beats, parts.beats);
  return f;
}

export function sendStory(b: Browser, caseId: string, parts: StoryParts): Promise<Response> {
  return b.req(storyPaths.submit(caseId), { method: "POST", body: storyForm(parts) });
}

export interface StoryCustomer {
  b: Browser;
  sessionId: string;
  caseId: string;
  takeId: string;
}

/** A customer whose case has an accepted (fixture) take, ready for a ticket. */
export function storyCustomer(h: AiHarness): StoryCustomer {
  const s = seedCustomerSession(h.srv.ctx);
  const c = seedCase(h.srv.ctx, s.id);
  const take = seedTake(h.srv.ctx, c, s.id, { accepted: true, number: 1 });
  const b = new Browser(h.srv.base);
  b.cookie = s.cookie;
  return { b, sessionId: s.id, caseId: c.caseId, takeId: take.takeId };
}

/** Send the case's ticket through the real route. */
export async function openTicket(me: StoryCustomer): Promise<string> {
  const res = await me.b.json(paths.caseTickets(me.caseId), "POST", {
    takeId: me.takeId,
    message: "TEST FIXTURE message",
    includeOriginal: false,
    idempotencyKey: `idem-${me.caseId}`,
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as TicketResponse).ticket.id;
}

/** A signed-in Demo Support browser (the core harness support code). */
export async function supportBrowser(h: AiHarness): Promise<Browser> {
  const s = new Browser(h.srv.base);
  const res = await s.json(paths.supportSession(), "POST", { supportCode: "test-support-code" });
  assert.equal(res.status, 200);
  return s;
}
