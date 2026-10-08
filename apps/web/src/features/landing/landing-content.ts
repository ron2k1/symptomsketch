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
  description:
    "Reactor X2 turns one photo of your product into a live, steerable reenactment of what it did. Steer it in plain words, clip the moment, and send support the clip.",
  engine: { name: "Reactor X2", description: "a real-time world model" },
  primaryAction: "Choose your product",
  primaryActionNote: "The live Reactor X2 session starts inside your case, not on this page.",
  supportLink: "Support workspace",
  productsHeading: "What do you need help with?",
  productsHeadingHighlight: "help",
  productsIntro:
    "Pick a demo product to walk the full flow, or upload a photo of your own. Nothing is generated until you describe the issue in your case.",
  demoDisclosure: "Demo support is hosted inside SymptomSketch. No manufacturer is contacted.",
  retentionNote: `Cases and photos are kept for ${LIMITS.caseRetentionDays} days, then deleted. You can delete a case sooner from its workspace.`,
  processingNote:
    "Your photo and description are sent to Gemini and Reactor X2 only when you ask for a plan or preview.",
} as const;

/** Static illustration content for the Example workspace frame (a real demo photo, not a take). */
export const EXAMPLE_WORKSPACE = {
  image: {
    src: "/assets/demo-vacuum.jpg",
    alt: "Example product photo: a white round robot vacuum on a gray rug in a living room.",
    width: 1600,
    height: 1067,
  } satisfies HeroImage,
  productName: "Robot vacuum",
  sourceCaption: "starts from your photo",
  whatHappened: { before: "It jerks ", marks: ["backward", "once"], after: "." },
  clipCardLabel: "Then: a clip you can share",
  clipCardNote: "Illustration of the flow. This is the example photo, not a generated clip.",
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
