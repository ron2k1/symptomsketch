import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, WandSparkles } from "lucide-react";
import { STORY_LIMITS } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useStoryEnding, type StoryEnding } from "./useStoryEnding";
import { useStoryRecorder } from "./useStoryRecorder";

const sec = (ms: number | null) => (ms === null ? null : `${(ms / 1000).toFixed(1)} s`);

function statusLine(e: StoryEnding): string | null {
  switch (e.phase) {
    case "preparing":
      return e.scenes ? "Connecting to FastH3." : "Gemini is writing the ending from your fix.";
    case "building":
      return e.state.clips.length > 1
        ? "FastH3 is building the ending from the story's last frame."
        : "FastH3 is building scene 1 from the story's last frame.";
    case "playing":
      return e.playing ? `Scene ${e.playing.index + 1} of ${e.state.clips.length}` : "Up next.";
    default:
      return null;
  }
}

/**
 * Staff only (support routes): "Write the ending". Support describes the fix; Gemini writes 1-2
 * scenes; a new MiniMax FastH3 session plays them starting from the last frame of the customer's
 * story, with generated sound. The ending is recorded in this browser so it can be watched again.
 */
export function StoryEndingPanel({ ticketId, frameUrl }: { ticketId: string; frameUrl: string }) {
  const ending = useStoryEnding(ticketId, frameUrl);
  const recorder = useStoryRecorder(ending.stream, ending.state.playingId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [text, setText] = useState("");
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  const { phase } = ending;
  const running = phase === "preparing" || phase === "building" || phase === "playing";

  ending.onDoneRef.current = () => recorder.finish(videoRef.current);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== ending.stream) v.srcObject = ending.stream;
    if (ending.stream) void v.play().catch(() => undefined);
  }, [ending.stream]);

  const reel = recorder.result?.reel ?? null;
  useEffect(() => {
    if (!reel) return;
    const url = URL.createObjectURL(reel);
    setReplayUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reel]);

  /** Every run (first click or Retry) opens a new session, so it records from a fresh recorder. */
  const beginRun = () => {
    recorder.reset();
    setReplayUrl(null);
    // The click is the user gesture that lets the ending play with sound.
    if (videoRef.current) videoRef.current.muted = false;
  };

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    if (running || text.trim().length < 3) return;
    beginRun();
    void ending.start(text.trim());
  };

  const onRetry = () => {
    beginRun();
    ending.error?.retry?.();
  };

  const status = statusLine(ending);
  const directorS = sec(ending.timings.directorMs);
  const firstS = sec(ending.timings.firstPlayMs);
  const showStage = running || phase === "done";

  return (
    <section aria-labelledby="story-ending-title" className="space-y-3 border-t border-border pt-3">
      <div className="space-y-1">
        <h3 id="story-ending-title" className="hud-label">
          Write the ending
        </h3>
        <p className="text-xs text-muted-foreground">
          Describe the fix in your own words. Gemini turns it into one or two scenes, and{" "}
          <span className="font-reactor">MiniMax FastH3</span> plays them from the last frame of the
          customer&apos;s story, with sound.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-2">
        <label htmlFor="story-ending-text" className="text-xs font-medium">
          How to fix it
        </label>
        <Textarea
          id="story-ending-text"
          value={text}
          maxLength={STORY_LIMITS.endingTextMaxChars}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          disabled={running}
          className="min-h-11"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {text.length}/{STORY_LIMITS.endingTextMaxChars}
          </span>
          <div className="flex gap-2">
            {running ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => void ending.cancel()}
              >
                Cancel
              </Button>
            ) : null}
            <Button type="submit" className="min-h-11" disabled={running || text.trim().length < 3}>
              {running ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <WandSparkles className="size-4" aria-hidden />
              )}
              {phase === "done" ? "Write another ending" : "Write the ending"}
            </Button>
          </div>
        </div>
      </form>

      {phase === "error" && ending.error ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{ending.error.message}</p>
          {ending.error.retry ? (
            <Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <div hidden={!showStage} className="space-y-2">
        {/* Distinct keys: reusing the live element would keep its srcObject (the closed stream),
            which wins over src, so the replay would show the dead stream instead. */}
        {phase === "done" && replayUrl ? (
          <video
            key="replay"
            src={replayUrl}
            controls
            className="aspect-video w-full rounded-md bg-foreground"
            aria-label="Recording of the ending"
          />
        ) : (
          <video
            key="live"
            ref={videoRef}
            poster={frameUrl}
            playsInline
            autoPlay
            className="aspect-video w-full rounded-md border-4 border-sand bg-foreground object-contain"
            aria-label="Story ending: live FastH3 video with sound"
          />
        )}
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {phase === "done"
            ? recorder.finishing
              ? "The ending played. Saving the recording."
              : "The ending played. The FastH3 session is closed."
            : status}
        </p>
        {ending.playing ? <p className="text-sm">{ending.playing.scene.caption}</p> : null}
      </div>

      {ending.scenes ? (
        <ol className="space-y-2" aria-label="Ending scenes">
          {ending.scenes.map((s, i) => (
            <li key={i} className="space-y-0.5 text-sm">
              <p className="hud-label">Ending scene {i + 1}</p>
              <p className="font-medium">{s.label}</p>
              <p className="text-muted-foreground">{s.caption}</p>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">FastH3 prompt</summary>
                <p className="font-reactor mt-1 whitespace-pre-wrap break-words">{s.prompt}</p>
              </details>
            </li>
          ))}
        </ol>
      ) : null}

      {directorS || firstS ? (
        <p className="font-reactor text-[11px] text-muted-foreground">
          {directorS ? `Gemini wrote it in ${directorS}` : null}
          {directorS && firstS ? " · " : null}
          {firstS ? `first scene on stage ${firstS} after the click` : null}
        </p>
      ) : null}
    </section>
  );
}
