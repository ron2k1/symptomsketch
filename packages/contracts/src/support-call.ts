import { z } from "zod";
import { ClientRequestId, Id, Timestamp } from "./common.ts";
import { LIMITS } from "./limits.ts";

/**
 * Live AI support agent call (Reactor Vidu S2 Avatar, "Talk to support now"). The customer talks
 * to a fictional, clearly-AI agent that already knows the submitted case. Every route is scoped to
 * one ticket: the owning customer session or Demo Support.
 */

/** Reactor model resource the call token is scoped to. */
export const SUPPORT_CALL_MODEL = "reactor/vidu-s2-avatar";

/** Fictional agent name. The persona always says it is an AI. */
export const SUPPORT_CALL_AGENT_NAME = "Sam";

/** Required opening of every persona, so the agent never presents as a human. */
export const SUPPORT_CALL_PERSONA_OPENER = `You are ${SUPPORT_CALL_AGENT_NAME}, a SymptomSketch Demo Support agent (an AI)`;

export const SUPPORT_CALL_COPY = {
  start: "Talk to support now",
  modelCredit: "Live AI support agent",
  modelName: "Reactor Vidu S2 Avatar",
  portraitCredit: "Portrait: AI-generated with Nano Banana · fictional",
  transcriptHeading: "AI support agent call transcript",
  micDenied: "Microphone unavailable. You can keep typing your messages.",
  transcriptSaved: "The call transcript was added to your ticket for Demo Support.",
  transcriptFailed: "The call transcript could not be added to your ticket.",
} as const;

export const SupportCallPhase = z.enum(["idle", "preparing", "connecting", "live", "ended"]);
export type SupportCallPhase = z.infer<typeof SupportCallPhase>;

export const SUPPORT_CALL_PHASE_LABELS: Record<SupportCallPhase, string> = {
  idle: "Ready",
  preparing: "Preparing your support agent",
  connecting: "Connecting",
  live: "Live",
  ended: "Ended",
};

/** POST /api/tickets/:id/support-call/token: one max_sessions=1 JWT for reactor/vidu-s2-avatar. */
export const SupportCallTokenResponse = z.object({
  jwt: z.string().min(1),
  expiresAt: Timestamp,
  model: z.literal(SUPPORT_CALL_MODEL),
  /** Provider-side hard stop for the whole session (seconds). */
  maxSessionDurationSeconds: z.number().int().positive(),
});
export type SupportCallTokenResponse = z.infer<typeof SupportCallTokenResponse>;

/** What start_call receives. Written once per ticket by Gemini and cached server-side. */
export const SupportCallPackage = z.object({
  persona: z.string().min(1).max(LIMITS.supportCallPersonaMaxChars),
  /** A cue for the character's first turn (`Open the call by saying: "..."`), not verbatim TTS. */
  greeting: z.string().min(1).max(LIMITS.supportCallGreetingMaxChars),
});
export type SupportCallPackage = z.infer<typeof SupportCallPackage>;

/** POST /api/tickets/:id/support-call/brief. */
export const SupportCallBriefResponse = z.object({
  package: SupportCallPackage,
  /** Gemini model id that wrote the package. */
  modelId: z.string(),
  /** Reactor avatar saved from an earlier call on this ticket (attach_avatar), else null. */
  avatarId: z.string().nullable(),
  /** GET this for the agent portrait bytes (owner or support only). */
  portraitUrl: z.string(),
});
export type SupportCallBriefResponse = z.infer<typeof SupportCallBriefResponse>;

/** PUT /api/tickets/:id/support-call/avatar: remember the avatar create_avatar produced. */
export const SaveSupportCallAvatarRequest = z.object({
  avatarId: z.string().min(1).max(128),
});
export type SaveSupportCallAvatarRequest = z.infer<typeof SaveSupportCallAvatarRequest>;

export const SupportCallSpeaker = z.enum(["user", "character"]);
export type SupportCallSpeaker = z.infer<typeof SupportCallSpeaker>;

export const SupportCallTranscriptLine = z.object({
  speaker: SupportCallSpeaker,
  text: z.string().min(1).max(LIMITS.supportCallLineMaxChars),
  /** Typed into the say box rather than spoken. */
  typed: z.boolean().optional(),
});
export type SupportCallTranscriptLine = z.infer<typeof SupportCallTranscriptLine>;

/** POST /api/tickets/:id/support-call/transcripts (final lines only). Same key -> same record. */
export const CreateSupportCallTranscriptRequest = z.object({
  lines: z.array(SupportCallTranscriptLine).max(LIMITS.supportCallTranscriptMaxLines),
  durationSeconds: z
    .number()
    .nonnegative()
    .max(24 * 60 * 60),
  endReason: z.string().max(100).nullable(),
  idempotencyKey: ClientRequestId,
});
export type CreateSupportCallTranscriptRequest = z.infer<typeof CreateSupportCallTranscriptRequest>;

/** One stored call transcript (support sees these on the ticket). */
export const SupportCallTranscript = z.object({
  id: Id,
  ticketId: Id,
  lines: z.array(SupportCallTranscriptLine),
  durationSeconds: z.number().nonnegative(),
  endReason: z.string().nullable(),
  createdAt: Timestamp,
});
export type SupportCallTranscript = z.infer<typeof SupportCallTranscript>;
