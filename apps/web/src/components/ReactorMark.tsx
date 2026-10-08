import { cn } from "@/lib/utils";

export type ReactorMarkSize = "sm" | "md" | "lg";
export type ReactorMarkVariant = "solid" | "soft";

export interface ReactorMarkProps {
  /** Text of the chip. Keep "Reactor X2" in it so the engine is always named. */
  label?: string;
  size?: ReactorMarkSize;
  /** solid: ink chip for media and hero callouts; soft: tinted chip for light surfaces. */
  variant?: ReactorMarkVariant;
  /** Pulse the signal dot (a session is streaming). */
  live?: boolean;
  className?: string;
}

const SIZE: Record<ReactorMarkSize, string> = {
  sm: "gap-1.5 px-2 py-0.5 text-[11px]",
  md: "gap-2 px-2.5 py-1 text-[12px]",
  lg: "gap-2.5 px-3.5 py-1.5 text-[14px]",
};

const DOT: Record<ReactorMarkSize, string> = { sm: "size-1.5", md: "size-2", lg: "size-2.5" };

const VARIANT: Record<ReactorMarkVariant, { chip: string; dot: string }> = {
  solid: {
    chip: "border border-reactor-line bg-reactor-ink text-reactor-ink-foreground shadow-[var(--reactor-glow)]",
    dot: "bg-reactor-signal",
  },
  soft: {
    chip: "border border-reactor-ink/25 bg-reactor-soft text-reactor-ink",
    dot: "bg-primary",
  },
};

/**
 * The Reactor X2 wordmark chip. Everything that names or shows off the engine uses it, so the
 * Reactor face (font-reactor) and ink treatment read as one brand across stage and landing.
 */
export function ReactorMark({
  label = "Reactor X2",
  size = "md",
  variant = "solid",
  live = false,
  className,
}: ReactorMarkProps) {
  const tone = VARIANT[variant];
  return (
    <span
      data-reactor-mark=""
      data-size={size}
      data-variant={variant}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-reactor font-semibold tracking-[0.06em] whitespace-nowrap uppercase",
        SIZE[size],
        tone.chip,
        className,
      )}
    >
      <span
        data-reactor-signal=""
        aria-hidden
        className={cn("shrink-0 rounded-full", DOT[size], tone.dot, live && "animate-pulse")}
      />
      <span>{label}</span>
    </span>
  );
}
