import { useMemo, useRef } from "react";
import { newIdempotencyKey } from "@/lib/ids";

/**
 * One idempotency key per logical submission. The same key is reused across retries of a failed or
 * timed-out request (the server returns the existing ticket/reply), and rotated only after a
 * confirmed success, a scope change, or a TICKET_CONFLICT.
 */
export function useIdempotencyKey() {
  const ref = useRef<string | null>(null);
  return useMemo(
    () => ({
      get(): string {
        if (ref.current === null) ref.current = newIdempotencyKey();
        return ref.current;
      },
      rotate(): void {
        ref.current = null;
      },
    }),
    [],
  );
}
