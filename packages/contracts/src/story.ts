// Story mode (Interactive Narrative track): the customer tells what their product did as a short
// interactive story that MiniMax FastH3 on Reactor plays with sound, and steers it scene by scene.
// Gemini (the "story director") writes every scene, choice and caption from the live case; the
// browser enqueues each scene prompt on FastH3. Nothing here is story content: only shapes + caps.
import { z } from "zod";
import { Id, Timestamp } from "./common.ts";

/** Story-only limits. Kept out of the shared LIMITS object on purpose (parallel branches). */
export const STORY_LIMITS = {
  /** Choice button text the customer reads. */
  choiceMaxChars: 60,
  /** Caption shown under the stage while a scene plays. */
  captionMaxChars: 160,
  /**
   * FastH3 refuses prompts over 1024 model tokens. English runs ~4 chars per token, so 900 chars
   * stays far under the budget with room for the tokenizer to disagree.
   */
  scenePromptMaxChars: 900,
  /** Free-text "something else happened" box. */
  freeTextMaxChars: 280,
  /** Choices offered after every scene. */
  choicesPerBeat: 3,
  /** The director offers "That's what happened" once this many scenes have played. */
  endOfferAfterBeats: 3,
  /** Hard cap on scenes in one story (opening included). */
  maxBeats: 6,
  /** One clip length for the whole session (FastH3 snaps to 17n+5 frames at 24 fps: 141 f). */
  clipSeconds: 5.875,
  /** Client-side cap on one FastH3 session. */
  sessionMaxSeconds: 8 * 60,
  /** Provider-side cap baked into the token (a little above the client cap). */
  tokenSessionMaxSeconds: 9 * 60,
  /** Disconnect after the tab stays hidden this long. */
  hiddenDisconnectMs: 60_000,
  /** P1 upload caps. */
  reelMaxBytes: 80 * 1024 * 1024,
  lastFrameMaxBytes: 6 * 1024 * 1024,
  beatsJsonMaxBytes: 64 * 1024,
  /** Stories one case can send to support (each carries a reel of up to reelMaxBytes). */
  storiesPerCaseMax: 5,
} as const;

export const FAST_H3_MODEL_NAME = "reactor/fast-h3";

/** Three-act arc the director keeps (spec: setup, what went wrong, the moment it failed). */
export const StoryAct = z.enum(["setup", "went_wrong", "failure"]);
export type StoryAct = z.infer<typeof StoryAct>;

export const STORY_ACT_LABELS: Record<StoryAct, string> = {
  setup: "Setup",
  went_wrong: "What went wrong",
  failure: "The moment it failed",
};

/** Act of the scene with 1-based number `beat` (opening = 1). Shared by director + timeline. */
export function storyActForBeat(beat: number): StoryAct {
  if (beat <= 1) return "setup";
  if (beat === 2) return "went_wrong";
  return "failure";
}

/** One scene the director wrote: what the customer reads + the FastH3 prompt that renders it. */
export const StoryScene = z.object({
  label: z.string().trim().min(1).max(STORY_LIMITS.choiceMaxChars),
  caption: z.string().trim().min(1).max(STORY_LIMITS.captionMaxChars),
  prompt: z.string().trim().min(40).max(STORY_LIMITS.scenePromptMaxChars),
});
export type StoryScene = z.infer<typeof StoryScene>;

/** A scene that already played, as the client reports it back to the director. */
export const StoryBeatRecord = z.object({
  label: z.string().trim().min(1).max(STORY_LIMITS.choiceMaxChars),
  caption: z.string().trim().min(1).max(STORY_LIMITS.captionMaxChars),
  prompt: z.string().trim().min(1).max(STORY_LIMITS.scenePromptMaxChars),
  /** True when the customer typed it instead of picking a card. */
  custom: z.boolean().default(false),
});
export type StoryBeatRecord = z.infer<typeof StoryBeatRecord>;

export const StoryDirectorRequest = z.discriminatedUnion("kind", [
  /** Opening scene + the first three choices, written from the case. */
  z.object({ kind: z.literal("opening") }),
  /** Three choices for what happened after the last played beat. */
  z.object({
    kind: z.literal("next"),
    beats: z.array(StoryBeatRecord).min(1).max(STORY_LIMITS.maxBeats),
  }),
  /** Turn the customer's own words into one scene that continues the story. */
  z.object({
    kind: z.literal("custom"),
    beats: z
      .array(StoryBeatRecord)
      .min(1)
      .max(STORY_LIMITS.maxBeats - 1),
    text: z.string().trim().min(3).max(STORY_LIMITS.freeTextMaxChars),
  }),
]);
export type StoryDirectorRequest = z.infer<typeof StoryDirectorRequest>;

export const StoryDirectorResponse = z.object({
  /** opening: the setup scene; custom: the customer's scene; next: null. */
  scene: StoryScene.nullable(),
  /** opening + next: exactly three; custom: empty (the next call writes them). */
  choices: z.array(StoryScene).max(STORY_LIMITS.choicesPerBeat),
  /** Act the offered choices belong to. */
  act: StoryAct,
  /** Show "That's what happened". */
  offerEnd: z.boolean(),
  /** No more choices: the story is at its hard cap. */
  atCap: z.boolean(),
  modelId: z.string(),
  latencyMs: z.number().int().nonnegative(),
});
export type StoryDirectorResponse = z.infer<typeof StoryDirectorResponse>;

export const StoryTokenResponse = z.object({
  /** Short-lived JWT scoped to reactor/fast-h3, max_sessions 1. Never logged or stored. */
  jwt: z.string().min(1),
  expiresAt: Timestamp,
  modelName: z.literal(FAST_H3_MODEL_NAME),
  clipSeconds: z.number(),
  sessionMaxSeconds: z.number().int(),
});
export type StoryTokenResponse = z.infer<typeof StoryTokenResponse>;

/** Story routes live here (not in the shared ROUTES map) to keep parallel branches mergeable. */
export const STORY_ROUTES = {
  token: "/api/cases/:caseId/story/token",
  director: "/api/cases/:caseId/story/director",
  submit: "/api/cases/:caseId/story/submit",
  ticketStory: "/api/tickets/:ticketId/story",
  ticketStoryReel: "/api/tickets/:ticketId/story/reel",
  ticketStoryFrame: "/api/tickets/:ticketId/story/frame",
} as const;

const enc = encodeURIComponent;
export const storyPaths = {
  token: (caseId: string) => `/api/cases/${enc(caseId)}/story/token`,
  director: (caseId: string) => `/api/cases/${enc(caseId)}/story/director`,
  submit: (caseId: string) => `/api/cases/${enc(caseId)}/story/submit`,
  ticketStory: (ticketId: string) => `/api/tickets/${enc(ticketId)}/story`,
  ticketStoryReel: (ticketId: string) => `/api/tickets/${enc(ticketId)}/story/reel`,
  ticketStoryFrame: (ticketId: string) => `/api/tickets/${enc(ticketId)}/story/frame`,
  /** Client route of the story page. */
  page: (caseId: string) => `/cases/${enc(caseId)}/story`,
} as const;

// ---- P1: send the finished story to support ----

/** Multipart field names of POST STORY_ROUTES.submit. */
export const STORY_UPLOAD_FIELDS = { reel: "reel", frame: "frame", beats: "beats" } as const;

export const StoryReelMime = z.enum(["video/webm", "video/mp4"]);

/** The beats JSON part (captions, choices, prompts) uploaded with the reel. */
export const StoryBeatsUpload = z.object({
  beats: z.array(StoryBeatRecord).min(1).max(STORY_LIMITS.maxBeats),
  /** The cards offered at each beat (labels only), for the staff timeline. */
  offered: z
    .array(z.array(z.string().max(STORY_LIMITS.choiceMaxChars)).max(4))
    .max(STORY_LIMITS.maxBeats),
  clipSeconds: z.number(),
  durationMs: z.number().int().nonnegative(),
});
export type StoryBeatsUpload = z.infer<typeof StoryBeatsUpload>;

/**
 * A sent story. It belongs to the CASE: support sees it on that case's ticket, whether the ticket
 * existed when the story was sent or is sent later through the normal Support flow.
 */
export const TicketStory = z.object({
  id: Id,
  /** The case's live ticket when the story was sent (null: no ticket yet). */
  ticketId: Id.nullable(),
  caseId: Id,
  beats: z.array(StoryBeatRecord),
  offered: z.array(z.array(z.string())),
  clipSeconds: z.number(),
  durationMs: z.number().int(),
  reelMime: z.string(),
  reelBytes: z.number().int(),
  /** Ticket-scoped media URLs (null when there is no ticket to read them through yet). */
  reelUrl: z.string().nullable(),
  frameUrl: z.string().nullable(),
  createdAt: Timestamp,
});
export type TicketStory = z.infer<typeof TicketStory>;

export const StorySubmitResponse = z.object({ ticketId: Id.nullable(), story: TicketStory });
export type StorySubmitResponse = z.infer<typeof StorySubmitResponse>;

export const TicketStoryResponse = z.object({ story: TicketStory.nullable() });
export type TicketStoryResponse = z.infer<typeof TicketStoryResponse>;
