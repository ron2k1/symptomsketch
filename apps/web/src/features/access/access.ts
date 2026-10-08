import type { ErrorCode, SessionState } from "@symptomsketch/contracts";
import { isApiClientError } from "@/lib/api";

/** Mirrors the server's requireCustomerAccess guard: customer with the code, or support. */
export function hasCustomerAccess(session: SessionState): boolean {
  return session.authenticated && (session.accessGranted || session.role === "support");
}

const ACCESS_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "ACCESS_REQUIRED",
  "SESSION_EXPIRED",
]);

/** True when an API failure means "enter the access code again". */
export function isAccessError(err: unknown): boolean {
  return isApiClientError(err) && err.code !== "NETWORK_ERROR" && ACCESS_ERROR_CODES.has(err.code);
}
