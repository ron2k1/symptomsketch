// Live AI support agent call routes (Reactor Vidu S2 Avatar). Offline: the minter, Gemini client
// and Nano Banana generator are stubs injected per context; no provider is called.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  paths,
  SUPPORT_CALL_MODEL,
  SUPPORT_CALL_PERSONA_OPENER,
  type SessionState,
  type SupportCallBriefResponse,
  type SupportCallTokenResponse,
  type SupportCallTranscript,
  type Ticket,
  type TicketResponse,
} from "@symptomsketch/contracts";
import { getRow } from "../db/index.ts";
import {
  createGeminiClient,
  type InteractionLike,
  type InteractionRequest,
} from "../providers/gemini-client.ts";
import { setGeminiFor } from "../providers/planner.ts";
import { ReactorTokenError } from "../providers/reactor-token.ts";
import sharp from "sharp";
import type { GenerateImageRequest } from "../providers/nano-banana.ts";
import { CALL_GROUND_RULES } from "./call-brief.ts";
import { setNanoBananaFor } from "./call-portrait.ts";
import { setSupportCallMinterFor, type SupportCallMintRequest } from "./call-routes.ts";
import {
  SUPPORT_CODE,
  call,
  cookieFrom,
  seedCase,
  seedCustomerSession,
  seedTake,
  startHarness,
  type Harness,
  type SeededCase,
} from "./test-harness.ts";

let h: Harness;
let alice: { id: string; cookie: string };
let bob: { id: string; cookie: string };
let support: { cookie: string };
let aliceCase: SeededCase;
let seq = 0;
const mints: SupportCallMintRequest[] = [];
let mintFails: ReactorTokenError | null = null;
const briefRequests: InteractionRequest[] = [];
let briefReply: () => InteractionLike = () => ({
  status: "completed",
  model: "stub-text-model",
  output_text: JSON.stringify({
    persona: `${SUPPORT_CALL_PERSONA_OPENER} helping with a robot vacuum that jerks backward.`,
    greeting: "Hi, I'm Sam, an AI support agent. I watched your clip. When does it jerk backward?",
  }),
});

before(async () => {
  h = await startHarness();
  alice = seedCustomerSession(h.ctx);
  bob = seedCustomerSession(h.ctx);
  aliceCase = seedCase(h.ctx, alice.id);
  const login = await call<SessionState>(h.base, "POST", paths.supportSession(), {
    body: { supportCode: SUPPORT_CODE },
  });
  support = { cookie: cookieFrom(login.res) };
  setSupportCallMinterFor(h.ctx, async (_ctx, req) => {
    mints.push(req);
    if (mintFails) throw mintFails;
    return { jwt: "stub.avatar.jwt", expiresAt: new Date(Date.now() + 600_000).toISOString() };
  });
  setGeminiFor(
    h.ctx,
    createGeminiClient({
      apiKey: null,
      transport: {
        create: async (request) => {
          briefRequests.push(request);
          return briefReply();
        },
      },
    }),
  );
});

after(async () => {
  await h.close();
});

async function submitTicket(): Promise<Ticket> {
  seq += 1;
  const take = seedTake(h.ctx, aliceCase, alice.id, { accepted: true, number: 200 + seq });
  const res = await call<TicketResponse>(h.base, "POST", paths.caseTickets(aliceCase.caseId), {
    cookie: alice.cookie,
    body: {
      takeId: take.takeId,
      message: `Call ticket ${seq}`,
      includeOriginal: false,
      idempotencyKey: `call-ticket-${seq}`,
    },
  });
  assert.equal(res.status, 201);
  return res.body.ticket;
}

test("owner mints a max_sessions=1 vidu-s2-avatar token; JWT is no-store", async () => {
  const ticket = await submitTicket();
  const before = mints.length;
  const res = await call<SupportCallTokenResponse>(
    h.base,
    "POST",
    paths.ticketSupportCallToken(ticket.id),
    { cookie: alice.cookie },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.jwt, "stub.avatar.jwt");
  assert.equal(res.body.model, SUPPORT_CALL_MODEL);
  assert.equal(res.body.maxSessionDurationSeconds, 300);
  assert.equal(res.res.headers.get("cache-control"), "no-store");
  assert.equal(mints.length, before + 1);
  assert.deepEqual(mints.at(-1), {
    model: "reactor/vidu-s2-avatar",
    maxSessions: 1,
    expiresAfterSeconds: 600,
    maxSessionDurationSeconds: 300,
  });
  const counter = getRow<{ token_issues: number }>(
    h.ctx.db,
    "SELECT token_issues FROM sessions WHERE id = ?",
    alice.id,
  );
  assert.ok((counter?.token_issues ?? 0) >= 1);
});

test("support may mint for any ticket; another customer gets a 404", async () => {
  const ticket = await submitTicket();
  const staff = await call(h.base, "POST", paths.ticketSupportCallToken(ticket.id), {
    cookie: support.cookie,
  });
  assert.equal(staff.status, 200);
  const stranger = await call(h.base, "POST", paths.ticketSupportCallToken(ticket.id), {
    cookie: bob.cookie,
  });
  assert.equal(stranger.status, 404);
  const anon = await call(h.base, "POST", paths.ticketSupportCallToken(ticket.id));
  assert.ok(anon.status === 401 || anon.status === 403, `anon status ${anon.status}`);
});

test("a provider failure maps to its bounded code and never echoes a JWT", async () => {
  const ticket = await submitTicket();
  mintFails = new ReactorTokenError("REACTOR_UNAVAILABLE", "http_error", { status: 502 });
  try {
    const res = await call(h.base, "POST", paths.ticketSupportCallToken(ticket.id), {
      cookie: alice.cookie,
    });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "REACTOR_UNAVAILABLE");
    assert.ok(!JSON.stringify(res.body).includes("jwt"));
  } finally {
    mintFails = null;
  }
});

test("the avatar token is rate-limited per session", async () => {
  const ticket = await submitTicket();
  // A fresh staff session starts with an empty limiter bucket.
  const login = await call<SessionState>(h.base, "POST", paths.supportSession(), {
    body: { supportCode: SUPPORT_CODE },
  });
  const staff = cookieFrom(login.res);
  const statuses: number[] = [];
  for (let i = 0; i < 11; i += 1) {
    const res = await call(h.base, "POST", paths.ticketSupportCallToken(ticket.id), {
      cookie: staff,
    });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
  assert.equal(statuses[10], 429);
});

test("brief: Gemini writes the call package once per ticket from the case facts", async () => {
  const ticket = await submitTicket();
  const before = briefRequests.length;
  const first = await call<SupportCallBriefResponse>(
    h.base,
    "POST",
    paths.ticketSupportCallBrief(ticket.id),
    { cookie: alice.cookie },
  );
  assert.equal(first.status, 200);
  const pkg = first.body.package;
  assert.ok(pkg.persona.startsWith(SUPPORT_CALL_PERSONA_OPENER));
  assert.ok(pkg.persona.endsWith(CALL_GROUND_RULES), "server appends the fixed ground rules");
  assert.match(CALL_GROUND_RULES, /never the customer/);
  // Vidu hands start_call.greeting to the character's LLM as its first cue: a bare spoken line was
  // answered as if the customer had said it, so the line goes out wrapped as a direction.
  assert.equal(
    pkg.greeting,
    `Open the call by saying: "Hi, I'm Sam, an AI support agent. I watched your clip. When does it jerk backward?"`,
  );
  assert.equal(first.body.modelId, "stub-text-model");
  assert.equal(first.body.avatarId, null);
  assert.equal(first.body.portraitUrl, paths.ticketSupportCallPortrait(ticket.id));
  assert.equal(briefRequests.length, before + 1);
  const sent = JSON.stringify(briefRequests.at(-1)!.input);
  assert.match(sent, /It stops then jerks backward once\./);
  assert.match(sent, /cause unknown/);
  assert.match(sent, /Appears consistent with one backward movement\./);

  const again = await call<SupportCallBriefResponse>(
    h.base,
    "POST",
    paths.ticketSupportCallBrief(ticket.id),
    { cookie: support.cookie },
  );
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.package, pkg);
  assert.equal(briefRequests.length, before + 1, "cached: no second Gemini call");

  const stranger = await call(h.base, "POST", paths.ticketSupportCallBrief(ticket.id), {
    cookie: bob.cookie,
  });
  assert.equal(stranger.status, 404);
});

test("brief: a persona without the AI opener is prefixed and an overlong greeting clipped", async () => {
  const ticket = await submitTicket();
  const saved = briefReply;
  briefReply = () => ({
    status: "completed",
    output_text: JSON.stringify({
      persona: "Help the customer with their robot vacuum that jerks backward after it stops.",
      greeting: `Hello there. ${"I watched your clip and I can help. ".repeat(10)}`,
    }),
  });
  try {
    const res = await call<SupportCallBriefResponse>(
      h.base,
      "POST",
      paths.ticketSupportCallBrief(ticket.id),
      { cookie: alice.cookie },
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.package.persona.startsWith(`${SUPPORT_CALL_PERSONA_OPENER}. Help`));
    const cue = res.body.package.greeting;
    assert.ok(cue.length <= 200, `cue length ${cue.length}`);
    assert.ok(cue.startsWith('Open the call by saying: "Hello there. I watched your clip'));
    assert.ok(cue.endsWith('can help."'), "clipped at a sentence, quote closed");
  } finally {
    briefReply = saved;
  }
});

test("brief: a package cached before the greeting cue is written again", async () => {
  const ticket = await submitTicket();
  const ts = new Date().toISOString();
  h.ctx.db
    .prepare(
      `INSERT INTO ticket_support_calls (ticket_id, persona, greeting, brief_model_id, avatar_id,
         created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ticket.id,
      `${SUPPORT_CALL_PERSONA_OPENER}. Old persona.`,
      "Hi, I'm Sam.",
      "old",
      "av_9",
      ts,
      ts,
    );
  const before = briefRequests.length;
  const res = await call<SupportCallBriefResponse>(
    h.base,
    "POST",
    paths.ticketSupportCallBrief(ticket.id),
    { cookie: alice.cookie },
  );
  assert.equal(res.status, 200);
  assert.equal(briefRequests.length, before + 1);
  assert.ok(res.body.package.greeting.startsWith("Open the call by saying:"));
  assert.equal(res.body.avatarId, "av_9", "the saved avatar survives the rewrite");
});

test("brief: a provider failure is a bounded error and nothing is cached", async () => {
  const ticket = await submitTicket();
  const saved = briefReply;
  briefReply = () => {
    throw Object.assign(new Error("upstream"), { status: 500 });
  };
  try {
    const res = await call(h.base, "POST", paths.ticketSupportCallBrief(ticket.id), {
      cookie: alice.cookie,
    });
    assert.equal(res.status, 502);
    assert.equal(res.body.code, "PROVIDER_FAILED");
    const row = getRow(
      h.ctx.db,
      "SELECT * FROM ticket_support_calls WHERE ticket_id = ?",
      ticket.id,
    );
    assert.equal(row, undefined);
  } finally {
    briefReply = saved;
  }
});

const imageRequests: GenerateImageRequest[] = [];
let imageFails = false;

async function stubJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 30, height: 40, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .jpeg()
    .toBuffer();
}

function useStubImages(): void {
  setNanoBananaFor(h.ctx, {
    generateImage: async (req) => {
      imageRequests.push(req);
      if (imageFails) throw Object.assign(new Error("x"), { code: "ASSESSMENT_FAILED" });
      return { bytes: await stubJpeg(), mime: "image/jpeg", modelId: "stub-image", latencyMs: 1 };
    },
  });
}

test("portrait: Nano Banana composites the agent with the ticket's product, cached per ticket", async () => {
  useStubImages();
  const ticket = await submitTicket();
  const before = imageRequests.length;
  const res = await call(h.base, "GET", paths.ticketSupportCallPortrait(ticket.id), {
    cookie: alice.cookie,
  });
  assert.equal(res.status, 200);
  assert.equal(res.res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.res.headers.get("x-portrait-source"), "composite");
  assert.equal(imageRequests.length, before + 1);
  const req = imageRequests.at(-1)!;
  assert.equal(req.aspectRatio, "3:4");
  assert.equal(req.timeoutMs, 25_000);
  assert.equal(req.images?.length, 2, "base agent portrait + the customer's product photo");
  assert.match(req.prompt, /fictional/);

  const staff = await call(h.base, "GET", paths.ticketSupportCallPortrait(ticket.id), {
    cookie: support.cookie,
  });
  assert.equal(staff.status, 200);
  assert.equal(staff.res.headers.get("x-portrait-source"), "composite");
  assert.equal(imageRequests.length, before + 1, "served from the per-ticket cache");

  const stranger = await call(h.base, "GET", paths.ticketSupportCallPortrait(ticket.id), {
    cookie: bob.cookie,
  });
  assert.equal(stranger.status, 404);
});

test("portrait: a failed composite falls back to the base portrait and is not retried", async () => {
  useStubImages();
  const ticket = await submitTicket();
  imageFails = true;
  try {
    const before = imageRequests.length;
    const first = await call(h.base, "GET", paths.ticketSupportCallPortrait(ticket.id), {
      cookie: alice.cookie,
    });
    assert.equal(first.status, 200);
    assert.equal(first.res.headers.get("x-portrait-source"), "base");
    const again = await call(h.base, "GET", paths.ticketSupportCallPortrait(ticket.id), {
      cookie: alice.cookie,
    });
    assert.equal(again.res.headers.get("x-portrait-source"), "base");
    assert.equal(imageRequests.length, before + 1);
  } finally {
    imageFails = false;
  }
});

test("avatar id: saved per ticket and handed back with the brief", async () => {
  const ticket = await submitTicket();
  const bad = await call(h.base, "PUT", paths.ticketSupportCallAvatar(ticket.id), {
    cookie: alice.cookie,
    body: { avatarId: "" },
  });
  assert.equal(bad.status, 400);
  const stranger = await call(h.base, "PUT", paths.ticketSupportCallAvatar(ticket.id), {
    cookie: bob.cookie,
    body: { avatarId: "av_123" },
  });
  assert.equal(stranger.status, 404);
  const saved = await call(h.base, "PUT", paths.ticketSupportCallAvatar(ticket.id), {
    cookie: alice.cookie,
    body: { avatarId: "av_123" },
  });
  assert.equal(saved.status, 200);
  const brief = await call<SupportCallBriefResponse>(
    h.base,
    "POST",
    paths.ticketSupportCallBrief(ticket.id),
    { cookie: alice.cookie },
  );
  assert.equal(brief.status, 200);
  assert.equal(brief.body.avatarId, "av_123");
});

test("transcript: stored once per idempotency key and shown to support only", async () => {
  const ticket = await submitTicket();
  const body = {
    lines: [
      { speaker: "character", text: "Hi, I'm Sam, an AI support agent." },
      { speaker: "user", text: "It jerks back after it stops.", typed: true },
    ],
    durationSeconds: 42.4,
    endReason: "user_ended",
    idempotencyKey: "call-transcript-1",
  };
  const stranger = await call(h.base, "POST", paths.ticketSupportCallTranscripts(ticket.id), {
    cookie: bob.cookie,
    body,
  });
  assert.equal(stranger.status, 404);
  const bad = await call(h.base, "POST", paths.ticketSupportCallTranscripts(ticket.id), {
    cookie: alice.cookie,
    body: { ...body, lines: [{ speaker: "narrator", text: "x" }] },
  });
  assert.equal(bad.status, 400);

  const first = await call<SupportCallTranscript>(
    h.base,
    "POST",
    paths.ticketSupportCallTranscripts(ticket.id),
    { cookie: alice.cookie, body },
  );
  assert.equal(first.status, 201);
  assert.equal(first.body.ticketId, ticket.id);
  assert.equal(first.body.durationSeconds, 42);
  assert.deepEqual(first.body.lines, body.lines);
  assert.match(first.body.id, /^sct_/);
  const replay = await call<SupportCallTranscript>(
    h.base,
    "POST",
    paths.ticketSupportCallTranscripts(ticket.id),
    { cookie: alice.cookie, body },
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.id, first.body.id);

  const asCustomer = await call<TicketResponse>(h.base, "GET", paths.ticket(ticket.id), {
    cookie: alice.cookie,
  });
  assert.equal(asCustomer.status, 200);
  assert.equal(asCustomer.body.ticket.aiCallTranscripts, undefined);
  const asSupport = await call<TicketResponse>(h.base, "GET", paths.ticket(ticket.id), {
    cookie: support.cookie,
  });
  assert.equal(asSupport.status, 200);
  assert.deepEqual(
    asSupport.body.ticket.aiCallTranscripts?.map((t) => t.id),
    [first.body.id],
  );
  assert.equal(asSupport.body.ticket.aiCallTranscripts?.[0]?.lines.length, 2);
});
