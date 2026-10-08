import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createSession, getSession } from "@/lib/api";
import { AccessCodeDialog } from "./AccessCodeDialog";
import { hasCustomerAccess, isAccessError } from "./access";

/**
 * Open-demo build for judges: the customer code is set only at build time (never committed), and
 * visitors are signed in with it instead of typing it. Unset in normal builds, which ask as before.
 */
const OPEN_DEMO_CODE: string = import.meta.env.VITE_OPEN_DEMO_CODE ?? "";

export type AccessOutcome<T> = { granted: true; value: T } | { granted: false };

export interface CustomerAccess {
  /** Resolves true once this browser has customer access (asks for the code if needed). */
  ensure: (context?: string, force?: boolean) => Promise<boolean>;
  /**
   * Run a paid-route action behind the access gate. If the cookie lapsed mid-flight
   * (ACCESS_REQUIRED / SESSION_EXPIRED) the code sheet reopens once and the action reruns.
   * The action must be safe to rerun (resume from saved progress).
   */
  run: <T>(action: () => Promise<T>, context?: string) => Promise<AccessOutcome<T>>;
  dialogOpen: boolean;
  /** Render once in the page. */
  dialog: ReactNode;
}

export function useCustomerAccess(): CustomerAccess {
  const [dialogState, setDialogState] = useState<{ open: boolean; context?: string }>({
    open: false,
  });
  const resolverRef = useRef<((granted: boolean) => void) | null>(null);

  const settle = useCallback((granted: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialogState({ open: false });
    resolve?.(granted);
  }, []);

  useEffect(() => () => resolverRef.current?.(false), []);

  const askForCode = useCallback(
    (context?: string) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current?.(false);
        resolverRef.current = resolve;
        setDialogState({ open: true, context });
      }),
    [],
  );

  const ensure = useCallback(
    async (context?: string, force = false) => {
      if (!force) {
        try {
          if (hasCustomerAccess(await getSession())) return true;
        } catch (err) {
          if (!isAccessError(err)) throw err;
        }
      }
      if (OPEN_DEMO_CODE) {
        try {
          if (hasCustomerAccess(await createSession(OPEN_DEMO_CODE))) return true;
        } catch {
          // Fall back to the code sheet.
        }
      }
      return askForCode(context);
    },
    [askForCode],
  );

  const run = useCallback(
    async <T,>(action: () => Promise<T>, context?: string): Promise<AccessOutcome<T>> => {
      if (!(await ensure(context))) return { granted: false };
      try {
        return { granted: true, value: await action() };
      } catch (err) {
        if (!isAccessError(err)) throw err;
        if (!(await ensure(context, true))) return { granted: false };
        return { granted: true, value: await action() };
      }
    },
    [ensure],
  );

  const dialog = (
    <AccessCodeDialog
      open={dialogState.open}
      context={dialogState.context}
      onGranted={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { ensure, run, dialogOpen: dialogState.open, dialog };
}
