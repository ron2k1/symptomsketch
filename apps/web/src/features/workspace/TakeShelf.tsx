import { Film, Plus } from "lucide-react";
import { takeShelfLabel, type Take, type TakeShelfLabel } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { formatTakeNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const LABEL_STYLE: Record<TakeShelfLabel, string> = {
  Uploading: "text-neon",
  Processing: "text-neon",
  "Export failed": "text-destructive",
  Incomplete: "text-warning",
  Review: "text-foreground",
  Unsure: "text-warning",
  Matched: "text-success",
  Rejected: "text-magenta",
};

interface TakeShelfProps {
  takes: readonly Take[];
  selectedTakeId: string | null;
  onSelect(id: string): void;
  onNewTake(): void;
  disabled: boolean;
}

/** Saved takes beneath the stage. The live scene is never shown here (spec 6 take shelf). */
export function TakeShelf({
  takes,
  selectedTakeId,
  onSelect,
  onNewTake,
  disabled,
}: TakeShelfProps) {
  return (
    <section aria-labelledby="takes-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="takes-heading" className="text-base font-semibold">
          Saved takes
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={disabled}
          onClick={onNewTake}
        >
          <Plus aria-hidden />
          New take
        </Button>
      </div>
      {takes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No saved takes yet. Use Clip on the live stage; the live preview itself is not saved.
        </p>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-2" aria-label="Saved takes">
          {takes.map((take) => {
            const selected = take.id === selectedTakeId;
            const label = takeShelfLabel(take);
            return (
              <li key={take.id} className="w-44 shrink-0">
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onSelect(take.id)}
                  className={cn(
                    "block w-full rounded-xl border bg-surface p-2 text-left transition-colors",
                    selected
                      ? "border-neon shadow-[var(--glow)]"
                      : "border-border hover:border-neon/50",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  <span className="relative block aspect-video overflow-hidden rounded-lg bg-surface-2">
                    {take.thumbnailUrl ? (
                      <img
                        src={take.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-muted-foreground">
                        <Film className="size-5" aria-hidden />
                      </span>
                    )}
                  </span>
                  <span className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[13px]">{formatTakeNumber(take.number)}</span>
                    <span className={cn("font-mono text-[12px]", LABEL_STYLE[label])}>{label}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted-foreground">
                    {take.caption}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
