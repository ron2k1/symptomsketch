import {
  SUPPORT_CALL_AGENT_NAME,
  SUPPORT_CALL_COPY,
  type SupportCallTranscript,
} from "@symptomsketch/contracts";
import { formatTimestamp } from "@/lib/format";
import { formatClock } from "./support-call-model";

const SPEAKER_LABEL = { user: "Customer", character: `${SUPPORT_CALL_AGENT_NAME} (AI)` } as const;

/**
 * Staff view of the customer's live AI support agent calls on this ticket, so a teammate can read
 * what the agent already suggested before replying. Renders nothing when there were no calls.
 */
export function CallTranscripts({
  transcripts,
}: {
  transcripts: readonly SupportCallTranscript[] | undefined;
}) {
  if (!transcripts || transcripts.length === 0) return null;
  return (
    <section aria-labelledby="call-transcripts-title" className="flex flex-col gap-3">
      <h2 id="call-transcripts-title" className="hud-label">
        {SUPPORT_CALL_COPY.transcriptHeading}
        {transcripts.length > 1 ? ` (${transcripts.length} calls)` : ""}
      </h2>
      <p className="text-xs text-muted-foreground">
        {SUPPORT_CALL_COPY.modelCredit} ·{" "}
        <span className="font-reactor">{SUPPORT_CALL_COPY.modelName}</span>. The agent is an AI;
        check its suggestions before you rely on them.
      </p>
      {transcripts.map((t) => (
        <article key={t.id} className="rounded-xl border bg-card p-4">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">
              Call · {formatClock(t.durationSeconds)}
              <span className="font-normal text-muted-foreground">
                {" · "}
                {t.lines.length} line{t.lines.length === 1 ? "" : "s"}
              </span>
            </p>
            <time className="font-mono text-xs text-muted-foreground" dateTime={t.createdAt}>
              {formatTimestamp(t.createdAt)}
            </time>
          </header>
          <ol className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto text-sm">
            {t.lines.map((line, i) => (
              <li key={i} className="flex flex-col">
                <span className="text-xs font-medium text-muted-foreground">
                  {SPEAKER_LABEL[line.speaker]}
                  {line.typed ? " · typed" : ""}
                </span>
                <span className="break-words whitespace-pre-wrap">{line.text}</span>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </section>
  );
}
