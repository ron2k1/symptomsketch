import { useEffect, useState } from "react";
import type { CatalogProduct, CatalogResponse } from "@symptomsketch/contracts";
import { getCatalog } from "@/lib/api";

let catalogRequest: Promise<CatalogResponse> | null = null;

function loadCatalog(): Promise<CatalogResponse> {
  if (!catalogRequest) {
    catalogRequest = getCatalog().catch((err: unknown) => {
      catalogRequest = null;
      throw err;
    });
  }
  return catalogRequest;
}

/** Catalog row for a demo fixture (display name + authored demo procedure). Null otherwise. */
export function useCatalogProduct(fixtureId: string | null | undefined): CatalogProduct | null {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  useEffect(() => {
    if (!fixtureId) return;
    let active = true;
    loadCatalog()
      .then((res) => {
        if (active) setProduct(res.products.find((p) => p.id === fixtureId) ?? null);
      })
      .catch(() => {
        // Catalog is only display metadata here; the case itself still renders.
      });
    return () => {
      active = false;
    };
  }, [fixtureId]);
  return fixtureId ? product : null;
}
