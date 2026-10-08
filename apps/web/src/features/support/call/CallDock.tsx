import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  PictureInPicture2,
  RotateCcw,
  X,
} from "lucide-react";
import { SUPPORT_CALL_AGENT_NAME, SUPPORT_CALL_PHASE_LABELS } from "@symptomsketch/contracts";
import { cn } from "@/lib/utils";
import {
  DOCK_MARGIN_PX,
  DOCK_WIDTH_PX,
  clampDockPosition,
  dockPlacement,
  formatCallTimer,
  latestCaption,
  type Point,
} from "./call-model";
import { useSupportCall } from "./CallProvider";
import { openDocumentPip, pipSupport } from "./pip";
import { SamVideo } from "./SamVideo";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const sizeOf = (el: HTMLElement | null) => {
  const r = el?.getBoundingClientRect();
  return { width: r?.width ?? DOCK_WIDTH_PX, height: r?.height ?? 0 };
};

const dockButton =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-reactor-line px-2.5 text-xs font-medium text-reactor-ink-foreground transition-colors hover:bg-reactor-ink-foreground/10 focus-visible:outline-2 focus-visible:outline-reactor-signal disabled:opacity-50 [&_svg]:size-3.5";
const iconButton =
  "inline-flex size-8 items-center justify-center rounded-md text-reactor-ink-foreground/80 hover:bg-reactor-ink-foreground/10 hover:text-reactor-ink-foreground focus-visible:outline-2 focus-visible:outline-reactor-signal [&_svg]:size-4";

/** Pointer-drag on a handle, kept inside the viewport (buttons inside the handle still click). */
function useDockDrag(dockRef: RefObject<HTMLDivElement | null>) {
  const [pos, setPos] = useState<Point | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const clampNow = () =>
    setPos((p) => (p ? clampDockPosition(p, sizeOf(dockRef.current), viewport()) : p));

  useEffect(() => {
    window.addEventListener("resize", clampNow);
    return () => window.removeEventListener("resize", clampNow);
  });

  const handlers = {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (e.button !== 0 || (e.target as Element).closest("button")) return;
      const rect = dockRef.current?.getBoundingClientRect();
      if (!rect) return;
      grab.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const g = grab.current;
      if (!g) return;
      setPos(
        clampDockPosition(
          { x: e.clientX - g.dx, y: e.clientY - g.dy },
          sizeOf(dockRef.current),
          viewport(),
        ),
      );
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      grab.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    },
  };
  return { pos, handlers, clampNow };
}

interface DockBodyProps {
  inPip: boolean;
  canPopOut: boolean;
  notice: string | null;
  videoRef?: Ref<HTMLVideoElement>;
  header: ReactNode;
  onPopOut(): void;
}

/** Video, latest caption and call controls: the same live elements in the page or the PiP window. */
function DockBody({ inPip, canPopOut, notice, videoRef, header, onPopOut }: DockBodyProps) {
  const call = useSupportCall();
  const { view } = call;
  const caption = latestCaption(view.transcript);
  const live = view.phase === "live";
  const failed = view.phase === "ended" && view.error !== null;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-reactor-ink text-reactor-ink-foreground",
        inPip
          ? "h-screen w-screen"
          : "rounded-xl border border-reactor-line shadow-[var(--reactor-glow)]",
      )}
    >
      {header}
      {failed ? (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <p role="alert" className="text-sm">
            {view.error}
          </p>
          <div className="flex gap-2">
            <button type="button" className={dockButton} onClick={call.retry}>
              <RotateCcw aria-hidden />
              Retry
            </button>
            <button type="button" className={dockButton} onClick={call.dismissError}>
              <X aria-hidden />
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            className={cn(
              "relative w-full overflow-hidden bg-reactor-ink",
              inPip ? "min-h-0 flex-1" : "aspect-[3/4]",
            )}
          >
            <SamVideo media={view.media} videoRef={videoRef} />
            {!view.hasVideo ? (
              <p
                role="status"
                className="absolute inset-0 flex items-center justify-center px-4 text-center font-reactor text-xs uppercase tracking-[0.14em] text-reactor-ink-foreground/80"
              >
                {view.detail ?? SUPPORT_CALL_PHASE_LABELS[view.phase]}
              </p>
            ) : null}
          </div>
          <p
            data-dock-caption=""
            title={caption?.text}
            className={cn(
              "min-h-9 truncate border-t border-reactor-line/40 px-3 py-2 text-sm",
              caption?.interim && "italic text-reactor-ink-foreground/80",
            )}
          >
            {caption ? (
              <>
                <span className="font-medium text-reactor-signal">
                  {caption.speaker === "character" ? SUPPORT_CALL_AGENT_NAME : "You"}:
                </span>{" "}
                {caption.text}
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-2 px-3 pb-3">
            <button
              type="button"
              className={cn(dockButton, view.micOn && "border-reactor-signal")}
              aria-pressed={view.micOn}
              disabled={!live}
              onClick={call.toggleMic}
            >
              {view.micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
              {view.micOn ? "Mic on" : "Mic off"}
            </button>
            <button
              type="button"
              className={cn(
                dockButton,
                "border-destructive bg-destructive text-primary-foreground",
              )}
              onClick={call.end}
            >
              <PhoneOff aria-hidden />
              End call
            </button>
            {canPopOut && !inPip ? (
              <button type="button" className={dockButton} onClick={onPopOut}>
                <PictureInPicture2 aria-hidden />
                Pop out
              </button>
            ) : null}
          </div>
          {view.micNotice || notice ? (
            <p className="px-3 pb-3 text-xs text-reactor-ink-foreground/80">
              {view.micNotice ?? notice}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The floating call dock, mounted once at the app root: while a call runs and the full call view is
 * not on screen, Sam's live video, the latest real caption and the call controls follow the user
 * across routes. Draggable by its header, collapsible to a pill, and poppable into an always-on-top
 * Document Picture-in-Picture window (video PiP fallback; hidden when neither exists).
 */
export function CallDock() {
  const call = useSupportCall();
  const navigate = useNavigate();
  const [pipWin, setPipWin] = useState<Window | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const support = useMemo(() => pipSupport(), []);
  const dockRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { pos, handlers, clampNow } = useDockDrag(dockRef);
  const placement = dockPlacement({
    phase: call.view.phase,
    error: call.view.error,
    errorDismissed: call.errorDismissed,
    fullViewOpen: call.fullViewOpen,
    pipOpen: pipWin !== null,
  });

  useEffect(() => {
    if (!pipWin) return;
    const onClose = () => setPipWin(null);
    pipWin.addEventListener("pagehide", onClose);
    return () => pipWin.removeEventListener("pagehide", onClose);
  }, [pipWin]);
  useEffect(() => {
    if (pipWin && placement === "hidden") pipWin.close();
  }, [pipWin, placement]);
  useEffect(() => () => pipWin?.close(), [pipWin]);
  // A pill and a card differ in size: keep whichever is shown inside the viewport.
  useLayoutEffect(clampNow, [minimized, placement]);

  if (placement === "hidden") return null;

  async function popOut() {
    setNotice(null);
    try {
      if (support === "document") setPipWin(await openDocumentPip());
      else if (support === "video") await videoRef.current?.requestPictureInPicture();
    } catch {
      setNotice("Pop out is not available in this window.");
    }
  }

  function expand() {
    if (pipWin) {
      pipWin.close();
      window.focus();
    }
    setMinimized(false);
    if (call.returnPath) void navigate(call.returnPath);
  }

  const live = call.view.phase === "live";
  const status = (
    <span className="font-semibold uppercase tracking-[0.14em]">
      {SUPPORT_CALL_AGENT_NAME} ·{" "}
      {live ? (
        <time className="tabular-nums" data-dock-timer="">
          {formatCallTimer(call.view.elapsedSeconds)}
        </time>
      ) : (
        SUPPORT_CALL_PHASE_LABELS[call.view.phase]
      )}
    </span>
  );
  const dot = (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        live ? "bg-reactor-signal motion-safe:animate-pulse" : "bg-reactor-ink-foreground/50",
      )}
    />
  );
  const expandButton = (
    <button
      type="button"
      className={iconButton}
      aria-label="Expand to the full call view"
      title="Expand"
      onClick={expand}
    >
      <Maximize2 aria-hidden />
    </button>
  );

  if (placement === "pip" && pipWin) {
    return createPortal(
      <DockBody
        inPip
        canPopOut={false}
        notice={notice}
        onPopOut={() => undefined}
        header={
          <div className="flex items-center gap-2 px-3 py-2 font-reactor text-xs">
            {dot}
            {status}
            <span className="ml-auto">{expandButton}</span>
          </div>
        }
      />,
      pipWin.document.body,
    );
  }

  const style = pos
    ? { left: pos.x, top: pos.y }
    : { right: DOCK_MARGIN_PX, bottom: DOCK_MARGIN_PX };

  return (
    <div
      ref={dockRef}
      role="region"
      aria-label={`Live call with ${SUPPORT_CALL_AGENT_NAME}`}
      data-call-dock={minimized ? "pill" : "card"}
      className="fixed z-50 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
      style={{ ...style, width: minimized ? undefined : DOCK_WIDTH_PX }}
    >
      {minimized ? (
        <div
          {...handlers}
          className="flex cursor-grab touch-none items-center gap-2 rounded-full border border-reactor-line bg-reactor-ink py-1 pr-1 pl-3 font-reactor text-xs text-reactor-ink-foreground shadow-[var(--reactor-glow)] select-none active:cursor-grabbing"
        >
          {dot}
          {status}
          <button
            type="button"
            className={iconButton}
            aria-label="Show the call dock"
            title="Show"
            onClick={() => setMinimized(false)}
          >
            <Maximize2 aria-hidden />
          </button>
        </div>
      ) : (
        <DockBody
          inPip={false}
          canPopOut={support !== "none"}
          notice={notice}
          videoRef={videoRef}
          onPopOut={() => void popOut()}
          header={
            <div
              {...handlers}
              data-dock-handle=""
              className="flex cursor-grab touch-none items-center gap-2 py-1 pr-1 pl-3 font-reactor text-xs select-none active:cursor-grabbing"
            >
              {dot}
              {status}
              <span className="ml-auto flex">
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Minimize the call dock"
                  title="Minimize"
                  onClick={() => setMinimized(true)}
                >
                  <Minimize2 aria-hidden />
                </button>
                {expandButton}
              </span>
            </div>
          }
        />
      )}
    </div>
  );
}
