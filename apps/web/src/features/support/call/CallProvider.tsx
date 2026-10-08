import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { saveSupportCallTranscript } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/ids";
import type { SupportCallController } from "../support-call-controller";
import { INITIAL_CALL_VIEW, type CallEnded, type CallView } from "../support-call-model";
import { samVolume } from "./call-model";

export type SaveState = "idle" | "saving" | "saved" | "failed";
type EndedListener = (ticketId: string, ended: CallEnded) => void;

export interface SupportCallContextValue {
  view: CallView;
  /** Ticket the current (or last) call is about; null before the first call. */
  ticketId: string | null;
  /** In-app path of the full call view the call was started from (Expand goes back there). */
  returnPath: string | null;
  saveState: SaveState;
  errorDismissed: boolean;
  /** True while the Support tab shows this call's full view (the dock then hides). */
  fullViewOpen: boolean;
  /** Story clip ducking: Sam plays at ~20% while at least one clip is playing. */
  ducking: boolean;
  start(ticketId: string): void;
  retry(): void;
  end(): void;
  toggleMic(): void;
  interrupt(): void;
  say(text: string): Promise<boolean>;
  dismissError(): void;
  /** Mark the full call view as on screen; returns the unregister function. */
  registerFullView(): () => void;
  /** Called with the ticket id after each ended call whose transcript save settled. */
  onEnded(listener: EndedListener): () => void;
  /** Duck Sam's audio until the returned release function runs. */
  duck(): () => void;
}

const SupportCallContext = createContext<SupportCallContextValue | null>(null);

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * One live AI support call for the whole app, above the router's pages, so the Reactor session,
 * Sam's media stream and the transcript survive route changes. Plays Sam's audio once (a single
 * hidden <audio>); every on-screen <video> (full view, dock, PiP) is muted and shows the video.
 * Billing runs while the session is open: page hide ends and disconnects the call.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<CallView>(INITIAL_CALL_VIEW);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [returnPath, setReturnPath] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [fullViews, setFullViews] = useState(0);
  const [duckCount, setDuckCount] = useState(0);
  const controllerRef = useRef<SupportCallController | null>(null);
  const loadingRef = useRef<Promise<SupportCallController> | null>(null);
  const ticketRef = useRef<string | null>(null);
  const listeners = useRef(new Set<EndedListener>());
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleEnded = useCallback((ended: CallEnded) => {
    const id = ticketRef.current;
    if (!id) return;
    setSaveState("saving");
    // One key per finished call: a retried POST of the same call returns the same record.
    saveSupportCallTranscript(id, { ...ended, idempotencyKey: newIdempotencyKey() })
      .then(
        () => setSaveState("saved"),
        () => setSaveState("failed"),
      )
      .finally(() => {
        for (const listener of [...listeners.current]) listener(id, ended);
      });
  }, []);

  // The SDK (WebRTC + wasm) loads on the first call, not with the landing page.
  const controller = useCallback((): Promise<SupportCallController> => {
    if (controllerRef.current) return Promise.resolve(controllerRef.current);
    loadingRef.current ??= import("../support-call-controller").then(
      ({ SupportCallController: Controller }) => {
        controllerRef.current ??= new Controller(setView, handleEnded);
        return controllerRef.current;
      },
    );
    return loadingRef.current;
  }, [handleEnded]);

  const start = useCallback(
    (id: string) => {
      if (controllerRef.current?.busy) return;
      ticketRef.current = id;
      setTicketId(id);
      setReturnPath(currentPath());
      setSaveState("idle");
      setErrorDismissed(false);
      void controller().then((c) => c.start(id));
    },
    [controller],
  );

  const registerFullView = useCallback(() => {
    setFullViews((n) => n + 1);
    return () => setFullViews((n) => n - 1);
  }, []);

  const onEnded = useCallback((listener: EndedListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const duck = useCallback(() => {
    let released = false;
    setDuckCount((n) => n + 1);
    return () => {
      if (released) return;
      released = true;
      setDuckCount((n) => n - 1);
    };
  }, []);

  useEffect(() => {
    const onPageHide = () => controllerRef.current?.dispose();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      controllerRef.current?.dispose();
    };
  }, []);

  // Sam's voice: one element for the whole app, so moving between views never doubles or drops it.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.srcObject !== view.media) audio.srcObject = view.media;
    if (view.media) void audio.play?.()?.catch(() => undefined);
  }, [view.media]);

  const volume = samVolume(duckCount);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume, view.media]);

  const value = useMemo<SupportCallContextValue>(
    () => ({
      view,
      ticketId,
      returnPath,
      saveState,
      errorDismissed,
      fullViewOpen: fullViews > 0,
      ducking: duckCount > 0,
      start,
      retry: () => {
        if (ticketRef.current) start(ticketRef.current);
      },
      end: () => void controllerRef.current?.end(),
      toggleMic: () => void controllerRef.current?.toggleMic(),
      interrupt: () => void controllerRef.current?.interrupt(),
      say: async (text) => (await controllerRef.current?.say(text)) ?? false,
      dismissError: () => setErrorDismissed(true),
      registerFullView,
      onEnded,
      duck,
    }),
    [
      view,
      ticketId,
      returnPath,
      saveState,
      errorDismissed,
      fullViews,
      duckCount,
      start,
      registerFullView,
      onEnded,
      duck,
    ],
  );

  return (
    <SupportCallContext.Provider value={value}>
      {children}
      <audio ref={audioRef} autoPlay hidden data-sam-audio="" />
    </SupportCallContext.Provider>
  );
}

export function useSupportCall(): SupportCallContextValue {
  const ctx = useContext(SupportCallContext);
  if (!ctx) throw new Error("useSupportCall must be used inside <CallProvider>");
  return ctx;
}

/**
 * For the story player: lower Sam to ~20% while `playing` is true, restore after. Safe to call
 * when no call is running (it only changes the volume of a live call).
 */
export function useDuckSamWhile(playing: boolean): void {
  const ctx = useContext(SupportCallContext);
  const duck = ctx?.duck;
  useEffect(() => {
    if (!playing || !duck) return;
    return duck();
  }, [playing, duck]);
}
