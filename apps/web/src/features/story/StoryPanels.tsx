import { STORY_ACT_LABELS, storyActForBeat } from "@symptomsketch/contracts";
import { cn } from "@/lib/utils";
import { median, shortClipId, type ClipState, type StoryState } from "./story-state";
import type { CommandErrorView } from "./useStory";

const STATE_LABEL: Record<ClipState, string> = {
  queued: "queued",
  building: "building",
  ready: "ready",
  playing: "playing",
  played: "played",
  popped: "popped",
  failed: "failed",
};

const STATE_CLASS: Record<ClipState, string> = {
  queued: "border-border bg-muted text-muted-foreground",
  building: "border-warning/40 bg-warning/10 text-warning",
  ready: "border-success/40 bg-success/10 text-success",
  playing: "border-primary bg-primary text-primary-foreground",
  played: "border-border bg-card text-muted-foreground",
  popped: "border-border bg-card text-muted-foreground line-through",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function ClipStateChip({ state }: { state: ClipState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-reactor text-[11px] leading-4",
        STATE_CLASS[state],
      )}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

const sec = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);

/** Live Reactor queue: every clip FastH3 reported, driven only by real messages. */
export function ReactorQueueStrip({
  state,
  commandErrors,
  effectiveSeconds,
}: {
  state: StoryState;
  commandErrors: CommandErrorView[];
  effectiveSeconds: number | null;
}) {
  const t = state.timings;
  const lastBuild = t.buildMs.length ? t.buildMs[t.buildMs.length - 1]! : null;
  const lastDirector = t.directorMs.length ? t.directorMs[t.directorMs.length - 1]! : null;
  return (
    <section
      aria-labelledby="reactor-queue-title"
      className="rounded-[var(--radius-card)] border border-border bg-card p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="reactor-queue-title" className="font-reactor text-sm font-semibold">
          Reactor queue
        </h2>
        <span className="font-reactor text-[11px] text-muted-foreground">reactor/fast-h3</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Live from FastH3 queue_update and clip events: each choice is built ahead as its own clip,
        and the ones you do not pick are popped.
      </p>
      {state.order.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No clips yet.</p>
      ) : (
        <ol
          className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1"
          aria-label="Clips in this session"
        >
          {state.order.map((id) => {
            const c = state.clips[id]!;
            return (
              <li key={id} className="flex items-center gap-2 text-xs">
                <span className="font-reactor text-muted-foreground" title={id}>
                  {shortClipId(id)}
                </span>
                <ClipStateChip state={c.state} />
                <span className="font-reactor text-muted-foreground">
                  {c.seconds !== null ? `${c.seconds.toFixed(2)}s` : ""}
                </span>
                <span className="min-w-0 flex-1 truncate" title={c.meta?.choice}>
                  {c.meta ? `#${c.meta.beat} ${c.meta.choice}` : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border pt-3 text-xs">
        <dt className="text-muted-foreground">Clip length</dt>
        <dd className="font-reactor">
          {effectiveSeconds !== null ? `${effectiveSeconds.toFixed(3)} s` : "–"}
        </dd>
        <dt className="text-muted-foreground">Build (queued → ready)</dt>
        <dd className="font-reactor">
          {sec(lastBuild)}{" "}
          <span className="text-muted-foreground">median {sec(median(t.buildMs))}</span>
        </dd>
        <dt className="text-muted-foreground">Build (front → ready)</dt>
        <dd className="font-reactor">{sec(median(t.buildOnlyMs))}</dd>
        <dt className="text-muted-foreground">Pick → play, built</dt>
        <dd className="font-reactor">{sec(median(t.pickToStartReadyMs))}</dd>
        <dt className="text-muted-foreground">Pick → play, building</dt>
        <dd className="font-reactor">{sec(median(t.pickToStartBuildingMs))}</dd>
        <dt className="text-muted-foreground">Director (Gemini)</dt>
        <dd className="font-reactor">
          {sec(lastDirector)}{" "}
          <span className="text-muted-foreground">median {sec(median(t.directorMs))}</span>
        </dd>
      </dl>
      {commandErrors.length > 0 ? (
        <ul
          className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-destructive"
          aria-label="Rejected commands"
        >
          {commandErrors.map((e) => (
            <li key={`${e.at}-${e.command}`} className="font-reactor">
              {e.command}: {e.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The story so far: one row per played (or picked) scene. */
export function StoryTimeline({ state }: { state: StoryState }) {
  return (
    <section
      aria-labelledby="story-timeline-title"
      className="rounded-[var(--radius-card)] border border-border bg-card p-4"
    >
      <h2 id="story-timeline-title" className="text-sm font-semibold">
        Your story
      </h2>
      {state.beats.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">The opening scene is being written.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {state.beats.map((b, i) => (
            <li key={b.clipId} className="border-l-2 border-sand-deep pl-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Scene {i + 1} · {STORY_ACT_LABELS[storyActForBeat(i + 1)]}
                {state.playingId === b.clipId ? " · playing" : ""}
              </p>
              <p className="text-sm font-medium">
                {b.custom ? "In your words: " : ""}
                {b.label}
              </p>
              <p className="text-xs text-muted-foreground">{b.caption}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
