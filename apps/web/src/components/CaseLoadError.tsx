import { Link } from "react-router-dom";
import { APP_PATHS } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";

const isAccessCode = (code: string) => code === "ACCESS_REQUIRED" || code === "SESSION_EXPIRED";

/**
 * A case route (workspace or story) whose GET /api/cases/:id failed. Cases are owner-only, so a
 * missing or expired session can never reopen this case: the screen says so and offers the
 * products, where the access code sheet starts a case of the visitor's own.
 */
export function CaseLoadError({ code, message }: { code: string; message: string }) {
  const needsAccess = isAccessCode(code);
  return (
    <div className="mx-auto max-w-md space-y-4 rounded-[var(--radius-card)] border border-border bg-card p-6 text-center">
      <h1 className="text-xl font-semibold">
        {needsAccess ? "This case belongs to another session" : "This case could not be opened"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {needsAccess
          ? "A case opens only in the browser session that started it. Start your own from the products; you enter the demo access code there."
          : message}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild className="min-h-11">
          <Link to={APP_PATHS.landing()}>Back to products</Link>
        </Button>
        {!needsAccess ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
