import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { PlayedBeat } from "./story-state";
import type { StoryRecorder } from "./useStoryRecorder";

/** Shown once the story ends: the recorded reel (exactly what played) and its scenes. */
export function StorySendPanel({
  beats,
  recorder,
}: {
  caseId: string;
  beats: PlayedBeat[];
  recorder: StoryRecorder;
}) {
  const reel = recorder.result?.reel ?? null;
  const [reelUrl, setReelUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!reel) return;
    const url = URL.createObjectURL(reel);
    setReelUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reel]);

  return (
    <section
      aria-labelledby="story-done-title"
      className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4"
    >
      <h2 id="story-done-title" className="text-sm font-semibold">
        Your story ({beats.length} {beats.length === 1 ? "scene" : "scenes"})
      </h2>
      {recorder.finishing ? (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Saving the recording
        </p>
      ) : recorder.result?.problem ? (
        <p className="text-sm text-muted-foreground">{recorder.result.problem}</p>
      ) : reelUrl ? (
        <video
          src={reelUrl}
          controls
          className="aspect-video w-full max-w-xl rounded-md bg-foreground"
          aria-label="Recording of your story"
        />
      ) : null}
    </section>
  );
}
