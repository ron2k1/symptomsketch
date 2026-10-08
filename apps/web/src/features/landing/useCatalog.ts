import { useCallback, useEffect, useState } from "react";
import type { CatalogProduct } from "@symptomsketch/contracts";
import { errorMessage, getCatalog } from "@/lib/api";

export type CatalogState =
  | { status: "loading"; products: readonly CatalogProduct[] }
  | { status: "ready"; products: readonly CatalogProduct[] }
  | { status: "error"; products: readonly CatalogProduct[]; message: string };

/** GET /api/catalog (allowlisted demo fixtures; no provider calls). */
export function useCatalog(): CatalogState & { reload: () => void } {
  const [state, setState] = useState<CatalogState>({ status: "loading", products: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getCatalog()
      .then((res) => {
        if (active) setState({ status: "ready", products: res.products });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setState((prev) => ({
          status: "error",
          products: prev.products,
          message: `Demo products could not be loaded. ${errorMessage(err)}`,
        }));
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState((prev) => ({ status: "loading", products: prev.products }));
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, reload };
}
