/**
 * Development showcase for the adapted hero (spec 25 correction 12). NOT routed in the app.
 * Supplies a typed fixture and no-op handlers so the component can be viewed in isolation.
 * The fixture rows are labeled examples; selecting them creates nothing and calls no API.
 */
import { useState } from "react";
import {
  SmoothScrollHero,
  type HeroProduct,
  type ProductSelectionState,
} from "@/components/ui/modern-hero";
import { ExampleWorkspace } from "@/features/landing/ExampleWorkspace";
import {
  HERO_PARALLAX_IMAGES,
  HERO_STAGE_IMAGE,
  LANDING_COPY,
  UPLOAD_PRODUCT_ROW,
} from "@/features/landing/landing-content";

export const DEMO_PRODUCTS: readonly HeroProduct[] = [
  {
    id: "robot-vacuum",
    name: "Robot vacuum",
    category: "Home robotics",
    description: "Showcase fixture · selecting it does nothing",
    image: {
      src: "/assets/demo-vacuum.jpg",
      alt: "A white round robot vacuum cleaner on a gray area rug.",
      width: 1600,
      height: 1067,
    },
    entry: { kind: "demo", fixtureId: "robot-vacuum" },
    actionLabel: "Start demo",
  },
  UPLOAD_PRODUCT_ROW,
];

export function DemoOne() {
  const [selection, setSelection] = useState<ProductSelectionState>({ status: "idle" });
  return (
    <SmoothScrollHero
      tagline={LANDING_COPY.tagline}
      title={LANDING_COPY.title}
      titleHighlight={LANDING_COPY.titleHighlight}
      description={LANDING_COPY.description}
      primaryActionLabel={LANDING_COPY.primaryAction}
      heroImage={HERO_STAGE_IMAGE}
      parallaxImages={HERO_PARALLAX_IMAGES}
      aside={<ExampleWorkspace />}
      productsHeading={LANDING_COPY.productsHeading}
      productsIntro="Showcase only. These rows are fixtures with no-op handlers."
      products={DEMO_PRODUCTS}
      featuredProductId="robot-vacuum"
      selectionState={selection}
      onSelectProduct={(productId) =>
        setSelection({
          status: "error",
          productId,
          message: "Showcase rows are not connected to the API.",
        })
      }
      onUploadPhoto={() => setSelection({ status: "idle" })}
      supportHref="/support"
    />
  );
}
