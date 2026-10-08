import {
  PIP_WINDOW_SIZE,
  detectPipSupport,
  type PipEnvironment,
  type PipSupport,
} from "./call-model";

interface DocumentPictureInPicture {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

export function pipSupport(): PipSupport {
  if (typeof window === "undefined") return "none";
  return detectPipSupport(window as unknown as PipEnvironment);
}

/** Copy the app's stylesheets so the dock renders identically in the PiP document. */
function copyStyles(target: Document): void {
  const base = target.createElement("base");
  base.href = document.baseURI;
  target.head.append(base);
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      target.head.append(style);
    } catch {
      // Cross-origin sheet: its rules are unreadable, so link it instead.
      if (!sheet.href) continue;
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      target.head.append(link);
    }
  }
}

/** Open an always-on-top Document Picture-in-Picture window with the app's styles. */
export async function openDocumentPip(): Promise<Window> {
  const api = (window as unknown as { documentPictureInPicture: DocumentPictureInPicture })
    .documentPictureInPicture;
  const pip = await api.requestWindow({ ...PIP_WINDOW_SIZE });
  copyStyles(pip.document);
  pip.document.title = document.title;
  pip.document.documentElement.style.colorScheme = "light";
  pip.document.body.className = "m-0 bg-reactor-ink";
  return pip;
}
