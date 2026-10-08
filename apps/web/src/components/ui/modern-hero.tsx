/**
 * SmoothScrollHero adapted from reference/modern-hero.original.tsx (spec 6 + 25), laid out like the
 * concept mockup: a centered headline over the framed Example workspace, then the product rows.
 * Data-free: the parent route owns catalog rows, selection state, case creation and navigation.
 * Motion (Lenis smooth scroll + reveal-on-scroll) runs only on wide, tall viewports without
 * reduced motion; everything else gets the same composition without it.
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
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronDown, Headset } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { ReactorMark } from "@/components/ReactorMark";
import { SandHighlight } from "@/components/SandHighlight";
import { Button } from "@/components/ui/button";
import { ProductChoices } from "@/features/landing/ProductChoices";
import { cn } from "@/lib/utils";
import type { SmoothScrollHeroProps } from "./hero-types";

export type {
  HeroImage,
  HeroProduct,
  HeroProductId,
  ProductEntry,
  ProductSelectionState,
  SmoothScrollHeroProps,
} from "./hero-types";

const NAV_HEIGHT = 72;
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
      <Hero {...props} onChooseProduct={scrollToProducts} animate={motionEnabled} />
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
      className="fixed inset-x-0 top-0 z-50 border-b border-border/70 bg-surface/90 shadow-[var(--glow)] backdrop-blur-md"
      style={{ height: NAV_HEIGHT }}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <BrandLogo />
        <div className="flex items-center gap-1 sm:gap-3">
          <Button size="sm" onClick={onChooseProduct} className="h-10 rounded-lg px-4">
            <span className="hidden sm:inline">{primaryActionLabel}</span>
            <span className="sm:hidden">Products</span>
            <ChevronDown aria-hidden />
          </Button>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a href={supportHref} onClick={onSupportClick}>
              <Headset aria-hidden className="sm:hidden" />
              <span className="hidden sm:inline">{supportLabel ?? "Support workspace"}</span>
              <span className="sm:hidden">Support</span>
            </a>
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
  engine,
  primaryActionLabel,
  primaryActionNote,
  onChooseProduct,
}: WithChoose) {
  return (
    <div className="flex max-w-4xl flex-col items-center gap-5 text-center">
      <p className="rounded-full border border-border bg-surface px-3.5 py-1 text-[13px] font-medium text-muted-foreground">
        {tagline}
      </p>
      <h1 className="text-[clamp(2.5rem,5.6vw,4.5rem)] leading-[1.04] font-extrabold tracking-[-0.04em]">
        <SandHighlight text={title} highlight={titleHighlight} />
      </h1>
      <p className="max-w-3xl text-[clamp(1.1rem,1.9vw,1.45rem)] text-muted-foreground">
        {description}
      </p>
      {engine && (
        <p className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 rounded-2xl border border-reactor-ink/15 bg-surface px-3 py-2 text-[15px] shadow-[var(--glow)]">
          <span className="text-muted-foreground">Powered by</span>
          <ReactorMark size="lg" label={engine.name} />
          <span className="font-reactor text-[13px] tracking-[0.04em] text-foreground">
            {engine.description}
          </span>
        </p>
      )}
      <div className="flex flex-col items-center gap-3 pt-2">
        <Button
          size="lg"
          onClick={onChooseProduct}
          className="h-12 rounded-lg px-8 text-base shadow-[var(--glow)]"
        >
          {primaryActionLabel}
          <ArrowRight aria-hidden />
        </Button>
        {primaryActionNote && (
          <span className="text-xs text-muted-foreground">{primaryActionNote}</span>
        )}
      </div>
    </div>
  );
}

function Hero(props: WithChoose & { animate: boolean }) {
  return (
    <section
      aria-label="Introduction"
      className="relative px-4 pb-12 sm:px-6"
      style={{ paddingTop: NAV_HEIGHT + 48 }}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-12">
        <HeroCopy {...props} />
        {props.aside && (
          <motion.div
            className="w-full"
            initial={props.animate ? { opacity: 0, y: 28, scale: 0.98 } : false}
            animate={props.animate ? { opacity: 1, y: 0, scale: 1 } : undefined}
            transition={{ ease: "easeOut", duration: 0.7, delay: 0.1 }}
          >
            {props.aside}
          </motion.div>
        )}
      </div>
    </section>
  );
}
