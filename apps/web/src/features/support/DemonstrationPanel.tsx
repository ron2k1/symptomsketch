import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clapperboard, ExternalLink, LoaderCircle } from "lucide-react";
import { APP_PATHS, LIMITS, type Ticket } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { createWorkCase, errorMessage } from "@/lib/api";
import { formatTakeNumber } from "@/lib/format";
import { DEMO_CREATE_BUTTON_ID } from "./labels";
import { useIdempotencyKey } from "./useIdempotencyKey";

/**
 * Reply with a demonstration (spec 5): the server copies the submitted reference into an
 * agent-owned solution work case linked to this ticket, then the agent builds the clip in the same
 * workspace (which renders solution mode for work cases).
 */
export function DemonstrationPanel({ ticket }: { ticket: Ticket }) {
  const navigate = useNavigate();
  const key = useIdempotencyKey();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoked = ticket.status === "revoked";
  const existing = ticket.workCaseIds;

  async function onCreate() {
    if (creating || revoked) return;
    setCreating(true);
    setError(null);
    const { takeNumber, productLabel } = ticket.snapshot;
    const title = `Demonstration for ${formatTakeNumber(takeNumber)} · ${productLabel}`;
    try {
      const { caseId } = await createWorkCase(ticket.id, {
        idempotencyKey: key.get(),
        title: title.slice(0, LIMITS.titleMaxChars),
      });
      key.rotate();
      navigate(APP_PATHS.caseTab(caseId, "issue"));
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  }

  return (
    <section
      aria-labelledby="demo-panel-title"
      className="flex flex-col gap-3 rounded-xl border border-magenta/40 bg-card p-4"
    >
      <h2 id="demo-panel-title" className="hud-label text-magenta">
        Reply with a demonstration
      </h2>
      <p className="text-sm text-muted-foreground">
        Builds an instructional clip from the submitted reference in your own work case. Accept the
        clip there, then attach it to a reply here.
      </p>
      {existing.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {existing.map((id, i) => (
            <li key={id}>
              <Button asChild variant="outline" className="min-h-11">
                <Link to={APP_PATHS.caseTab(id, "recreate")}>
                  <ExternalLink aria-hidden />
                  Open demonstration workspace{existing.length > 1 ? ` ${i + 1}` : ""}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        id={DEMO_CREATE_BUTTON_ID}
        type="button"
        variant={existing.length > 0 ? "ghost" : "default"}
        className="min-h-11 self-start"
        onClick={() => void onCreate()}
        disabled={creating || revoked}
        aria-busy={creating || undefined}
      >
        {creating ? (
          <LoaderCircle className="animate-spin" aria-hidden />
        ) : (
          <Clapperboard aria-hidden />
        )}
        {creating
          ? "Creating work case"
          : existing.length > 0
            ? "Start another demonstration"
            : "Reply with a demonstration"}
      </Button>
    </section>
  );
}
