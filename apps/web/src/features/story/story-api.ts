import {
  ERROR_COPY,
  ErrorCode,
  STORY_LIMITS,
  STORY_UPLOAD_FIELDS,
  storyPaths,
  type StoryBeatsUpload,
  type StoryDirectorRequest,
  type StoryDirectorResponse,
  type StorySubmitResponse,
  type StoryTokenResponse,
  type TicketStoryResponse,
} from "@symptomsketch/contracts";
import { ApiClientError } from "@/lib/api";
import type { PlayedBeat } from "./story-state";

async function failure(res: Response): Promise<ApiClientError> {
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    const parsed = ErrorCode.safeParse(body.code);
    if (parsed.success) {
      return new ApiClientError(
        parsed.data,
        typeof body.message === "string" ? body.message : ERROR_COPY[parsed.data],
        res.status,
      );
    }
  } catch {
    // non-JSON body
  }
  return new ApiClientError("INTERNAL_ERROR", ERROR_COPY.INTERNAL_ERROR, res.status);
}

export async function storyFetch<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Could not reach the server.", 0);
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

const postJson = <T>(url: string, body: unknown, signal?: AbortSignal) =>
  storyFetch<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

export const getStoryToken = (caseId: string) =>
  postJson<StoryTokenResponse>(storyPaths.token(caseId), {});

export const askDirector = (caseId: string, req: StoryDirectorRequest, signal?: AbortSignal) =>
  postJson<StoryDirectorResponse>(storyPaths.director(caseId), req, signal);

/** The case's own normalized product photo (owner-authorized media URL). */
export async function fetchPhoto(url: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Could not load your product photo.", 0);
  }
  if (!res.ok) throw await failure(res);
  return res.blob();
}

/** The beats JSON sent with the reel: exactly the scenes that played and the cards offered. */
export function beatsUpload(
  beats: PlayedBeat[],
  clipSeconds: number,
  durationMs: number,
): StoryBeatsUpload {
  return {
    beats: beats.map(({ label, caption, prompt, custom }) => ({ label, caption, prompt, custom })),
    offered: beats.map((b) => b.offered),
    clipSeconds,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

export interface StoryParts {
  reel: Blob;
  frame: Blob | null;
  beats: StoryBeatsUpload;
}

/** POST the finished story (reel + last frame + beats) for the case owner. */
export function sendStory(caseId: string, parts: StoryParts): Promise<StorySubmitResponse> {
  if (parts.reel.size > STORY_LIMITS.reelMaxBytes) {
    return Promise.reject(
      new ApiClientError("PAYLOAD_TOO_LARGE", "The story recording is too large to send.", 413),
    );
  }
  const form = new FormData();
  form.append(STORY_UPLOAD_FIELDS.beats, JSON.stringify(parts.beats));
  const ext = parts.reel.type.includes("mp4") ? "mp4" : "webm";
  form.append(STORY_UPLOAD_FIELDS.reel, parts.reel, `story.${ext}`);
  if (parts.frame && parts.frame.size <= STORY_LIMITS.lastFrameMaxBytes) {
    form.append(STORY_UPLOAD_FIELDS.frame, parts.frame, "last-frame.png");
  }
  return storyFetch<StorySubmitResponse>(storyPaths.submit(caseId), { method: "POST", body: form });
}

export const getTicketStory = (ticketId: string, signal?: AbortSignal) =>
  storyFetch<TicketStoryResponse>(storyPaths.ticketStory(ticketId), { signal });
