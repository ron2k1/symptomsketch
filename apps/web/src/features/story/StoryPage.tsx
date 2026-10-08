import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, LoaderCircle, Volume2, VolumeX } from "lucide-react";
import {
  APP_PATHS,
  STORY_ACT_LABELS,
  STORY_LIMITS,
  type CaseDetail,
} from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, getCase } from "@/lib/api";
import { useDocumentTitle } from "@/lib/document-title";
import { cn } from "@/lib/utils";
import { ReactorQueueStrip, StoryTimeline } from "./StoryPanels";
import { branchReadiness, isReady, shortClipId, type StoryState } from "./story-state";
import { StorySendPanel } from "./StorySendPanel";
import { useStory } from "./useStory";
import { useStoryRecorder } from "./useStoryRecorder";

const READINESS_COPY = {
  ready: "Ready",
  building: "Building",
  queued: "Queued",
  sending: "Sending to Reactor",
  failed: "Could not build",
} as const;

const READINESS_CLASS = {
  ready: "text-success",
  building: "text-warning",
  queued: "text-muted-foreground",
  sending: "text-muted-foreground",
  failed: "text-destructive",
} as const;

/** Route "/cases/:caseId/story". */
export function StoryPage() {
  const { caseId = "" } = useParams();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useDocumentTitle("Story mode", caseData?.title);

  useEffect(() => {
    const ac = new AbortController();
    getCase(caseId, { signal: ac.signal })
      .then((r) => setCaseData(r.case))
      .catch((err) => {
        if (!ac.signal.aborted) setLoadError(errorMessage(err));
      });
    return () => ac.abort();
  }, [caseId]);

  return (
    <div className="cyber-grid min-h-screen overflow-x-clip">
      <header className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 pt-5 md:px-6">
        <Link
          to={APP_PATHS.caseTab(caseId, "issue")}
          className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to the case
        </Link>
        <div className="text-right">
          <h1 className="text-lg font-semibold">
            Story mode · <span className="font-reactor">MiniMax FastH3 on Reactor</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            AI reenactment of what you described, with generated sound. Not a recording.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-5 md:px-6">
        {loadError ? (
          <p
            role="alert"
            className="rounded-[var(--radius-card)] border border-border bg-card p-6 text-sm"
          >
            {loadError}
          </p>
        ) : !caseData ? (
          <p className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Opening your case
          </p>
        ) : (
          <StoryWorkspace caseId={caseId} caseData={caseData} />
        )}
      </main>
    </div>
  );
}

function StoryWorkspace({ caseId, caseData }: { caseId: string; caseData: CaseDetail }) {
  const photoUrl = caseData.product?.normalized.mediaUrl ?? null;
  const story = useStory(caseId, photoUrl);
  const recorder = useStoryRecorder(story.stream, story.state.playingId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const { phase, state } = story;

  story.onEndedRef.current = () => recorder.finish(videoRef.current);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== story.stream) v.srcObject = story.stream;
    if (story.stream) void v.play().catch(() => undefined);
  }, [story.stream]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const onStart = () => {
    // The click is the user gesture that lets the story play with sound.
    setMuted(false);
    if (videoRef.current) videoRef.current.muted = false;
    void story.start();
  };

  const onRetry = () => {
    // The retry opens a new session with a new stream; the failed attempt's recorder is bound to
    // the closed one and would keep the new session from being recorded at all.
    recorder.reset();
    story.fatal?.retry?.();
  };

  const caption =
    story.playingBeat?.caption ??
    (phase === "starting"
      ? story.directorBusy === "opening"
        ? "The director is writing your opening scene."
        : "FastH3 is building the opening scene from your product photo."
      : phase === "live" && state.pending
        ? isReady(state, state.pending.clipId)
          ? "Up next."
          : "Building your choice."
        : (state.beats[state.beats.length - 1]?.caption ?? ""));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <div className="relative overflow-hidden rounded-[var(--radius-card)] border-4 border-sand bg-foreground">
          <video
            ref={videoRef}
            className="aspect-video w-full bg-foreground object-contain"
            playsInline
            autoPlay
            aria-label="Story stage: live FastH3 video with sound"
          />
          {phase === "idle" || phase === "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-foreground/80 p-6 text-center text-background">
              {phase === "error" && story.fatal ? (
                <p role="alert" className="max-w-md text-sm">
                  {story.fatal.message}
                </p>
              ) : (
                <p className="max-w-md text-sm">
                  Tell what your {caseData.title.toLowerCase()} did as a short story with sound. It
                  opens from your own photo; after each scene you choose what happened next.
                </p>
              )}
              {phase === "idle" ? (
                <Button
                  type="button"
                  size="lg"
                  className="min-h-11"
                  onClick={onStart}
                  disabled={!photoUrl}
                >
                  Start the story
                </Button>
              ) : story.fatal?.retry ? (
                <Button type="button" size="lg" className="min-h-11" onClick={onRetry}>
                  Retry
                </Button>
              ) : null}
              {!photoUrl ? <p className="text-xs">Add a product photo to the case first.</p> : null}
            </div>
          ) : null}
          {phase === "live" || phase === "starting" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="absolute right-3 top-3 min-h-9"
              onClick={() => setMuted((m) => !m)}
              aria-pressed={muted}
              aria-label={muted ? "Unmute story sound" : "Mute story sound"}
            >
              {muted ? (
                <VolumeX className="size-4" aria-hidden />
              ) : (
                <Volume2 className="size-4" aria-hidden />
              )}
            </Button>
          ) : null}
        </div>
        <p aria-live="polite" className="min-h-6 text-base font-medium" data-testid="story-caption">
          {caption}
        </p>
        {phase === "live" ? <ChoicePanel story={story} state={state} /> : null}
        {phase === "ended" ? (
          <StorySendPanel
            caseId={caseId}
            beats={state.beats}
            recorder={recorder}
            clipSeconds={story.effectiveSeconds ?? STORY_LIMITS.clipSeconds}
          />
        ) : null}
      </div>
      <aside className="space-y-4">
        <StoryTimeline state={state} />
        <ReactorQueueStrip
          state={state}
          commandErrors={story.commandErrors}
          effectiveSeconds={story.effectiveSeconds}
        />
        <p className="font-reactor text-[11px] text-muted-foreground">
          session {story.status} · {state.beats.length}/{STORY_LIMITS.maxBeats} scenes
          {recorder.recording ? " · recording" : ""}
        </p>
      </aside>
    </div>
  );
}

function ChoicePanel({ story, state }: { story: ReturnType<typeof useStory>; state: StoryState }) {
  const [text, setText] = useState("");
  const offer = state.offer;
  const busy = story.directorBusy !== null || state.pending !== null;
  const canEnd =
    offer?.offerEnd || offer?.atCap || state.beats.length >= STORY_LIMITS.endOfferAfterBeats;

  const onCustom = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (t.length < 3) return;
    if (await story.tellOwn(t)) setText("");
  };

  return (
    <section
      aria-labelledby="story-choices-title"
      className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="story-choices-title" className="text-sm font-semibold">
          {offer && !offer.atCap
            ? `What happened next? Scene ${offer.beat} · ${STORY_ACT_LABELS[offer.act]}`
            : offer?.atCap
              ? "That is the longest a story can be"
              : "What happened next?"}
        </h2>
        {story.directorBusy === "next" || story.directorBusy === "custom" ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            The director is writing
          </span>
        ) : null}
      </div>
      {story.choiceError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          {story.choiceError.message}
          {story.choiceError.retry ? (
            <Button type="button" size="sm" variant="outline" onClick={story.choiceError.retry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {offer && offer.branches.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-3">
          {offer.branches.map((b, i) => {
            const r = branchReadiness(state, b);
            return (
              <li key={`${offer.beat}-${i}`}>
                <button
                  type="button"
                  disabled={busy || !b.clipId || r === "failed"}
                  onClick={() => void story.pick(i)}
                  className={cn(
                    "flex h-full min-h-24 w-full flex-col justify-between gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 text-left transition-colors",
                    "hover:border-primary focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  <span className="text-sm font-medium">{b.scene.label}</span>
                  <span className="flex items-center justify-between gap-2 text-[11px]">
                    <span className={cn("font-medium", READINESS_CLASS[r])}>
                      {READINESS_COPY[r]}
                    </span>
                    {b.clipId ? (
                      <span className="font-reactor text-muted-foreground">
                        {shortClipId(b.clipId)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {!offer?.atCap ? (
        <form onSubmit={onCustom} className="space-y-2">
          <label htmlFor="story-own-words" className="text-xs text-muted-foreground">
            Something else happened? Say it in your words.
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Textarea
              id="story-own-words"
              value={text}
              maxLength={STORY_LIMITS.freeTextMaxChars}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              className="min-h-11 flex-1"
            />
            <Button
              type="submit"
              variant="outline"
              className="min-h-11"
              disabled={busy || text.trim().length < 3}
            >
              Show this instead
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {canEnd ? (
          <Button type="button" className="min-h-11" onClick={() => void story.end("user")}>
            That&apos;s what happened
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void story.end("user")}
        >
          End story
        </Button>
      </div>
    </section>
  );
}
