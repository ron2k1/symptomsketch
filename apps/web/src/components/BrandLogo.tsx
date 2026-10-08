import { cn } from "@/lib/utils";

/** The concept-mockup mark: a sand tile with a forest-green base, plus the bold wordmark. */
export function BrandLogo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5 font-sans font-bold tracking-tight", className)}>
      <svg aria-hidden viewBox="0 0 32 32" className="size-8 shrink-0">
        <rect width="32" height="32" rx="9" fill="var(--sand)" />
        <path
          d="M0 13.5c5.5 5 26.5 5 32 0V23a9 9 0 0 1-9 9H9a9 9 0 0 1-9-9z"
          fill="var(--primary)"
        />
      </svg>
      <span className={cn(compact ? "text-[17px]" : "text-[22px]")}>SymptomSketch</span>
    </span>
  );
}
