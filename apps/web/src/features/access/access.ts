import type { ErrorCode, SessionState } from "@symptomsketch/contracts";
import { isApiClientError } from "@/lib/api";

/**
 * A customer session that entered the code. A support login does not count: a case takes its
 * owner's role, so creating one from the landing page under a support cookie would make a staff
 * work case. Entering the customer code then issues a separate customer session.
 */
export function hasCustomerAccess(session: SessionState): boolean {
  return session.authenticated && session.role === "customer" && session.accessGranted;
}

const ACCESS_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "ACCESS_REQUIRED",
  "SESSION_EXPIRED",
]);

/** True when an API failure means "enter the access code again". */
export function isAccessError(err: unknown): boolean {
  return isApiClientError(err) && err.code !== "NETWORK_ERROR" && ACCESS_ERROR_CODES.has(err.code);
}
