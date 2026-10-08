import { LIMITS, type CatalogProduct } from "@symptomsketch/contracts";
import type { HeroImage, HeroProduct } from "@/components/ui/modern-hero";

/**
 * Landing copy + local imagery. Image dimensions mirror apps/web/public/assets/manifest.json
 * (assets agent, measured with ffprobe) so every <img> reserves its box before decode.
 */
export const LANDING_COPY = {
  tagline: "Changing the way support is given",
  title: "Show what happened.",
  titleHighlight: "happened",
  description: "Give support the context a phone call cannot.",
  primaryAction: "Choose your product",
  supportLink: "Support workspace",
  productsHeading: "What do you need help with?",
  productsHeadingHighlight: "help",
  productsIntro:
    "Pick a demo product to walk the full flow, or upload a photo of your own. Nothing is generated until you describe the issue in your case.",
  demoDisclosure: "Demo support is hosted inside SymptomSketch. No manufacturer is contacted.",
  retentionNote: `Cases and photos are kept for ${LIMITS.caseRetentionDays} days, then deleted. You can delete a case sooner from its workspace.`,
  processingNote:
    "Your photo and description are sent to Gemini and Reactor only when you ask for a plan or preview.",
} as const;

/** Static illustration content for the Example workspace frame (not a live case). */
export const EXAMPLE_WORKSPACE = {
  image: {
    src: "/assets/demo-vacuum.jpg",
    alt: "Example product photo: a white round robot vacuum on a gray rug in a living room.",
    width: 1600,
    height: 1067,
  } satisfies HeroImage,
  productName: "Robot vacuum",
  whatHappened: { before: "It jerks ", marks: ["backward", "once"], after: "." },
  clipDuration: "0:06",
} as const;

export const UPLOAD_PRODUCT_ID = "upload-photo";

export const FEATURED_PRODUCT_ID = "robot-vacuum";

/** Catalog row -> typed hero row ("Start demo"). */
export function toHeroProduct(product: CatalogProduct): HeroProduct {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    description: product.tagline,
    image: {
      src: product.landingImage,
      alt: product.alt,
      width: product.imageWidth,
      height: product.imageHeight,
    },
    entry: { kind: "demo", fixtureId: product.id },
    actionLabel: "Start demo",
  };
}

export const UPLOAD_PRODUCT_ROW: HeroProduct = {
  id: UPLOAD_PRODUCT_ID,
  name: "Your own product",
  category: "Upload a photo",
  description: "JPEG, PNG or WebP up to 10 MB. Add the model if you know it.",
  image: null,
  entry: { kind: "photo" },
  actionLabel: "Upload product",
};
