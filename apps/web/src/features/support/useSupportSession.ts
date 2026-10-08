import { useCallback, useEffect, useState } from "react";
import { ERROR_COPY } from "@symptomsketch/contracts";
import { ApiClientError, createSupportSession, getSession } from "@/lib/api";

export type SupportSessionStatus = "checking" | "signed_out" | "support";

/**
 * Staff session gate. The role comes only from the server (GET /api/session after the HttpOnly
 * cookie is set by POST /api/support/session); nothing client-side can grant it.
 */
export function useSupportSession() {
  const [status, setStatus] = useState<SupportSessionStatus>("checking");
  const [customerSession, setCustomerSession] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((s) => {
        if (cancelled) return;
        if (s.authenticated && s.role === "support") {
          setStatus("support");
        } else {
          setCustomerSession(s.authenticated && s.role === "customer");
          setStatus("signed_out");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("signed_out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (supportCode: string) => {
    const s = await createSupportSession(supportCode);
    if (!s.authenticated || s.role !== "support") {
      throw new ApiClientError("SUPPORT_FORBIDDEN", ERROR_COPY.SUPPORT_FORBIDDEN, 403);
    }
    setExpired(false);
    setCustomerSession(false);
    setStatus("support");
  }, []);

  /** Called when an API call reports the staff session is gone. */
  const markSignedOut = useCallback(() => {
    setExpired(true);
    setStatus("signed_out");
  }, []);

  return { status, customerSession, expired, signIn, markSignedOut } as const;
}
