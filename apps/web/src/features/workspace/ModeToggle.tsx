import { PURPOSE_MODE_LABELS, Purpose } from "@symptomsketch/contracts";
import { cn } from "@/lib/utils";

interface ModeToggleProps {
  mode: Purpose;
  onChange(mode: Purpose): void;
  disabled: boolean;
  /** Agent work cases are instructional only. */
  solutionOnly: boolean;
}

/** Secondary purpose control inside Recreate; distinct from the navigation tabs (spec 6). */
export function ModeToggle({ mode, onChange, disabled, solutionOnly }: ModeToggleProps) {
  const options = solutionOnly ? (["solution"] as const) : Purpose.options;
  return (
    <div
      role="radiogroup"
      aria-label="Purpose"
      className="inline-flex rounded-lg border border-border bg-surface p-1"
    >
      {options.map((option) => {
        const checked = option === mode;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled && !checked}
            onClick={() => !checked && onChange(option)}
            className={cn(
              "min-h-10 rounded-md px-3 text-sm transition-colors",
              checked
                ? option === "solution"
                  ? "bg-magenta-soft text-foreground shadow-[var(--glow-magenta)]"
                  : "bg-neon-soft text-foreground shadow-[var(--glow)]"
                : "text-muted-foreground hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {PURPOSE_MODE_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
