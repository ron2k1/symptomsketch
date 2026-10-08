// Pure Story-mode bookkeeping: the live Reactor queue view (driven only by real FastH3 messages),
// the story's beats, the speculative branches of the current beat, and the pick logic.
import type { StoryAct, StoryBeatRecord, StoryScene } from "@symptomsketch/contracts";

export type ClipState =
  "queued" | "building" | "ready" | "playing" | "played" | "popped" | "failed";

/** One clip as FastH3 reports it (queue_update / clip_* records). */
export interface ClipRecord {
  clipId: string;
  prompt?: string;
  metadata?: string;
  seconds?: number;
  ready?: boolean;
}

/** Our own correlation data carried in FastH3 `metadata` (echoed back on every clip reference). */
export interface ClipMeta {
  beat: number;
  choice: string;
}

export interface ClipView {
  clipId: string;
  state: ClipState;
  seconds: number | null;
  meta: ClipMeta | null;
  queuedAt: number | null;
  generatedAt: number | null;
  startedAt: number | null;
  /** First queue_update that showed it at the front of the generation queue. */
  buildingAt: number | null;
}

export interface Branch {
  scene: StoryScene;
  /** Null until the enqueue reply (clip_queued) names it. */
  clipId: string | null;
  /** Enqueue was refused (command_error / no reply). */
  failed: boolean;
}

export interface Offer {
  /** 1-based number of the scene these choices would become. */
  beat: number;
  act: StoryAct;
  offerEnd: boolean;
  atCap: boolean;
  branches: Branch[];
}

export interface PlayedBeat extends StoryBeatRecord {
  clipId: string;
  /** Labels offered at this beat (empty for the opening). */
  offered: string[];
}

export interface PendingPick {
  clipId: string;
  pickedAt: number;
  /** Was it already built (in the playout queue) at pick time? */
  wasReady: boolean;
  playSent: boolean;
  /** Count it in the pick-to-play readout (false for the opening scene). */
  measure: boolean;
}

export interface StoryTimings {
  directorMs: number[];
  buildMs: number[];
  /** Front of the generation queue -> clip_generated (the build itself). */
  buildOnlyMs: number[];
  pickToStartReadyMs: number[];
  pickToStartBuildingMs: number[];
}

export interface StoryState {
  clips: Record<string, ClipView>;
  order: string[];
  playingId: string | null;
  playoutCapacity: number | null;
  generationCapacity: number | null;
  beats: PlayedBeat[];
  offer: Offer | null;
  pending: PendingPick | null;
  timings: StoryTimings;
}

export function initialStoryState(): StoryState {
  return {
    clips: {},
    order: [],
    playingId: null,
    playoutCapacity: null,
    generationCapacity: null,
    beats: [],
    offer: null,
    pending: null,
    timings: {
      directorMs: [],
      buildMs: [],
      buildOnlyMs: [],
      pickToStartReadyMs: [],
      pickToStartBuildingMs: [],
    },
  };
}

export function parseMeta(raw: string | undefined): ClipMeta | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { beat?: unknown; choice?: unknown };
    if (typeof v.beat === "number" && typeof v.choice === "string") {
      return { beat: v.beat, choice: v.choice };
    }
  } catch {
    // not ours
  }
  return null;
}

export const shortClipId = (id: string): string => id.replace(/-/g, "").slice(0, 8);

const TERMINAL: ReadonlySet<ClipState> = new Set(["played", "popped", "failed"]);

function upsert(s: StoryState, rec: ClipRecord, patch: Partial<ClipView>): StoryState {
  const prev = s.clips[rec.clipId];
  const next: ClipView = {
    clipId: rec.clipId,
    state: prev?.state ?? "queued",
    seconds: rec.seconds ?? prev?.seconds ?? null,
    meta: parseMeta(rec.metadata) ?? prev?.meta ?? null,
    queuedAt: prev?.queuedAt ?? null,
    generatedAt: prev?.generatedAt ?? null,
    startedAt: prev?.startedAt ?? null,
    buildingAt: prev?.buildingAt ?? null,
    ...patch,
  };
  return {
    ...s,
    clips: { ...s.clips, [rec.clipId]: next },
    order: prev ? s.order : [...s.order, rec.clipId],
  };
}

/** Events the reducer understands; every one maps 1:1 to a real FastH3 message or app action. */
export type StoryEvent =
  | { type: "clip_queued"; clip: ClipRecord; at: number }
  | { type: "queue_update"; generation: ClipRecord[]; playout: ClipRecord[]; at: number }
  | { type: "state_update"; playoutCapacity: number | null; generationCapacity: number | null }
  | { type: "clip_generated"; clip: ClipRecord; at: number }
  | { type: "clip_started"; clip: ClipRecord; at: number }
  | { type: "clip_finished"; clipId: string | null }
  | { type: "clip_popped"; clipId: string }
  | { type: "clip_failed"; clipId: string | null }
  | { type: "director_ms"; ms: number }
  | { type: "offer"; offer: Offer }
  | { type: "branch_queued"; beat: number; index: number; clipId: string | null }
  | { type: "picked"; beat: PlayedBeat; pending: PendingPick }
  | { type: "play_sent" };

export function storyReducer(s: StoryState, e: StoryEvent): StoryState {
  switch (e.type) {
    case "clip_queued": {
      const prev = s.clips[e.clip.clipId];
      return upsert(s, e.clip, prev ? {} : { state: "queued", queuedAt: e.at });
    }
    case "queue_update": {
      let next = s;
      const playoutFull = s.playoutCapacity !== null && e.playout.length >= s.playoutCapacity;
      e.generation.forEach((rec, i) => {
        const prev = next.clips[rec.clipId];
        if (prev && TERMINAL.has(prev.state)) return;
        const state: ClipState = i === 0 && !playoutFull ? "building" : "queued";
        next = upsert(next, rec, {
          state,
          queuedAt: prev?.queuedAt ?? e.at,
          buildingAt: prev?.buildingAt ?? (state === "building" ? e.at : null),
        });
      });
      for (const rec of e.playout) {
        const prev = next.clips[rec.clipId];
        if (prev && (TERMINAL.has(prev.state) || prev.state === "playing")) continue;
        next = upsert(next, rec, {
          state: "ready",
          queuedAt: prev?.queuedAt ?? e.at,
          generatedAt: prev?.generatedAt ?? e.at,
        });
      }
      return next;
    }
    case "state_update":
      return {
        ...s,
        playoutCapacity: e.playoutCapacity ?? s.playoutCapacity,
        generationCapacity: e.generationCapacity ?? s.generationCapacity,
      };
    case "clip_generated": {
      const prev = s.clips[e.clip.clipId];
      const next = upsert(s, e.clip, {
        state: prev && TERMINAL.has(prev.state) ? prev.state : "ready",
        generatedAt: e.at,
      });
      const queuedAt = prev?.queuedAt;
      if (queuedAt == null || prev?.generatedAt != null) return next;
      const t = next.timings;
      const buildingAt = prev?.buildingAt;
      return {
        ...next,
        timings: {
          ...t,
          buildMs: [...t.buildMs, e.at - queuedAt],
          buildOnlyMs: buildingAt == null ? t.buildOnlyMs : [...t.buildOnlyMs, e.at - buildingAt],
        },
      };
    }
    case "clip_started": {
      let next = s;
      if (s.playingId && s.playingId !== e.clip.clipId && s.clips[s.playingId]) {
        next = upsert(next, { clipId: s.playingId }, { state: "played" });
      }
      next = upsert(next, e.clip, { state: "playing", startedAt: e.at });
      next = { ...next, playingId: e.clip.clipId };
      const p = s.pending;
      if (p && p.clipId === e.clip.clipId) {
        const ms = e.at - p.pickedAt;
        const t = next.timings;
        next = {
          ...next,
          pending: null,
          timings: !p.measure
            ? t
            : p.wasReady
              ? { ...t, pickToStartReadyMs: [...t.pickToStartReadyMs, ms] }
              : { ...t, pickToStartBuildingMs: [...t.pickToStartBuildingMs, ms] },
        };
      }
      return next;
    }
    case "clip_finished": {
      const id = e.clipId ?? s.playingId;
      if (!id || !s.clips[id]) return { ...s, playingId: null };
      return { ...upsert(s, { clipId: id }, { state: "played" }), playingId: null };
    }
    case "clip_popped":
      return s.clips[e.clipId] ? upsert(s, { clipId: e.clipId }, { state: "popped" }) : s;
    case "clip_failed":
      return e.clipId && s.clips[e.clipId]
        ? upsert(s, { clipId: e.clipId }, { state: "failed" })
        : s;
    case "director_ms":
      return { ...s, timings: { ...s.timings, directorMs: [...s.timings.directorMs, e.ms] } };
    case "offer":
      return { ...s, offer: e.offer };
    case "branch_queued": {
      if (!s.offer || s.offer.beat !== e.beat) return s;
      const branches = s.offer.branches.map((b, i) =>
        i === e.index ? { ...b, clipId: e.clipId, failed: e.clipId === null } : b,
      );
      return { ...s, offer: { ...s.offer, branches } };
    }
    case "picked":
      return { ...s, beats: [...s.beats, e.beat], offer: null, pending: e.pending };
    case "play_sent":
      return s.pending ? { ...s, pending: { ...s.pending, playSent: true } } : s;
  }
}

// ---- pick logic ----

export type QueueCommand =
  | { name: "play"; clipId: string }
  | { name: "move"; clipId: string; position: number }
  | { name: "pop"; clipId: string };

export function isReady(s: StoryState, clipId: string): boolean {
  return s.clips[clipId]?.state === "ready";
}

/** Branch clips of the offer other than `keep` that are still in a queue (worth popping). */
export function unpickedClipIds(s: StoryState, offer: Offer, keep: string | null): string[] {
  return offer.branches
    .map((b) => b.clipId)
    .filter((id): id is string => !!id && id !== keep)
    .filter((id) => {
      const st = s.clips[id]?.state;
      return st === undefined || st === "queued" || st === "building" || st === "ready";
    });
}

/**
 * Customer picks a card: if it is built it plays as soon as the stage is free; if not it jumps to
 * the front of the generation queue. Either way the other branches of this beat are popped.
 */
export function planPick(s: StoryState, offer: Offer, clipId: string): QueueCommand[] {
  const cmds: QueueCommand[] = [];
  if (!isReady(s, clipId)) cmds.push({ name: "move", clipId, position: 0 });
  for (const id of unpickedClipIds(s, offer, clipId)) cmds.push({ name: "pop", clipId: id });
  return cmds;
}

/** Free text replaces the whole offer: pop every speculative branch of this beat. */
export function planCustom(s: StoryState, offer: Offer | null): QueueCommand[] {
  if (!offer) return [];
  return unpickedClipIds(s, offer, null).map((clipId) => ({ name: "pop" as const, clipId }));
}

/** Should the pending pick be played now? Only when built and nothing is on stage. */
export function shouldPlayPending(s: StoryState): string | null {
  const p = s.pending;
  if (!p || p.playSent || s.playingId) return null;
  return isReady(s, p.clipId) ? p.clipId : null;
}

/** Readiness label of a choice card, from the live queue view only. */
export function branchReadiness(
  s: StoryState,
  b: Branch,
): "ready" | "building" | "queued" | "failed" | "sending" {
  if (b.failed) return "failed";
  if (!b.clipId) return "sending";
  const st = s.clips[b.clipId]?.state;
  if (st === "ready") return "ready";
  if (st === "building") return "building";
  if (st === "failed" || st === "popped") return "failed";
  return "queued";
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : Math.round((a[m - 1]! + a[m]!) / 2);
}
