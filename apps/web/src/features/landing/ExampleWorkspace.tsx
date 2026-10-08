import { Clapperboard, MessageSquareText, Package, Play } from "lucide-react";
import type { ReactNode } from "react";
import { EXAMPLE_WORKSPACE } from "./landing-content";

/**
 * Static landing illustration (spec 6): a framed product scene labeled Example workspace with
 * three decorative cards. Nothing here is live; no provider session starts from this view.
 */
export function ExampleWorkspace() {
  const { image, productName, whatHappened, clipDuration } = EXAMPLE_WORKSPACE;
  return (
    <figure className="holo-tray relative flex flex-col gap-3 p-3 sm:p-4">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="hud-label text-neon">Example workspace</span>
        <span className="hud-label rounded-sm border border-border px-2 py-0.5 text-[10px]">
          Illustration · not live
        </span>
      </figcaption>
      <div className="relative overflow-hidden rounded-xl border border-border">
        <img
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          fetchPriority="high"
          decoding="async"
          className="aspect-[16/10] h-auto w-full object-cover"
        />
        <div aria-hidden className="scanlines pointer-events-none absolute inset-0" />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <ExampleCard
          icon={<Package aria-hidden className="size-4 text-neon" />}
          label="Your product"
        >
          {productName}
        </ExampleCard>
        <ExampleCard
          icon={<MessageSquareText aria-hidden className="size-4 text-neon" />}
          label="What happened"
        >
          {whatHappened.before}
          <mark className="hl-established">{whatHappened.marks[0]}</mark>{" "}
          <mark className="hl-established">{whatHappened.marks[1]}</mark>
          {whatHappened.after}
        </ExampleCard>
        <ExampleCard
          icon={<Clapperboard aria-hidden className="size-4 text-magenta" />}
          label="A clip you can share"
        >
          <span className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full border border-magenta/60">
              <Play aria-hidden className="size-3 text-magenta" />
            </span>
            <span aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full w-2/5 bg-magenta" />
            </span>
            <span className="font-mono text-xs text-muted-foreground">{clipDuration}</span>
          </span>
        </ExampleCard>
      </div>
    </figure>
  );
}

function ExampleCard({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/80 p-3">
      <span className="hud-label flex items-center gap-1.5 text-[11px]">
        {icon}
        {label}
      </span>
      <span className="text-sm leading-snug">{children}</span>
    </div>
  );
}
