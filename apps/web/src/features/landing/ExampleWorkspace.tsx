import { Play } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EXAMPLE_WORKSPACE } from "./landing-content";

/**
 * Static landing illustration (spec 6), laid out like the concept mockup: the product scene in the
 * sand frame with three cards floating over its edges (stacked under it on narrow screens).
 * Nothing here is live; no provider session starts from this view.
 */
export function ExampleWorkspace() {
  const { image, productName, whatHappened, clipDuration } = EXAMPLE_WORKSPACE;
  return (
    <figure className="relative mx-auto w-full max-w-4xl md:px-10 md:pb-10">
      <div className="holo-tray p-3 sm:p-6">
        <div className="relative overflow-hidden rounded-[18px]">
          <img
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            fetchPriority="high"
            decoding="async"
            className="aspect-[16/9] h-auto w-full object-cover object-[50%_85%]"
          />
          <figcaption className="absolute top-3 right-3 rounded-full bg-surface/90 px-3 py-1 text-xs font-medium shadow-[var(--glow)] backdrop-blur">
            Example workspace · not live
          </figcaption>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 md:contents">
        <FloatCard label="Your product" className="md:absolute md:top-[18%] md:left-0 md:w-48">
          <img
            src={image.src}
            alt=""
            width={image.width}
            height={image.height}
            decoding="async"
            className="mb-2 aspect-[4/3] w-full rounded-lg object-cover"
          />
          <span className="text-sm">{productName}</span>
        </FloatCard>
        <FloatCard label="What happened" className="md:absolute md:top-[46%] md:right-0 md:w-56">
          <span className="block rounded-lg border border-border px-2.5 py-2 text-sm leading-relaxed">
            {whatHappened.before}
            <mark className="hl-established">{whatHappened.marks[0]}</mark>{" "}
            <mark className="hl-established">{whatHappened.marks[1]}</mark>
            {whatHappened.after}
          </span>
        </FloatCard>
        <FloatCard
          label="A clip you can share"
          className="md:absolute md:bottom-0 md:left-1/2 md:w-64 md:-translate-x-1/2"
        >
          <span className="relative block overflow-hidden rounded-lg">
            <img
              src={image.src}
              alt=""
              width={image.width}
              height={image.height}
              decoding="async"
              className="aspect-[5/2] w-full object-cover"
            />
            <span className="absolute top-1/2 left-3 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-surface shadow-[var(--glow)]">
              <Play aria-hidden className="size-3.5 fill-foreground text-foreground" />
            </span>
            <span className="absolute right-2 bottom-2 rounded-md bg-foreground/70 px-1.5 py-0.5 text-[11px] font-medium text-background">
              {clipDuration}
            </span>
          </span>
        </FloatCard>
      </div>
    </figure>
  );
}

function FloatCard({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-[0_14px_36px_rgb(28_32_30/0.13)]",
        className,
      )}
    >
      <span className="text-[15px] font-bold">{label}</span>
      {children}
    </div>
  );
}
