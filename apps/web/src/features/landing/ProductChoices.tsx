/**
 * The product rows under the landing hero (spec 6): catalog fixtures + "Your own product".
 * Split out of components/ui/modern-hero.tsx; SmoothScrollHero renders it with the same props.
 */
import { useId, type RefObject } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ImageUp, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeroProduct, SmoothScrollHeroProps } from "@/components/ui/hero-types";
import { SandHighlight } from "@/components/SandHighlight";
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
      className="relative mx-auto max-w-5xl scroll-mt-24 px-4 py-16 sm:px-6 md:py-20"
    >
      <motion.h2
        id={`${props.sectionId}-heading`}
        ref={props.headingRef}
        tabIndex={-1}
        initial={animate ? { y: 32, opacity: 0 } : false}
        whileInView={animate ? { y: 0, opacity: 1 } : undefined}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ ease: "easeInOut", duration: 0.6 }}
        className="text-center text-[clamp(2rem,4.6vw,3.25rem)] leading-tight font-extrabold tracking-[-0.035em] outline-none"
      >
        <SandHighlight text={props.productsHeading} highlight={props.productsHeadingHighlight} />
      </motion.h2>
      {props.productsIntro && (
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
          {props.productsIntro}
        </p>
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

      <ul
        className="mt-10 flex flex-col divide-y divide-border border-y border-border"
        aria-busy={productsStatus === "loading"}
      >
        {productsStatus === "loading" &&
          [0, 1, 2].map((i) => (
            <li key={`skeleton-${i}`} aria-hidden className="py-4">
              <span className="block h-[104px] animate-pulse rounded-xl bg-muted" />
            </li>
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
          "group grid min-h-[44px] w-full grid-cols-[96px_1fr] items-center gap-x-5 gap-y-3 rounded-2xl px-2 py-4 text-left transition-colors sm:grid-cols-[200px_1fr_auto] sm:px-3",
          "hover:bg-surface/80 disabled:cursor-not-allowed",
          error && "ring-1 ring-destructive/60",
          props.disabled && !pending && "opacity-60",
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
            className="aspect-[2/1] w-full rounded-xl object-cover shadow-[var(--glow)]"
          />
        ) : (
          <span className="grid aspect-[2/1] w-full place-items-center rounded-xl bg-muted">
            <ImageUp aria-hidden className="size-9 text-muted-foreground" />
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>{product.category}</span>
            {props.featured && (
              <span className="rounded-full bg-sand-soft px-2 py-0.5 text-[11px] text-foreground">
                Recommended
              </span>
            )}
          </span>
          <span className="text-xl font-bold tracking-tight sm:text-2xl">{product.name}</span>
          <span className="text-sm text-muted-foreground sm:text-base">{product.description}</span>
        </span>
        <span
          className={cn(
            "col-span-2 inline-flex items-center justify-self-end gap-2 rounded-lg px-5 py-3 text-[15px] font-medium transition-colors sm:col-span-1",
            isPhoto
              ? "border border-foreground/25 bg-surface text-foreground group-hover:border-foreground/50"
              : "bg-primary text-primary-foreground group-hover:bg-primary/90",
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
