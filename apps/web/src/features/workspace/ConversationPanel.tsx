import { useRef } from "react";
import { CircleHelp, LoaderCircle, TriangleAlert } from "lucide-react";
import type {
  HighlightField,
  Message,
  MessageKind,
  PlanRevision,
  Purpose,
} from "@symptomsketch/contracts";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { CurrentDescription, type CurrentDescriptionHandle } from "./CurrentDescription";
import { HighlightLegend, HighlightedText } from "./HighlightedText";
import { currentPlan, messagesFor } from "./state";
import { useWorkspace } from "./WorkspaceProvider";

const KIND_LABELS: Record<MessageKind, string> = {
  account: "What happened",
  actions_tried: "What I tried",
  correction: "Correction",
  answer: "Answer",
  understanding: "Understanding",
  clarification: "Question",
};

function MessageItem({
  message,
  onSelectField,
}: {
  message: Message;
  onSelectField(field: HighlightField): void;
}) {
  const fromUser = message.role === "user";
  return (
    <li
      className={cn(
        "rounded-xl border p-3 shadow-[var(--glow)]",
        fromUser ? "border-field-border bg-field" : "border-neon/35 bg-neon-soft/40",
      )}
    >
      <p className="mb-1 flex items-baseline justify-between gap-2">
        <span className="hud-label">{KIND_LABELS[message.kind]}</span>
        <time className="font-mono text-[11px] text-muted-foreground" dateTime={message.createdAt}>
          {formatTimestamp(message.createdAt)}
        </time>
      </p>
      <p className="voice-bubble whitespace-pre-wrap text-foreground">
        <HighlightedText
          text={message.text}
          spans={message.highlights}
          messageId={message.id}
          onSelectField={onSelectField}
        />
      </p>
      <HighlightLegend text={message.text} spans={message.highlights} messageId={message.id} />
    </li>
  );
}

function Explanation({ plan }: { plan: PlanRevision }) {
  const p = plan.plan;
  return (
    <dl className="space-y-2.5 rounded-xl border border-border bg-card p-3 text-sm">
      <div>
        <dt className="hud-label">What I understood</dt>
        <dd className="mt-0.5">{p.understanding}</dd>
      </div>
      <div>
        <dt className="hud-label">What will stay the same</dt>
        <dd className="mt-0.5">
          {p.preservedDetails.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5">
              {p.preservedDetails.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">Nothing listed yet.</span>
          )}
        </dd>
      </div>
      <div>
        <dt className="hud-label">What is still unclear</dt>
        <dd className="mt-0.5">
          {p.context.unresolved.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5">
              {p.context.unresolved.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">Nothing open.</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** Right panel "Describe and refine" (spec 6 conversation). */
export function ConversationPanel({ purpose }: { purpose: Purpose }) {
  const ws = useWorkspace();
  const { state, dispatch, captureBusy } = ws;
  const descRef = useRef<CurrentDescriptionHandle>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const caseData = state.caseData;
  if (!caseData) return null;

  const plan = currentPlan(caseData, purpose);
  const messages = messagesFor(caseData, purpose);
  const planning = state.planning === purpose;
  const question = plan?.plan.clarificationQuestion ?? null;
  const referenceChanged =
    plan !== null &&
    caseData.productRevisionId !== null &&
    plan.productRevisionId !== caseData.productRevisionId;
  const draft = state.composer[purpose];

  let disabledReason: string | null = null;
  if (!plan) disabledReason = "Start from the Issue tab to create the first plan.";
  else if (captureBusy) disabledReason = "Corrections are paused until the recording ends.";
  else if (state.planning) disabledReason = "Updating the movement.";

  function onSelectField(field: HighlightField) {
    if (descRef.current?.focusField(field)) return;
    composerRef.current?.focus();
  }

  function submitComposer() {
    const text = draft.text.trim();
    if (!text) return;
    void ws.submitPlan(purpose, text, {
      fromComposer: true,
      isClarificationAnswer: question !== null,
    });
  }

  return (
    <section aria-labelledby="refine-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="refine-heading" className="text-base font-semibold">
        Describe and refine
      </h2>

      {messages.length > 0 ? (
        <ol className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1" aria-label="Conversation">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} onSelectField={onSelectField} />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your description and the planner&apos;s explanation appear here.
        </p>
      )}

      {planning ? (
        <p className="flex items-center gap-2 text-sm text-neon" aria-busy="true">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Understanding the action
        </p>
      ) : null}
      {state.planError && !planning ? (
        <p role="alert" className="flex gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {state.planError}
        </p>
      ) : null}

      {plan ? <Explanation plan={plan} /> : null}

      {question ? (
        <div className="flex gap-2 rounded-xl border border-magenta/50 bg-magenta-soft p-3 text-sm">
          <CircleHelp className="mt-0.5 size-4 shrink-0 text-magenta" aria-hidden />
          <p>
            <span className="hud-label block">One question</span>
            {question}
          </p>
        </div>
      ) : null}

      {plan && plan.status === "invalid" && plan.validationIssues.length > 0 ? (
        <div role="alert" className="rounded-xl border border-warning/50 p-3 text-sm">
          <p className="font-medium">This description cannot be previewed yet.</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {plan.validationIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {referenceChanged ? (
        <p className="rounded-xl border border-warning/50 p-3 text-sm">
          The product photo changed. Send a correction to update the preview for the new photo.
        </p>
      ) : null}

      {plan ? (
        <CurrentDescription
          key={plan.id}
          ref={descRef}
          plan={plan}
          disabled={captureBusy || state.planning !== null}
          onSubmit={(fieldEdits) => void ws.submitPlan(purpose, null, { fieldEdits })}
        />
      ) : null}

      <Composer
        ref={composerRef}
        value={draft.text}
        onChange={(text) => dispatch({ type: "composer_text", purpose, text })}
        onSubmit={submitComposer}
        disabled={!plan || captureBusy}
        busy={state.planning !== null}
        answering={question !== null}
        disabledReason={disabledReason}
      />
    </section>
  );
}
