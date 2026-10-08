// Story mode P2 ("Write the ending"): the 1-2 ending scenes in order, driven only by FastH3 clip
// events. Scene 1 opens from the story's last frame; scene 2 continues from scene 1. A scene plays
// once FastH3 reports it built and the stage is free; nothing advances on a timer.
import type { FileRef } from "@reactor-team/js-sdk";
import type { StoryEndingResponse, StoryScene, StoryTokenResponse } from "@symptomsketch/contracts";
import type { EnqueueParams } from "./fast-h3";
import type { ClipRecord } from "./story-state";

export type EndingClipState = "queued" | "ready" | "playing" | "played" | "failed";

export interface EndingClip {
  clipId: string;
  scene: StoryScene;
  state: EndingClipState;
  queuedAt: number;
  readyAt: number | null;
}

export interface EndingState {
  /** In scene order. */
  clips: EndingClip[];
  /** Clip ids FastH3 reported built before their enqueue reply landed. */
  early: string[];
  playingId: string | null;
  playSentId: string | null;
}

export type EndingEvent =
  | { type: "queued"; clipId: string; scene: StoryScene; at: number }
  | { type: "ready"; clipIds: string[]; at: number }
  | { type: "started"; clipId: string }
  | { type: "finished"; clipId: string | null }
  | { type: "failed"; clipId: string | null }
  | { type: "play_sent"; clipId: string };

export const initialEndingState = (): EndingState => ({
  clips: [],
  early: [],
  playingId: null,
  playSentId: null,
});

function patch(s: EndingState, clipId: string, f: (c: EndingClip) => EndingClip): EndingState {
  if (!s.clips.some((c) => c.clipId === clipId)) return s;
  return { ...s, clips: s.clips.map((c) => (c.clipId === clipId ? f(c) : c)) };
}

const settled = (c: EndingClip) => c.state === "played" || c.state === "failed";

export function endingReducer(s: EndingState, e: EndingEvent): EndingState {
  switch (e.type) {
    case "queued": {
      if (s.clips.some((c) => c.clipId === e.clipId)) return s;
      const early = s.early.includes(e.clipId);
      const clip: EndingClip = {
        clipId: e.clipId,
        scene: e.scene,
        state: early ? "ready" : "queued",
        queuedAt: e.at,
        readyAt: early ? e.at : null,
      };
      return { ...s, clips: [...s.clips, clip], early: s.early.filter((id) => id !== e.clipId) };
    }
    case "ready": {
      let next = s;
      for (const id of e.clipIds) {
        if (!next.clips.some((c) => c.clipId === id)) {
          if (!next.early.includes(id)) next = { ...next, early: [...next.early, id] };
          continue;
        }
        next = patch(next, id, (c) =>
          c.state === "queued" ? { ...c, state: "ready", readyAt: e.at } : c,
        );
      }
      return next;
    }
    case "started": {
      let next = s;
      // A new clip on stage means the one before it is done, even without its finish event.
      if (s.playingId && s.playingId !== e.clipId) {
        next = patch(next, s.playingId, (c) => (settled(c) ? c : { ...c, state: "played" }));
      }
      next = patch(next, e.clipId, (c) => (settled(c) ? c : { ...c, state: "playing" }));
      return { ...next, playingId: e.clipId };
    }
    case "finished": {
      const id = e.clipId ?? s.playingId;
      if (!id) return s;
      const next = patch(s, id, (c) => (c.state === "failed" ? c : { ...c, state: "played" }));
      return { ...next, playingId: next.playingId === id ? null : next.playingId };
    }
    case "failed":
      return e.clipId ? patch(s, e.clipId, (c) => ({ ...c, state: "failed" })) : s;
    case "play_sent":
      return { ...s, playSentId: e.clipId };
  }
}

/** The clip to play now: the first scene not played yet, once built, with the stage free. */
export function nextEndingClip(s: EndingState): string | null {
  if (s.playingId) return null;
  const next = s.clips.find((c) => c.state !== "played");
  if (!next || next.state !== "ready" || s.playSentId === next.clipId) return null;
  return next.clipId;
}

/** Every expected scene was queued and has played. */
export function endingComplete(s: EndingState, expected: number): boolean {
  return expected > 0 && s.clips.length === expected && s.clips.every((c) => c.state === "played");
}

/** 1-based scene number of a failed clip, or null. */
export function failedScene(s: EndingState): number | null {
  const i = s.clips.findIndex((c) => c.state === "failed");
  return i === -1 ? null : i + 1;
}

export function playingScene(s: EndingState): { index: number; scene: StoryScene } | null {
  const i = s.clips.findIndex((c) => c.clipId === s.playingId);
  return i === -1 ? null : { index: i, scene: s.clips[i]!.scene };
}

/** What launching an ending needs from the API (support-only routes) and the media URL. */
export interface EndingApi {
  write: () => Promise<StoryEndingResponse>;
  token: () => Promise<StoryTokenResponse>;
  frame: () => Promise<Blob>;
}

/** The part of a FastH3 session the launch uses. */
export interface EndingSession {
  connect(jwt: string): Promise<void>;
  configure(seconds: number): Promise<void>;
  uploadFile(blob: Blob): Promise<FileRef>;
  enqueue(p: EnqueueParams): Promise<ClipRecord | null>;
}

export interface EndingLaunchHooks {
  /** The director answered (the session may still be connecting). */
  scenes?: (r: StoryEndingResponse) => void;
  /** The session is connected, configured, and holds the uploaded last frame. */
  ready?: (token: StoryTokenResponse) => void;
  queued?: (clipId: string, scene: StoryScene) => void;
}

export class EndingLaunchError extends Error {
  constructor(readonly step: "enqueue") {
    super(step);
  }
}

/**
 * Gemini and the session start together: the director writes the scenes while the session connects
 * and uploads the story's last frame. Then scene 1 is enqueued FROM that frame and scene 2 (if any)
 * continues from scene 1's clip. Rejects on the first failure; the caller tears the session down.
 */
export async function launchEnding(
  api: EndingApi,
  session: EndingSession,
  hooks: EndingLaunchHooks = {},
): Promise<{ scenes: StoryScene[]; token: StoryTokenResponse }> {
  const prepare = (async () => {
    const [token, frame] = await Promise.all([api.token(), api.frame()]);
    await session.connect(token.jwt);
    await session.configure(token.clipSeconds);
    const ref = await session.uploadFile(frame);
    hooks.ready?.(token);
    return { token, ref };
  })();
  const write = api.write().then((r) => {
    hooks.scenes?.(r);
    return r;
  });
  const [ending, { token, ref }] = await Promise.all([write, prepare]);
  let previous: string | null = null;
  for (const [i, scene] of ending.scenes.entries()) {
    const clip = await session.enqueue({
      prompt: scene.prompt,
      seconds: token.clipSeconds,
      metadata: JSON.stringify({ ending: i + 1, choice: scene.label }),
      ...(previous === null ? { startingFrame: ref } : { continueFromClipId: previous }),
    });
    if (!clip) throw new EndingLaunchError("enqueue");
    hooks.queued?.(clip.clipId, scene);
    previous = clip.clipId;
  }
  return { scenes: ending.scenes, token };
}
