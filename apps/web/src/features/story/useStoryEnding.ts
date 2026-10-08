// Story mode P2, staff side: support "writes the ending". One live Gemini call turns support's fix
// into 1-2 scenes; a NEW FastH3 session opens from the story's last frame and plays them in order.
// Live only: any failure shows an honest error with Retry, never a substitute.
import { useCallback, useEffect, useRef, useState } from "react";
import type { StoryScene } from "@symptomsketch/contracts";
import { errorMessage } from "@/lib/api";
import {
  EndingLaunchError,
  endingComplete,
  endingReducer,
  failedScene,
  initialEndingState,
  launchEnding,
  nextEndingClip,
  playingScene,
  type EndingEvent,
  type EndingState,
} from "./ending-state";
import { FastH3Session, clipList, clipOf, type FastH3Message, type FastH3Status } from "./fast-h3";
import { fetchMedia, getEndingToken, writeEnding } from "./story-api";

/** After the last scene finishes: let the held frame reach the screen and the recorder. */
const ENDING_TAIL_MS = 1200;

export type EndingPhase = "idle" | "preparing" | "building" | "playing" | "done" | "error";

export interface EndingNotice {
  message: string;
  retry: (() => void) | null;
}

export interface EndingTimings {
  /** Gemini latency reported by the server. */
  directorMs: number | null;
  /** Click to the first ending scene on stage (clip_started). */
  firstPlayMs: number | null;
}

export function useStoryEnding(ticketId: string, frameUrl: string | null) {
  const [phase, setPhase] = useState<EndingPhase>("idle");
  const [status, setStatus] = useState<FastH3Status>("disconnected");
  const [scenes, setScenes] = useState<StoryScene[] | null>(null);
  const [state, setState] = useState<EndingState>(initialEndingState);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<EndingNotice | null>(null);
  const [timings, setTimings] = useState<EndingTimings>({ directorMs: null, firstPlayMs: null });

  const stateRef = useRef<EndingState>(state);
  const phaseRef = useRef<EndingPhase>("idle");
  const sessionRef = useRef<FastH3Session | null>(null);
  const expectedRef = useRef(0);
  const textRef = useRef("");
  const clickedAt = useRef(0);
  const timers = useRef<number[]>([]);
  const startRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  /** Called once when the ending has played, before the session closes (recorder.finish). */
  const onDoneRef = useRef<(() => void) | null>(null);

  const dispatch = useCallback((e: EndingEvent) => {
    const next = endingReducer(stateRef.current, e);
    stateRef.current = next;
    setState(next);
  }, []);

  const setPhaseBoth = useCallback((p: EndingPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const teardown = useCallback(async () => {
    for (const t of timers.current.splice(0)) window.clearTimeout(t);
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s) await s.disconnect();
    setStatus("disconnected");
  }, []);

  const fail = useCallback(
    (message: string, text: string) => {
      if (phaseRef.current === "done" || phaseRef.current === "idle") return;
      void teardown();
      setError({ message, retry: () => void startRef.current(text) });
      setPhaseBoth("error");
    },
    [teardown, setPhaseBoth],
  );

  const onMessage = useCallback(
    (m: FastH3Message) => {
      const b = m.body;
      switch (m.type) {
        case "clip_generated": {
          const id = clipOf(b)?.clipId;
          if (id) dispatch({ type: "ready", clipIds: [id], at: performance.now() });
          return;
        }
        case "queue_update":
          dispatch({
            type: "ready",
            clipIds: clipList(b.playout).map((c) => c.clipId),
            at: performance.now(),
          });
          return;
        case "clip_started": {
          const id = clipOf(b)?.clipId;
          if (!id || !stateRef.current.clips.some((c) => c.clipId === id)) return;
          dispatch({ type: "started", clipId: id });
          if (phaseRef.current === "building") {
            setTimings((t) => ({ ...t, firstPlayMs: Date.now() - clickedAt.current }));
            setPhaseBoth("playing");
          }
          return;
        }
        case "clip_finished":
        case "clip_stopped":
          dispatch({ type: "finished", clipId: clipOf(b)?.clipId ?? null });
          return;
        case "clip_failed":
          dispatch({ type: "failed", clipId: clipOf(b)?.clipId ?? null });
          return;
      }
    },
    [dispatch, setPhaseBoth],
  );

  const start = useCallback(
    async (text: string) => {
      const busy = ["preparing", "building", "playing"].includes(phaseRef.current);
      if (busy || !frameUrl) return;
      await teardown();
      stateRef.current = initialEndingState();
      setState(stateRef.current);
      setScenes(null);
      setStream(null);
      setError(null);
      setTimings({ directorMs: null, firstPlayMs: null });
      expectedRef.current = 0;
      textRef.current = text;
      clickedAt.current = Date.now();
      setPhaseBoth("preparing");
      const session = new FastH3Session({
        status: (s) => {
          setStatus(s);
          const live = phaseRef.current === "building" || phaseRef.current === "playing";
          if (s === "disconnected" && sessionRef.current === session && live) {
            fail("The Reactor session ended before the ending finished.", text);
          }
        },
        message: onMessage,
        tracks: (ms) => setStream(ms),
      });
      sessionRef.current = session;
      try {
        const { token } = await launchEnding(
          {
            write: () => writeEnding(ticketId, { text }),
            token: () => getEndingToken(ticketId),
            frame: () => fetchMedia(frameUrl, "Could not load the story's last frame."),
          },
          session,
          {
            scenes: (r) => {
              if (sessionRef.current !== session) return;
              expectedRef.current = r.scenes.length;
              setScenes(r.scenes);
              setTimings((t) => ({ ...t, directorMs: r.latencyMs }));
            },
            queued: (clipId, scene) => {
              if (sessionRef.current !== session) return;
              if (phaseRef.current === "preparing") setPhaseBoth("building");
              dispatch({ type: "queued", clipId, scene, at: performance.now() });
            },
          },
        );
        if (sessionRef.current !== session) return;
        timers.current.push(
          window.setTimeout(
            () => fail("The FastH3 session reached its time limit.", text),
            token.sessionMaxSeconds * 1000,
          ),
        );
      } catch (err) {
        if (sessionRef.current !== session) return;
        fail(
          err instanceof EndingLaunchError
            ? "FastH3 did not accept the ending scenes."
            : errorMessage(err),
          text,
        );
      }
    },
    [ticketId, frameUrl, dispatch, fail, onMessage, setPhaseBoth, teardown],
  );
  startRef.current = start;

  /** Stop before the ending finishes: close the session and go back to the form. */
  const cancel = useCallback(async () => {
    setPhaseBoth("idle");
    await teardown();
  }, [setPhaseBoth, teardown]);

  const reset = useCallback(() => {
    if (phaseRef.current !== "done" && phaseRef.current !== "error") return;
    setPhaseBoth("idle");
  }, [setPhaseBoth]);

  // Play each scene in order as soon as FastH3 reports it built and the stage is free.
  useEffect(() => {
    const id = nextEndingClip(state);
    const s = sessionRef.current;
    if (!id || !s) return;
    dispatch({ type: "play_sent", clipId: id });
    void s.play(id);
  }, [state, dispatch]);

  // A failed scene or the whole ending played: settle the run once.
  useEffect(() => {
    const p = phaseRef.current;
    if (p !== "building" && p !== "playing") return;
    const failed = failedScene(state);
    if (failed !== null) {
      fail(`FastH3 could not build scene ${failed} of the ending.`, textRef.current);
      return;
    }
    if (!endingComplete(state, expectedRef.current)) return;
    setPhaseBoth("done");
    timers.current.push(
      window.setTimeout(() => {
        onDoneRef.current?.();
        void teardown();
      }, ENDING_TAIL_MS),
    );
  }, [state, fail, setPhaseBoth, teardown]);

  useEffect(
    () => () => {
      phaseRef.current = "idle";
      void teardown();
    },
    [teardown],
  );

  return {
    phase,
    status,
    scenes,
    state,
    stream,
    error,
    timings,
    playing: playingScene(state),
    start,
    cancel,
    reset,
    onDoneRef,
  };
}

export type StoryEnding = ReturnType<typeof useStoryEnding>;
