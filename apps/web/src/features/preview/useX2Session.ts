import { useEffect, useState } from "react";
import {
  INITIAL_SESSION_VIEW,
  PreviewController,
  type PreviewProps,
  type SessionView,
} from "./preview-controller";

/**
 * Live Reactor X2 preview for one case. Nothing connects on mount: the caller invokes
 * `controller.start(video)` from an explicit user action. Generation then continues (connections
 * rotate and reconnect on their own) until Stop, unmount (leaving Recreate), a case or reference
 * change, lease loss, or about 2 minutes in a hidden tab.
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
    const onVisibility = () => controller.setHidden(document.visibilityState === "hidden");
    onVisibility();
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      void controller.stop("unmount");
    };
  }, [controller]);

  return { view, controller };
}
