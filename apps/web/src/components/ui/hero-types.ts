/** Public prop + data types for SmoothScrollHero (modern-hero.tsx) and its product rows. */
import type { ReactNode } from "react";

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
  /** Word inside `title` that gets the sand underline. */
  titleHighlight?: string;
  description: string;
  /** "Powered by" line under the headline: the engine name renders as the ReactorMark chip. */
  engine?: { name: string; description: string };
  primaryActionLabel: string;
  /** One truthful line under the primary action (e.g. where the live session starts). */
  primaryActionNote?: string;
  /** Parent-owned illustration shown under the copy (e.g. the Example workspace). */
  aside?: ReactNode;
  productsHeading: string;
  /** Word inside `productsHeading` that gets the sand underline. */
  productsHeadingHighlight?: string;
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
