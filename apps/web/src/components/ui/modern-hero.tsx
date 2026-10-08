/**
 * SmoothScrollHero adapted from reference/modern-hero.original.tsx (spec 6 + 25).
 * Data-free: the parent route owns catalog rows, selection state, case creation and navigation.
 * Motion (Lenis + sticky expanding stage + parallax) runs only on wide, tall viewports without
 * reduced motion; everything else gets a static composition with the same content and actions.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ReactLenis, useLenis } from "lenis/react";
import "lenis/dist/lenis.css";
import {
  motion,
  useMotionTemplate,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  Headset,
  ImageUp,
  LoaderCircle,
  RotateCcw,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type HeroProductId = string;

export interface HeroImage {
  src: string;
  /** Empty string marks the image decorative. */
  alt: string;
  width: number;
  height: number;
}

export type ProductEntry =
  { kind: "demo"; fixtureId: string } | { kind: "photo"; categoryHint?: string };

export interface HeroProduct {
  id: HeroProductId;
  name: string;
  category: string;
  description: string;
  image: HeroImage | null;
  entry: ProductEntry;
  actionLabel: string;
}

export type ProductSelectionState =
  | { status: "idle" }
  | { status: "pending"; productId: HeroProductId }
  | { status: "error"; productId: HeroProductId; message: string };

export interface SmoothScrollHeroProps {
  tagline: string;
  title: string;
  /** Word inside `title` that gets the neon underline. */
  titleHighlight?: string;
  description: string;
  primaryActionLabel: string;
  /** Decorative expanding stage image (motion layout only). */
  heroImage: HeroImage;
  /** Decorative parallax cards (motion layout only). */
  parallaxImages: readonly HeroImage[];
  /** Parent-owned illustration shown beside the copy (e.g. the Example workspace). */
  aside?: ReactNode;
  productsHeading: string;
  productsIntro?: string;
  products: readonly HeroProduct[];
  productsStatus?: "loading" | "ready" | "error";
  productsError?: string | null;
  onRetryProducts?: () => void;
  featuredProductId?: HeroProductId;
  selectionState: ProductSelectionState;
  onSelectProduct: (productId: HeroProductId) => void | Promise<void>;
  onUploadPhoto: () => void;
  /** Rendered under the product rows (disclosures, photo intake panel). */
  productsFooter?: ReactNode;
  supportHref: string;
  supportLabel?: string;
  /** Client-side navigation for header links; plain anchors are used when omitted. */
  onNavigate?: (href: string) => void;
  className?: string;
}

const NAV_HEIGHT = 64;
const MOTION_QUERY = "(min-width: 1024px) and (min-height: 600px)";
const LENIS_OPTIONS = { autoRaf: true, lerp: 0.12 } as const;
let mountedLenisRoots = 0;

/**
 * Lenis 1.3 destroy() leaves its 400 ms native-scroll timer armed, which can re-add the
 * `lenis` class to <html> after the landing unmounts. Strip it once no root is mounted.
 */
function useLenisRootCleanup(active: boolean) {
  useEffect(() => {
    if (!active) return;
    mountedLenisRoots += 1;
    return () => {
      mountedLenisRoots -= 1;
      window.setTimeout(() => {
        if (mountedLenisRoots > 0) return;
        const root = document.documentElement;
        for (const name of Array.from(root.classList)) {
          if (name === "lenis" || name.startsWith("lenis-")) root.classList.remove(name);
        }
      }, 500);
    };
  }, [active]);
}
const PARALLAX_LAYOUT = [
  { className: "w-[30%]", start: 80, end: -80 },
  { className: "mx-auto -mt-16 w-[46%]", start: 120, end: -140 },
  { className: "ml-auto -mt-40 w-[24%]", start: 60, end: -120 },
] as const;

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function SmoothScrollHero(props: SmoothScrollHeroProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const wideEnough = useMediaQuery(MOTION_QUERY);
  const motionEnabled = wideEnough && !reducedMotion;
  const lenis = useLenis();
  const productsRef = useRef<HTMLElement>(null);
  const productsHeadingRef = useRef<HTMLHeadingElement>(null);
  const productsId = `choose-product-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  useLenisRootCleanup(motionEnabled);

  const scrollToProducts = useCallback(() => {
    const target = productsRef.current;
    if (!target) return;
    // Lenis and scrollIntoView both honor the section scroll-margin (clears the fixed nav).
    if (lenis) lenis.scrollTo(target, { immediate: reducedMotion });
    else target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    productsHeadingRef.current?.focus({ preventScroll: true });
  }, [lenis, reducedMotion]);

  return (
    <div className={cn("relative bg-background text-foreground", props.className)}>
      {motionEnabled && <ReactLenis root options={LENIS_OPTIONS} />}
      <a
        href={`#${productsId}`}
        onClick={(event) => {
          event.preventDefault();
          scrollToProducts();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-20 focus:left-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to products
      </a>
      <Nav {...props} onChooseProduct={scrollToProducts} />
      {motionEnabled ? (
        <MotionHero {...props} onChooseProduct={scrollToProducts} />
      ) : (
        <StaticHero {...props} onChooseProduct={scrollToProducts} />
      )}
      <ProductChoices
        {...props}
        sectionId={productsId}
        sectionRef={productsRef}
        headingRef={productsHeadingRef}
        animate={motionEnabled}
      />
    </div>
  );
}

type WithChoose = SmoothScrollHeroProps & { onChooseProduct: () => void };

function Nav({
  supportHref,
  supportLabel,
  onNavigate,
  primaryActionLabel,
  onChooseProduct,
}: WithChoose) {
  const onSupportClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    onNavigate(supportHref);
  };
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-md"
      style={{ height: NAV_HEIGHT }}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <span className="flex items-center gap-2 font-mono text-[15px] font-semibold tracking-tight">
          <ScanLine aria-hidden className="size-5 text-neon" />
          <span>
            Symptom<span className="text-magenta">Sketch</span>
          </span>
        </span>
        <div className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a href={supportHref} onClick={onSupportClick}>
              <Headset aria-hidden />
              <span className="hidden sm:inline">{supportLabel ?? "Support workspace"}</span>
              <span className="sm:hidden">Support</span>
            </a>
          </Button>
          <Button size="sm" onClick={onChooseProduct} className="font-mono">
            <span className="hidden sm:inline">{primaryActionLabel}</span>
            <span className="sm:hidden">Products</span>
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
}

function HeroCopy({
  tagline,
  title,
  titleHighlight,
  description,
  primaryActionLabel,
  onChooseProduct,
}: WithChoose) {
  const at = titleHighlight ? title.indexOf(titleHighlight) : -1;
  return (
    <div className="flex flex-col gap-5">
      <p className="hud-label text-neon">// SymptomSketch · visual support</p>
      <p className="font-mono text-[clamp(2.1rem,5vw,4.6rem)] leading-[0.95] font-semibold tracking-tight uppercase">
        {tagline}
      </p>
      <h1 className="text-[clamp(1.6rem,2.6vw,2.4rem)] leading-tight font-semibold">
        {at < 0 || !titleHighlight ? (
          title
        ) : (
          <>
            {title.slice(0, at)}
            <span className="relative inline-block text-neon after:absolute after:inset-x-0 after:-bottom-1 after:h-[3px] after:rounded-full after:bg-neon after:shadow-[var(--glow)]">
              {titleHighlight}
            </span>
            {title.slice(at + titleHighlight.length)}
          </>
        )}
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">{description}</p>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button size="lg" onClick={onChooseProduct} className="h-11 font-mono shadow-[var(--glow)]">
          {primaryActionLabel}
          <ArrowDown aria-hidden />
        </Button>
        <span className="hud-label">No AI runs on this page</span>
      </div>
    </div>
  );
}

function StaticHero(props: WithChoose) {
  return (
    <section
      aria-label="Introduction"
      className="cyber-grid relative px-4 pb-10 sm:px-6"
      style={{ paddingTop: NAV_HEIGHT + 32 }}
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <HeroCopy {...props} />
        {props.aside}
      </div>
    </section>
  );
}

function MotionHero(props: WithChoose) {
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end end"] });
  const copyOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const copyY = useTransform(scrollYProgress, [0, 0.2], [0, -48]);
  const clipA = useTransform(scrollYProgress, [0.04, 0.5], [50, 0]);
  const clipB = useTransform(scrollYProgress, [0.04, 0.5], [50, 100]);
  const clipPath = useMotionTemplate`polygon(${clipA}% ${clipA}%, ${clipB}% ${clipA}%, ${clipB}% ${clipB}%, ${clipA}% ${clipB}%)`;
  const imageScale = useTransform(scrollYProgress, [0, 0.8], [1.3, 1]);
  const stageOpacity = useTransform(scrollYProgress, [0.82, 1], [1, 0]);

  return (
    <section ref={heroRef} aria-label="Introduction" className="relative w-full">
      <div className="sticky top-0 h-screen overflow-hidden">
        <div aria-hidden className="cyber-grid absolute inset-0" />
        <motion.div
          aria-hidden
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath, opacity: stageOpacity }}
        >
          <motion.img
            src={props.heroImage.src}
            alt=""
            width={props.heroImage.width}
            height={props.heroImage.height}
            decoding="async"
            className="h-full w-full object-cover"
            style={{ scale: imageScale }}
          />
          <div className="scanlines absolute inset-0 bg-background/35" />
        </motion.div>
        <motion.div
          className="relative z-10 mx-auto grid h-full max-w-6xl grid-cols-[1.05fr_0.95fr] items-center gap-10 px-6"
          style={{ opacity: copyOpacity, y: copyY, paddingTop: NAV_HEIGHT }}
        >
          <HeroCopy {...props} />
          {props.aside}
        </motion.div>
      </div>
      <ParallaxImages images={props.parallaxImages} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-linear-to-b from-transparent to-background"
      />
    </section>
  );
}

function ParallaxImages({ images }: { images: readonly HeroImage[] }) {
  return (
    <div aria-hidden className="relative z-20 mx-auto max-w-5xl px-6 pt-[40vh] pb-32">
      {images.slice(0, PARALLAX_LAYOUT.length).map((image, i) => {
        const layout = PARALLAX_LAYOUT[i];
        if (!layout) return null;
        return <ParallaxImg key={image.src} image={image} {...layout} />;
      })}
    </div>
  );
}

interface ParallaxImgProps {
  image: HeroImage;
  start: number;
  end: number;
  className?: string;
}

function ParallaxImg({ image, start, end, className }: ParallaxImgProps) {
  const ref = useRef<HTMLImageElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const opacity = useTransform(scrollYProgress, [0.75, 1], [1, 0]);
  const scale = useTransform(scrollYProgress, [0.75, 1], [1, 0.9]);
  const y = useTransform(scrollYProgress, [0, 1], [start, end]);
  const transform = useMotionTemplate`translateY(${y}px) scale(${scale})`;
  return (
    <motion.img
      ref={ref}
      src={image.src}
      alt=""
      width={image.width}
      height={image.height}
      loading="lazy"
      decoding="async"
      className={cn(
        "block h-auto rounded-2xl border border-border shadow-[var(--glow)]",
        className,
      )}
      style={{ transform, opacity }}
    />
  );
}

interface ProductChoicesProps extends SmoothScrollHeroProps {
  sectionId: string;
  sectionRef: RefObject<HTMLElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  animate: boolean;
}

function ProductChoices(props: ProductChoicesProps) {
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
