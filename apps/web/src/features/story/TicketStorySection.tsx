import { useEffect, useState } from "react";
import { STORY_ACT_LABELS, storyActForBeat, type TicketStory } from "@symptomsketch/contracts";
import { formatBytes, formatTimestamp } from "@/lib/format";
import { getTicketStory } from "./story-api";

/** How often the open ticket checks for a story the customer sends while support is looking. */
const STORY_POLL_MS = 5000;

/**
 * Staff ticket view: the story the customer steered on MiniMax FastH3, as their browser recorded
 * it (reel with generated sound), plus every scene with its caption, the cards offered, and the
 * exact FastH3 prompt. Renders nothing until the case has a story (or when it is not readable).
 */
export function TicketStorySection({ ticketId }: { ticketId: string }) {
  const [story, setStory] = useState<TicketStory | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await getTicketStory(ticketId, ac.signal);
        if (ac.signal.aborted) return;
        setStory((prev) => (prev?.id === r.story?.id ? prev : r.story));
      } catch {
        // Not readable (404) or offline: show nothing, try again on the next tick.
      }
      if (!ac.signal.aborted) timer = setTimeout(() => void load(), STORY_POLL_MS);
    };
    void load();
    return () => {
      ac.abort();
      if (timer) clearTimeout(timer);
    };
  }, [ticketId]);

  if (!story || !story.reelUrl) return null;

  return (
    <section
      aria-labelledby="ticket-story-title"
      className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <h2 id="ticket-story-title" className="hud-label">
          Customer story (<span className="font-reactor">MiniMax FastH3</span>)
        </h2>
        <p className="text-xs text-muted-foreground">
          AI reenactment the customer steered scene by scene, with generated sound. Not a recording
          of the product.
        </p>
      </div>
      <video
        src={story.reelUrl}
        poster={story.frameUrl ?? undefined}
        controls
        preload="metadata"
        className="aspect-video w-full rounded-md bg-foreground"
        aria-label="Customer story reel"
      />
      <p className="font-reactor text-[11px] text-muted-foreground">
        {story.beats.length} {story.beats.length === 1 ? "scene" : "scenes"} · {story.clipSeconds} s
        clips · {formatBytes(story.reelBytes)} · sent {formatTimestamp(story.createdAt)}
      </p>
      <ol className="space-y-3" aria-label="Story scenes">
        {story.beats.map((b, i) => {
          const offered = story.offered[i] ?? [];
          return (
            <li
              key={i}
              className="space-y-1 border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <p className="hud-label">
                Scene {i + 1} · {STORY_ACT_LABELS[storyActForBeat(i + 1)]}
              </p>
              <p className="text-sm font-medium">{b.label}</p>
              <p className="text-sm text-muted-foreground">{b.caption}</p>
              {b.custom ? (
                <p className="text-xs font-medium text-primary">Typed by the customer</p>
              ) : offered.length > 0 ? (
                <p className="text-xs text-muted-foreground">Picked from: {offered.join(" · ")}</p>
              ) : null}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">FastH3 prompt</summary>
                <p className="font-reactor mt-1 whitespace-pre-wrap break-words">{b.prompt}</p>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
