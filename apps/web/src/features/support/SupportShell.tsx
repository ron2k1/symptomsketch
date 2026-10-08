import type { ReactNode } from "react";
import { STAFF_HEADER_AREA, STAFF_HEADER_PRODUCT } from "./labels";

interface SupportShellProps {
  /** Right side of the staff header (e.g. Back to inbox, last refresh). */
  headerAction?: ReactNode;
  children: ReactNode;
}

/** Staff chrome for /support and /support/tickets/:id. */
export function SupportShell({ headerAction, children }: SupportShellProps) {
  return (
    <div className="cyber-grid min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
          <p className="truncate font-mono text-sm tracking-wide">
            <span className="text-neon">{STAFF_HEADER_PRODUCT}</span>
            <span className="text-muted-foreground"> · {STAFF_HEADER_AREA}</span>
          </p>
          {headerAction ? (
            <div className="flex shrink-0 items-center gap-3">{headerAction}</div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

/** Centered status line while the staff session is being checked. */
export function SupportChecking() {
  return (
    <p role="status" className="hud-label py-16 text-center">
      Checking staff session
    </p>
  );
}
