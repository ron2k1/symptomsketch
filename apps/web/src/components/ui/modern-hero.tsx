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
import { ArrowDown, ArrowRight, Headset, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductChoices } from "@/features/landing/ProductChoices";
import { cn } from "@/lib/utils";
import type { HeroImage, SmoothScrollHeroProps } from "./hero-types";

export type {
  HeroImage,
  HeroProduct,
  HeroProductId,
  ProductEntry,
  ProductSelectionState,
  SmoothScrollHeroProps,
} from "./hero-types";

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
