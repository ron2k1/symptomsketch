// Story-mode orchestration: token + director + one FastH3 session. Every scene, choice and caption
// comes from a live director call on this case; every clip from a live FastH3 enqueue. A failure
// shows an honest error with Retry, never a substitute.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  STORY_LIMITS,
  type StoryBeatRecord,
  type StoryDirectorResponse,
  type StoryScene,
} from "@symptomsketch/contracts";
import { errorMessage } from "@/lib/api";
import { askDirector, fetchPhoto, getStoryToken } from "./story-api";
import {
  FastH3Session,
  clipList,
  clipOf,
  numberOf,
  reactorFailure,
  type FastH3Message,
  type FastH3Status,
} from "./fast-h3";
import {
  initialStoryState,
  isReady,
  planCustom,
  planPick,
  shouldPlayPending,
  storyReducer,
  type Offer,
  type PlayedBeat,
  type QueueCommand,
  type StoryEvent,
  type StoryState,
} from "./story-state";

export type StoryPhase = "idle" | "starting" | "live" | "ended" | "error";

export interface StoryNotice {
  message: string;
  /** What Retry does, when it can do anything. */
  retry: (() => void) | null;
}

export interface CommandErrorView {
  command: string;
  reason: string;
  at: number;
}

const meta = (beat: number, choice: string) => JSON.stringify({ beat, choice });

function toRecord(b: PlayedBeat): StoryBeatRecord {
  return { label: b.label, caption: b.caption, prompt: b.prompt, custom: b.custom };
}

export function useStory(caseId: string, photoUrl: string | null) {
  const [phase, setPhase] = useState<StoryPhase>("idle");
  const [status, setStatus] = useState<FastH3Status>("disconnected");
  const [state, setState] = useState<StoryState>(initialStoryState);
  const [fatal, setFatal] = useState<StoryNotice | null>(null);
  const [choiceError, setChoiceError] = useState<StoryNotice | null>(null);
  const [directorBusy, setDirectorBusy] = useState<null | "opening" | "next" | "custom">(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [commandErrors, setCommandErrors] = useState<CommandErrorView[]>([]);
  const [effectiveSeconds, setEffectiveSeconds] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const stateRef = useRef<StoryState>(state);
  const sessionRef = useRef<FastH3Session | null>(null);
  const phaseRef = useRef<StoryPhase>("idle");
  const timers = useRef<number[]>([]);
  const seenTypes = useRef(new Set<string>());
  const onEndedRef = useRef<((s: StoryState) => void) | null>(null);

  const dispatch = useCallback((e: StoryEvent) => {
    const next = storyReducer(stateRef.current, e);
    stateRef.current = next;
    setState(next);
  }, []);

  const setPhaseBoth = useCallback((p: StoryPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const clearTimers = () => {
    for (const t of timers.current.splice(0)) window.clearTimeout(t);
  };

  const teardown = useCallback(async () => {
    clearTimers();
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s) await s.disconnect();
    setStatus("disconnected");
  }, []);

  const fail = useCallback(
    (message: string, retry: (() => void) | null) => {
      if (phaseRef.current === "ended") return;
      void teardown();
      setFatal({ message, retry });
      setPhaseBoth("error");
    },
    [teardown, setPhaseBoth],
  );

  const onMessage = useCallback(
    (m: FastH3Message) => {
      const at = performance.now();
      if (!seenTypes.current.has(m.type)) {
        seenTypes.current.add(m.type);
        // Shape probe for docs/providers/reactor-fast-h3.md: type + top-level keys, never values.
        console.debug(`[fast-h3] first ${m.type} keys=${Object.keys(m.body).join(",")}`);
      }
      const b = m.body;
      switch (m.type) {
        case "queue_update":
          dispatch({
            type: "queue_update",
            generation: clipList(b.generation),
            playout: clipList(b.playout),
            at,
          });
          return;
        case "state_update":
          dispatch({
            type: "state_update",
            playoutCapacity: numberOf(b.playout_capacity),
            generationCapacity: numberOf(b.generation_capacity),
          });
          return;
        case "clip_queued": {
          const clip = clipOf(b);
          if (clip) dispatch({ type: "clip_queued", clip, at });
          return;
        }
        case "clip_generated": {
          const clip = clipOf(b);
          if (clip) dispatch({ type: "clip_generated", clip, at });
          return;
        }
        case "clip_started": {
          const clip = clipOf(b);
          if (clip) dispatch({ type: "clip_started", clip, at });
          return;
        }
        case "clip_finished":
        case "clip_stopped":
          dispatch({ type: "clip_finished", clipId: clipOf(b)?.clipId ?? null });
          return;
        case "clip_popped": {
          const clip = clipOf(b);
          if (clip) dispatch({ type: "clip_popped", clipId: clip.clipId });
          return;
        }
        case "clip_failed": {
          const id = clipOf(b)?.clipId ?? null;
          dispatch({ type: "clip_failed", clipId: id });
          const pending = stateRef.current.pending;
          if (id && pending && pending.clipId === id) {
            fail("FastH3 could not build the scene you picked.", null);
          }
          return;
        }
        case "command_error": {
          const command = typeof b.command === "string" ? b.command : "command";
          const reason = typeof b.reason === "string" ? b.reason.slice(0, 160) : "rejected";
          setCommandErrors((xs) => [{ command, reason, at: Date.now() }, ...xs].slice(0, 5));
          return;
        }
      }
    },
    [dispatch, fail],
  );

  /** Apply a QueueCommand list in order; pop replies update the queue view. */
  const runCommands = useCallback(
    async (cmds: QueueCommand[]) => {
      const s = sessionRef.current;
      if (!s) return;
      for (const c of cmds) {
        if (c.name === "move") await s.move(c.clipId, c.position);
        else if (c.name === "pop") {
          const reply = await s.pop(c.clipId);
          if (reply?.type === "clip_popped") dispatch({ type: "clip_popped", clipId: c.clipId });
        } else await s.play(c.clipId);
      }
    },
    [dispatch],
  );

  /** Enqueue the offered scenes as speculative branches continuing from `fromClipId`. */
  const enqueueBranches = useCallback(
    async (offer: Offer, fromClipId: string) => {
      const s = sessionRef.current;
      if (!s) return;
      for (const [index, branch] of offer.branches.entries()) {
        const clip = await s.enqueue({
          prompt: branch.scene.prompt,
          seconds: STORY_LIMITS.clipSeconds,
          metadata: meta(offer.beat, branch.scene.label),
          continueFromClipId: fromClipId,
        });
        if (clip) dispatch({ type: "clip_queued", clip, at: performance.now() });
        dispatch({ type: "branch_queued", beat: offer.beat, index, clipId: clip?.clipId ?? null });
      }
    },
    [dispatch],
  );

  const offerFrom = (res: StoryDirectorResponse, beat: number): Offer => ({
    beat,
    act: res.act,
    offerEnd: res.offerEnd,
    atCap: res.atCap,
    branches: res.choices.map((scene) => ({ scene, clipId: null, failed: false })),
  });

  /** Ask the director what could happen after the last played beat, and build the branches. */
  const requestNext = useCallback(async () => {
    const beats = stateRef.current.beats;
    const last = beats[beats.length - 1];
    if (!last) return;
    setChoiceError(null);
    if (beats.length >= STORY_LIMITS.maxBeats) {
      dispatch({
        type: "offer",
        offer: {
          beat: beats.length + 1,
          act: "failure",
          offerEnd: true,
          atCap: true,
          branches: [],
        },
      });
      return;
    }
    setDirectorBusy("next");
    try {
      const res = await askDirector(caseId, { kind: "next", beats: beats.map(toRecord) });
      if (!sessionRef.current) return;
      dispatch({ type: "director_ms", ms: res.latencyMs });
      const offer = offerFrom(res, beats.length + 1);
      dispatch({ type: "offer", offer });
      if (offer.branches.length > 0) await enqueueBranches(offer, last.clipId);
    } catch (err) {
      setChoiceError({ message: errorMessage(err), retry: () => void requestNext() });
    } finally {
      setDirectorBusy(null);
    }
  }, [caseId, dispatch, enqueueBranches]);

  const start = useCallback(async () => {
    if (phaseRef.current === "starting" || phaseRef.current === "live") return;
    if (!photoUrl) {
      fail("Add a product photo to the case first: the story opens from it.", null);
      return;
    }
    await teardown();
    stateRef.current = initialStoryState();
    setState(stateRef.current);
    setFatal(null);
    setChoiceError(null);
    setCommandErrors([]);
    setStartedAt(Date.now());
    setPhaseBoth("starting");
    setDirectorBusy("opening");
    const session = new FastH3Session({
      status: (s) => {
        setStatus(s);
        if (s === "disconnected" && sessionRef.current === session && phaseRef.current === "live") {
          fail("The Reactor session ended.", () => void start());
        }
      },
      message: onMessage,
      tracks: (ms) => setStream(ms),
      error: (code) => {
        if (phaseRef.current === "starting") return; // the awaited step reports it
        setCommandErrors((xs) =>
          [{ command: "session", reason: code, at: Date.now() }, ...xs].slice(0, 5),
        );
      },
    });
    sessionRef.current = session;
    try {
      const [token, opening, photo] = await Promise.all([
        getStoryToken(caseId),
        askDirector(caseId, { kind: "opening" }).finally(() => setDirectorBusy(null)),
        fetchPhoto(photoUrl),
      ]);
      dispatch({ type: "director_ms", ms: opening.latencyMs });
      if (!opening.scene || opening.choices.length === 0) throw new Error("director");
      await session.connect(token.jwt);
      if (sessionRef.current !== session) return;
      await session.configure(token.clipSeconds);
      const snapshot = await session.command("get_state");
      if (snapshot) onMessage(snapshot);
      setEffectiveSeconds(numberOf(snapshot?.body.clip_seconds) ?? token.clipSeconds);
      const frame = await session.uploadFile(photo);
      const clip = await session.enqueue({
        prompt: opening.scene.prompt,
        seconds: token.clipSeconds,
        metadata: meta(1, opening.scene.label),
        startingFrame: frame,
      });
      if (!clip) throw new Error("enqueue");
      const now = performance.now();
      dispatch({ type: "clip_queued", clip, at: now });
      dispatch({
        type: "picked",
        beat: { ...opening.scene, custom: false, clipId: clip.clipId, offered: [] },
        pending: {
          clipId: clip.clipId,
          pickedAt: now,
          wasReady: false,
          playSent: false,
          measure: false,
        },
      });
      setPhaseBoth("live");
      timers.current.push(
        window.setTimeout(() => void endRef.current?.("time"), token.sessionMaxSeconds * 1000),
      );
      const offer = offerFrom(opening, 2);
      dispatch({ type: "offer", offer });
      await enqueueBranches(offer, clip.clipId);
    } catch (err) {
      if (sessionRef.current !== session) return;
      const message =
        err instanceof Error && (err.message === "director" || err.message === "enqueue")
          ? "The story could not start: FastH3 or the director did not answer."
          : (reactorFailure(err) ?? errorMessage(err));
      fail(message, () => void start());
    }
  }, [caseId, photoUrl, dispatch, enqueueBranches, fail, onMessage, setPhaseBoth, teardown]);

  const pick = useCallback(
    async (index: number) => {
      const s = stateRef.current;
      const offer = s.offer;
      const branch = offer?.branches[index];
      if (!offer || !branch?.clipId || s.pending || directorBusy) return;
      const clipId = branch.clipId;
      const cmds = planPick(s, offer, clipId);
      dispatch({
        type: "picked",
        beat: {
          ...branch.scene,
          custom: false,
          clipId,
          offered: offer.branches.map((b) => b.scene.label),
        },
        pending: {
          clipId,
          pickedAt: performance.now(),
          wasReady: isReady(s, clipId),
          playSent: false,
          measure: true,
        },
      });
      await runCommands(cmds);
      await requestNext();
    },
    [directorBusy, dispatch, requestNext, runCommands],
  );

  const tellOwn = useCallback(
    async (text: string): Promise<boolean> => {
      const s = stateRef.current;
      const last = s.beats[s.beats.length - 1];
      const session = sessionRef.current;
      if (!last || !session || s.pending || directorBusy) return false;
      setChoiceError(null);
      setDirectorBusy("custom");
      let scene: StoryScene | null = null;
      try {
        const res = await askDirector(caseId, {
          kind: "custom",
          beats: s.beats.map(toRecord),
          text,
        });
        dispatch({ type: "director_ms", ms: res.latencyMs });
        scene = res.scene;
      } catch (err) {
        setChoiceError({ message: errorMessage(err), retry: null });
        setDirectorBusy(null);
        return false;
      }
      setDirectorBusy(null);
      if (!scene || !sessionRef.current) return false;
      const offer = stateRef.current.offer;
      const clip = await session.enqueue({
        prompt: scene.prompt,
        seconds: STORY_LIMITS.clipSeconds,
        metadata: meta(s.beats.length + 1, scene.label),
        position: 0,
        continueFromClipId: last.clipId,
      });
      if (!clip) {
        setChoiceError({ message: "FastH3 did not accept that scene. Try again.", retry: null });
        return false;
      }
      dispatch({ type: "clip_queued", clip, at: performance.now() });
      const pops = planCustom(stateRef.current, offer);
      dispatch({
        type: "picked",
        beat: {
          ...scene,
          custom: true,
          clipId: clip.clipId,
          offered: offer ? offer.branches.map((b) => b.scene.label) : [],
        },
        pending: {
          clipId: clip.clipId,
          pickedAt: performance.now(),
          wasReady: false,
          playSent: false,
          measure: true,
        },
      });
      await runCommands(pops);
      await requestNext();
      return true;
    },
    [caseId, directorBusy, dispatch, requestNext, runCommands],
  );

  const end = useCallback(
    async (_why: "user" | "time" | "hidden") => {
      if (phaseRef.current !== "live" && phaseRef.current !== "starting") return;
      setPhaseBoth("ended");
      onEndedRef.current?.(stateRef.current);
      await teardown();
    },
    [setPhaseBoth, teardown],
  );
  const endRef = useRef(end);
  endRef.current = end;

  // Play the picked scene as soon as it is built and the stage is free.
  useEffect(() => {
    const id = shouldPlayPending(state);
    const s = sessionRef.current;
    if (!id || !s) return;
    dispatch({ type: "play_sent" });
    void s.play(id);
  }, [state, dispatch]);

  // Tab hidden for long -> end the session (no reconnect loop); unmount -> disconnect.
  useEffect(() => {
    let hiddenTimer: number | null = null;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenTimer = window.setTimeout(
          () => void endRef.current("hidden"),
          STORY_LIMITS.hiddenDisconnectMs,
        );
      } else if (hiddenTimer !== null) {
        window.clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
    };
  }, []);

  useEffect(
    () => () => {
      phaseRef.current = "ended";
      void teardown();
    },
    [teardown],
  );

  const playingBeat = state.playingId
    ? (state.beats.find((b) => b.clipId === state.playingId) ?? null)
    : null;

  return {
    phase,
    status,
    state,
    stream,
    fatal,
    choiceError,
    directorBusy,
    commandErrors,
    effectiveSeconds,
    startedAt,
    playingBeat,
    start,
    pick,
    tellOwn,
    end,
    /** P1 hook: called once with the final state when the story ends. */
    onEndedRef,
  };
}
