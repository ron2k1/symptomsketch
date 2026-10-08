import { useEffect } from "react";

export const APP_TITLE = "SymptomSketch";

/** "SymptomSketch | <part>"; empty parts are dropped, so no part gives the bare app name. */
export function pageTitle(...parts: Array<string | null | undefined>): string {
  const detail = parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" · ");
  return detail ? `${APP_TITLE} | ${detail}` : APP_TITLE;
}

/** Sets document.title for the current route view; every routed page calls this. */
export function useDocumentTitle(...parts: Array<string | null | undefined>): void {
  const title = pageTitle(...parts);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
