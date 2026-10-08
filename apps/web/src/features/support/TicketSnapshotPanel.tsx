import type { ReactNode } from "react";
import { ASSESSMENT_LABELS, SOURCE_TYPE_LABELS, type Ticket } from "@symptomsketch/contracts";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatTakeNumber, formatTimestamp } from "@/lib/format";
import { AttachmentCard } from "./AttachmentCard";
import { STAFF_REVIEW_LABELS, STAFF_TICKET_STATUS_LABELS, shortHash } from "./labels";
import { sortAttachments } from "./model";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="hud-label">{label}</dt>
      <dd className="text-sm leading-relaxed break-words">{children}</dd>
    </div>
  );
}

/** Staff view of the immutable submitted snapshot and the customer's attachments. */
export function TicketSnapshotPanel({ ticket }: { ticket: Ticket }) {
  const s = ticket.snapshot;
  const customerAttachments = sortAttachments(
    ticket.attachments.filter((a) => a.purpose !== "support_reply_take"),
  );

  return (
    <section aria-labelledby="ticket-snapshot-title" className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-neon/40 bg-neon-soft text-neon">
            {STAFF_TICKET_STATUS_LABELS[ticket.status]}
          </Badge>
          <Badge variant="outline">{s.purposeLabel}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{ticket.queue}</span>
        </div>
        <h1 id="ticket-snapshot-title" className="text-2xl font-semibold">
          {s.productLabel}
          {s.modelLabel ? <span className="text-muted-foreground"> · {s.modelLabel}</span> : null}
        </h1>
        <p className="text-sm text-muted-foreground">
          {s.caseTitle} · {SOURCE_TYPE_LABELS[s.sourceType]} · submitted{" "}
          <time dateTime={s.submittedAt}>{formatTimestamp(s.submittedAt)}</time>
        </p>
      </header>

      <dl className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Original account">
            <blockquote className="border-l-2 border-neon/60 pl-3 whitespace-pre-wrap">
              {s.originalAccount || "Not provided"}
            </blockquote>
          </Field>
        </div>
        <Field label="Actions tried">
          <span className="whitespace-pre-wrap">{s.actionsTried || "None listed"}</span>
        </Field>
        <Field label="Unresolved details">
          {s.unresolved.length > 0 ? (
            <ul className="list-disc pl-4">
              {s.unresolved.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          ) : (
            "None listed"
          )}
        </Field>
        <Field label="Visual check">
          <span className="font-medium">{ASSESSMENT_LABELS[s.assessmentStatus]}</span>
          {s.assessmentSummary ? (
            <span className="block text-muted-foreground">{s.assessmentSummary}</span>
          ) : null}
        </Field>
        <Field label="Customer review">
          {STAFF_REVIEW_LABELS[s.reviewState]}
          {s.uncertaintyNote ? (
            <span className="mt-1 block rounded-md border border-warning/40 bg-surface-2 p-2 text-warning">
              Review note: {s.uncertaintyNote}
            </span>
          ) : null}
        </Field>
        <Field label={s.takeNumber === null ? "Submitted story" : "Submitted clip"}>
          {s.takeNumber === null ? s.caption : `${formatTakeNumber(s.takeNumber)} · ${s.caption}`}
          {s.durationMs !== null ? ` · ${formatDuration(s.durationMs)}` : ""}
          {s.finalSha256 ? (
            <span className="block font-mono text-xs text-muted-foreground" title={s.finalSha256}>
              sha {shortHash(s.finalSha256)}
            </span>
          ) : null}
        </Field>
        <Field label="Customer message">
          <span className="whitespace-pre-wrap">{s.message}</span>
        </Field>
      </dl>

      <section aria-labelledby="ticket-attachments-title" className="flex flex-col gap-3">
        <h2 id="ticket-attachments-title" className="hud-label">
          Submitted attachments ({customerAttachments.length})
        </h2>
        {customerAttachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attachments on this ticket.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {customerAttachments.map((a) => (
              <AttachmentCard
                key={a.id}
                ticketId={ticket.id}
                attachment={a}
                criticOverride={ticket.snapshot.criticOverride ?? null}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
