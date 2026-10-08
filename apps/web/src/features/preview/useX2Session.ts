import { useEffect, useState } from "react";
import {
  INITIAL_SESSION_VIEW,
  PreviewController,
  type PreviewProps,
  type SessionView,
} from "./preview-controller";

/**
 * Live Reactor X2 preview for one case. Nothing connects on mount: the caller invokes
 * `controller.start(video)` from an explicit user action. Stops on unmount (leaving Recreate),
 * case change, reference change, idle, max, lease loss, and after a capture.
 */
export function useX2Session({ caseId, plan, referenceImageUrl }: PreviewProps): {
  view: SessionView;
  controller: PreviewController;
} {
  const [view, setView] = useState<SessionView>(INITIAL_SESSION_VIEW);
  const [controller] = useState(() => new PreviewController(setView));

  useEffect(() => {
    controller.setProps({ caseId, plan, referenceImageUrl });
  }, [controller, caseId, plan, referenceImageUrl]);

  // StrictMode re-runs this pair on mount; stop() with no session is a no-op.
  useEffect(() => {
    const onPageHide = () => controller.releaseOnPageHide();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void controller.stop("unmount");
    };
  }, [controller]);

  return { view, controller };
}
