import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLenis } from "lenis/react";
import { Info } from "lucide-react";
import { APP_PATHS } from "@symptomsketch/contracts";
import {
  SmoothScrollHero,
  type HeroProductId,
  type ProductSelectionState,
} from "@/components/ui/modern-hero";
import { createCase, errorMessage } from "@/lib/api";
import { newClientRequestId } from "@/lib/ids";
import { useCustomerAccess } from "@/features/access/useCustomerAccess";
import { PhotoIntake, type PhotoIntakeHandle } from "@/features/intake/PhotoIntake";
import { usePhotoIntake } from "@/features/intake/usePhotoIntake";
import { ExampleWorkspace } from "./ExampleWorkspace";
import {
  FEATURED_PRODUCT_ID,
  HERO_PARALLAX_IMAGES,
  HERO_STAGE_IMAGE,
  LANDING_COPY,
  UPLOAD_PRODUCT_ID,
  UPLOAD_PRODUCT_ROW,
  toHeroProduct,
} from "./landing-content";
import { useCatalog } from "./useCatalog";

/**
 * Route "/": cyber landing built on the adapted SmoothScrollHero (spec 6, 25).
 * Owns the catalog fetch, product selection, the access-code gate and case creation.
 * Nothing here calls Gemini or Reactor; selecting a product only creates the owned case.
 */
export function LandingPage() {
  const navigate = useNavigate();
  const catalog = useCatalog();
  const access = useCustomerAccess();
  const [selection, setSelection] = useState<ProductSelectionState>({ status: "idle" });
  const requestIds = useRef(new Map<HeroProductId, string>());
  const intakeRef = useRef<PhotoIntakeHandle>(null);
  const lenis = useLenis();

  const openCase = useCallback(
    (caseId: string) => {
      // Start the workspace at the top; Lenis must do it so its own state stays in sync.
      if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
      else window.scrollTo(0, 0);
      navigate(APP_PATHS.caseTab(caseId, "issue"));
    },
    [lenis, navigate],
  );

  const intake = usePhotoIntake(access, openCase);
  const intakeBusy = intake.phase.kind === "submitting";

  // Lenis would keep scrolling the page behind the modal access sheet.
  useEffect(() => {
    if (!lenis) return;
    if (access.dialogOpen) lenis.stop();
    else lenis.start();
  }, [access.dialogOpen, lenis]);

  const heroProducts = useMemo(
    () => [...catalog.products.map(toHeroProduct), UPLOAD_PRODUCT_ROW],
    [catalog.products],
  );

  const onSelectProduct = useCallback(
    async (productId: HeroProductId) => {
      if (selection.status === "pending" || intakeBusy) return;
      const product = catalog.products.find((p) => p.id === productId);
      if (!product) return;
      setSelection({ status: "pending", productId });
      const clientRequestId = requestIds.current.get(productId) ?? newClientRequestId();
      requestIds.current.set(productId, clientRequestId);
      try {
        const outcome = await access.run(
          () =>
            createCase({
              purpose: "problem",
              title: product.name,
              fixtureId: product.id,
              clientRequestId,
            }),
          product.name,
        );
        if (!outcome.granted) {
          setSelection({ status: "idle" });
          return;
        }
        requestIds.current.delete(productId);
        openCase(outcome.value.case.id);
      } catch (err) {
        setSelection({ status: "error", productId, message: errorMessage(err) });
      }
    },
    [access, catalog.products, intakeBusy, openCase, selection.status],
  );

  const onUploadPhoto = useCallback(() => {
    if (selection.status === "pending") return;
    setSelection({ status: "idle" });
    intakeRef.current?.openPicker();
  }, [selection.status]);

  const heroSelection: ProductSelectionState = intakeBusy
    ? { status: "pending", productId: UPLOAD_PRODUCT_ID }
    : selection;

  return (
    <>
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
        productsIntro={LANDING_COPY.productsIntro}
        products={heroProducts}
        productsStatus={catalog.status}
        productsError={catalog.status === "error" ? catalog.message : null}
        onRetryProducts={catalog.reload}
        featuredProductId={FEATURED_PRODUCT_ID}
        selectionState={heroSelection}
        onSelectProduct={onSelectProduct}
        onUploadPhoto={onUploadPhoto}
        supportHref={APP_PATHS.supportInbox()}
        supportLabel={LANDING_COPY.supportLink}
        onNavigate={(href) => navigate(href)}
        productsFooter={
          <>
            <PhotoIntake
              ref={intakeRef}
              intake={intake}
              disabled={selection.status === "pending"}
              notes={[LANDING_COPY.retentionNote, LANDING_COPY.processingNote]}
            />
            <p className="mt-6 flex items-start gap-2 text-sm text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-neon" />
              <span>{LANDING_COPY.demoDisclosure}</span>
            </p>
          </>
        }
      />
      <footer className="border-t border-border px-4 py-8 text-center">
        <p className="hud-label">
          SymptomSketch · Generated clips illustrate what you describe. They do not diagnose a
          fault.
        </p>
      </footer>
      {access.dialog}
    </>
  );
}
