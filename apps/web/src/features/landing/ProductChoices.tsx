/**
 * The product rows under the landing hero (spec 6): catalog fixtures + "Your own product".
 * Split out of components/ui/modern-hero.tsx; SmoothScrollHero renders it with the same props.
 */
import { useId, type RefObject } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ImageUp, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeroProduct, SmoothScrollHeroProps } from "@/components/ui/hero-types";
import { cn } from "@/lib/utils";

export interface ProductChoicesProps extends SmoothScrollHeroProps {
  sectionId: string;
  sectionRef: RefObject<HTMLElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  animate: boolean;
}

export function ProductChoices(props: ProductChoicesProps) {
  const { products, productsStatus = "ready", selectionState, animate } = props;
  const busy = selectionState.status === "pending";
  return (
    <section
      id={props.sectionId}
      ref={props.sectionRef}
      aria-labelledby={`${props.sectionId}-heading`}
      className="relative mx-auto max-w-5xl scroll-mt-20 px-4 py-16 sm:px-6 md:py-24"
    >
      <p className="hud-label mb-3 text-neon">// Choose your product</p>
      <motion.h2
        id={`${props.sectionId}-heading`}
        ref={props.headingRef}
        tabIndex={-1}
        initial={animate ? { y: 32, opacity: 0 } : false}
        whileInView={animate ? { y: 0, opacity: 1 } : undefined}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ ease: "easeInOut", duration: 0.6 }}
        className="text-3xl font-semibold tracking-tight outline-none sm:text-4xl"
      >
        {props.productsHeading}
      </motion.h2>
      {props.productsIntro && (
        <p className="mt-3 max-w-2xl text-muted-foreground">{props.productsIntro}</p>
      )}

      {productsStatus === "error" && (
        <div
          role="alert"
          className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/60 bg-surface px-4 py-3 text-sm"
        >
          <TriangleAlert aria-hidden className="size-4 text-destructive" />
          <span className="flex-1">
            {props.productsError ?? "Demo products could not be loaded."}
          </span>
          {props.onRetryProducts && (
            <Button size="sm" variant="outline" onClick={props.onRetryProducts}>
              <RotateCcw aria-hidden />
              Retry
            </Button>
          )}
        </div>
      )}

      <ul className="mt-10 flex flex-col gap-4" aria-busy={productsStatus === "loading"}>
        {productsStatus === "loading" &&
          [0, 1, 2].map((i) => (
            <li
              key={`skeleton-${i}`}
              aria-hidden
              className="h-[104px] animate-pulse rounded-xl border border-border bg-surface/70"
            />
          ))}
        {products.map((product, index) => (
          <ProductChoiceRow
            key={product.id}
            product={product}
            index={index}
            featured={product.id === props.featuredProductId}
            pending={busy && selectionState.productId === product.id}
            disabled={busy}
            error={
              selectionState.status === "error" && selectionState.productId === product.id
                ? selectionState.message
                : null
            }
            animate={animate}
            onActivate={() =>
              product.entry.kind === "photo"
                ? props.onUploadPhoto()
                : void props.onSelectProduct(product.id)
            }
          />
        ))}
      </ul>
      {props.productsFooter}
    </section>
  );
}

interface ProductChoiceRowProps {
  product: HeroProduct;
  index: number;
  featured: boolean;
  pending: boolean;
  disabled: boolean;
  error: string | null;
  animate: boolean;
  onActivate: () => void;
}

function ProductChoiceRow(props: ProductChoiceRowProps) {
  const { product, pending, error } = props;
  const errorId = useId();
  const isPhoto = product.entry.kind === "photo";
  const label = isPhoto ? "Your own" : `Product ${String(props.index + 1).padStart(2, "0")}`;
  return (
    <motion.li
      initial={props.animate ? { y: 40, opacity: 0 } : false}
      whileInView={props.animate ? { y: 0, opacity: 1 } : undefined}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ ease: "easeInOut", duration: 0.55, delay: Math.min(props.index, 4) * 0.06 }}
    >
      <button
        type="button"
        onClick={props.onActivate}
        disabled={props.disabled}
        aria-busy={pending}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "group grid min-h-[44px] w-full grid-cols-[64px_1fr] items-center gap-x-4 gap-y-3 rounded-xl border bg-surface/80 p-3 text-left transition-[border-color,background-color,box-shadow] sm:grid-cols-[88px_1fr_auto] sm:p-4",
          "hover:border-primary/70 hover:bg-surface-2 hover:shadow-[var(--glow)] disabled:cursor-not-allowed",
          error ? "border-destructive/70" : "border-border",
          props.disabled && !pending && "opacity-60",
          isPhoto && "border-dashed",
        )}
      >
        {product.image ? (
          <img
            src={product.image.src}
            alt=""
            width={product.image.width}
            height={product.image.height}
            loading="lazy"
            decoding="async"
            className="size-16 rounded-lg border border-border object-cover sm:size-[88px]"
          />
        ) : (
          <span className="grid size-16 place-items-center rounded-lg border border-dashed border-magenta/60 bg-magenta-soft sm:size-[88px]">
            <ImageUp aria-hidden className="size-7 text-magenta" />
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-1">
          <span className="hud-label flex flex-wrap items-center gap-2">
            <span className={isPhoto ? "text-magenta" : "text-neon"}>{label}</span>
            <span aria-hidden>·</span>
            <span>{product.category}</span>
            {props.featured && (
              <span className="rounded-sm border border-magenta/60 px-1.5 text-[10px] text-magenta">
                Recommended
              </span>
            )}
          </span>
          <span className="text-lg font-semibold sm:text-xl">{product.name}</span>
          <span className="text-sm text-muted-foreground">{product.description}</span>
        </span>
        <span
          className={cn(
            "col-span-2 inline-flex items-center justify-self-end gap-2 rounded-md border px-3 py-2 font-mono text-sm sm:col-span-1",
            isPhoto
              ? "border-magenta/60 text-magenta"
              : "border-primary/60 text-neon group-hover:bg-primary group-hover:text-primary-foreground",
          )}
        >
          {pending ? (
            <>
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              Opening…
            </>
          ) : (
            <>
              {product.actionLabel}
              <ArrowRight aria-hidden className="size-4" />
            </>
          )}
        </span>
      </button>
      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-2 flex items-start gap-2 text-sm text-destructive"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {error} Select {product.name} again to retry.
          </span>
        </p>
      )}
    </motion.li>
  );
}
