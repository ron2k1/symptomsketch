import { useEffect, useRef, useState, type FormEvent } from "react";
import { Hand, Mic, MicOff, PhoneOff, Send, Video } from "lucide-react";
import {
  LIMITS,
  SUPPORT_CALL_AGENT_NAME,
  SUPPORT_CALL_COPY,
  SUPPORT_CALL_PHASE_LABELS,
} from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSupportCall } from "./call/CallProvider";
import { SamVideo } from "./call/SamVideo";
import {
  INITIAL_CALL_VIEW,
  formatClock,
  type CallEnded,
  type CallView,
} from "./support-call-model";

const BASE_PORTRAIT = { src: "/assets/support-agent.jpg", width: 860, height: 1152 } as const;

export function SupportCallCredits({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5 text-xs text-muted-foreground", className)}>
      <p>
        {SUPPORT_CALL_COPY.modelCredit} ·{" "}
        <span className="font-reactor">{SUPPORT_CALL_COPY.modelName}</span>
      </p>
      <p>{SUPPORT_CALL_COPY.portraitCredit}</p>
    </div>
  );
}

function Transcript({ view }: { view: CallView }) {
  const listRef = useRef<HTMLOListElement>(null);
  const { lines, interim } = view.transcript;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, interim.character, interim.user]);
  const label = (speaker: "user" | "character") =>
    speaker === "user" ? "You" : `${SUPPORT_CALL_AGENT_NAME} (AI)`;
  const empty = lines.length === 0 && !interim.character && !interim.user;
  return (
    <ol
      ref={listRef}
      aria-label="Call transcript"
      className="flex max-h-64 min-h-24 flex-col gap-2 overflow-y-auto rounded-lg border bg-surface-2 p-3 text-sm"
    >
      {empty ? (
        <li className="text-muted-foreground">The transcript appears here as you talk.</li>
      ) : null}
      {lines.map((line) => (
        <li key={line.id} className="flex flex-col">
          <span className="text-xs font-medium text-muted-foreground">
            {label(line.speaker)}
            {line.typed ? " · typed" : ""}
          </span>
          <span>{line.text}</span>
        </li>
      ))}
      {(["character", "user"] as const).map((speaker) =>
        interim[speaker] ? (
          <li key={`interim-${speaker}`} className="flex flex-col text-muted-foreground">
            <span className="text-xs font-medium">{label(speaker)} · speaking</span>
            <span className="italic">{interim[speaker]}</span>
          </li>
        ) : null,
      )}
    </ol>
  );
}

export interface SupportCallProps {
  ticketId: string;
  /** Called once after a call that produced transcript lines has ended and its save settled. */
  onEnded?(ended: CallEnded): void;
}

/**
 * "Talk to support now": a live call with a fictional, clearly-AI support agent (Reactor Vidu S2
 * Avatar) who already knows this ticket. Voice (mic only after the customer turns it on) or typed
 * messages; capped at about four minutes; ends and disconnects on End call, unmount or page hide.
 */
export function SupportCall({ ticketId, onEnded }: SupportCallProps) {
  const call = useSupportCall();
  // The call lives in the app-root CallProvider; this view shows it when it is about this ticket.
  const mine = call.ticketId === ticketId;
  const view = mine ? call.view : INITIAL_CALL_VIEW;
  const saveState = mine ? call.saveState : "idle";
  const elsewhere = !mine && call.view.phase !== "idle" && call.view.phase !== "ended";
  const [draft, setDraft] = useState("");
  const idle = view.phase === "idle";
  const live = view.phase === "live";
  const active = !idle && view.phase !== "ended";

  const { registerFullView, onEnded: subscribeEnded } = call;
  useEffect(() => (mine ? registerFullView() : undefined), [mine, registerFullView]);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    endedRef.current = onEnded;
  }, [onEnded]);
  useEffect(
    () =>
      subscribeEnded((id, ended) => {
        if (id === ticketId) endedRef.current?.(ended);
      }),
    [subscribeEnded, ticketId],
  );

  function start() {
    call.start(ticketId);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await call.say(draft)) setDraft("");
  }

  return (
    <section
      aria-labelledby="support-call-title"
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <div className="flex items-start gap-4">
        {idle ? (
          <img
            src={BASE_PORTRAIT.src}
            width={BASE_PORTRAIT.width}
            height={BASE_PORTRAIT.height}
            alt=""
            className="h-24 w-[4.5rem] shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id="support-call-title" className="text-base font-semibold">
            Talk to {SUPPORT_CALL_AGENT_NAME}, an AI support agent
          </h3>
          <p className="text-sm text-muted-foreground">
            {SUPPORT_CALL_AGENT_NAME} has read this ticket and watched your clip, and talks you
            through a few checks by voice or text. Calls stop after{" "}
            {Math.round(LIMITS.supportCallClientMaxMs / 60_000)} minutes. Your ticket stays open for
            Demo Support.
          </p>
        </div>
      </div>

      {idle ? null : (
        <div className="relative mx-auto aspect-[864/1152] w-full max-w-sm overflow-hidden rounded-xl bg-sand-soft">
          <SamVideo media={view.media} />
          {!view.hasVideo && view.portraitUrl ? (
            <img
              src={view.portraitUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-70"
            />
          ) : null}
          <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
            <span
              role="status"
              className={cn(
                "rounded-full bg-surface/90 px-3 py-1 text-xs font-medium",
                live && "text-primary",
              )}
            >
              {SUPPORT_CALL_PHASE_LABELS[view.phase]}
            </span>
            {live || view.phase === "ended" ? (
              <span className="rounded-full bg-surface/90 px-3 py-1 font-mono text-xs tabular-nums">
                {formatClock(view.elapsedSeconds)} / {formatClock(view.capSeconds)}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {view.detail && active ? (
        <p className="text-sm text-muted-foreground">{view.detail}…</p>
      ) : null}
      {view.error ? (
        <p role="alert" className="text-sm text-destructive">
          {view.error}
        </p>
      ) : null}

      {idle || view.phase === "ended" ? (
        <div className="flex flex-col items-start gap-2">
          <Button type="button" className="min-h-11" disabled={elsewhere} onClick={start}>
            <Video aria-hidden />
            {idle ? SUPPORT_CALL_COPY.start : "Talk to support again"}
          </Button>
          {elsewhere ? (
            <p role="status" className="text-sm text-muted-foreground">
              A call with {SUPPORT_CALL_AGENT_NAME} is running on another ticket. End it first.
            </p>
          ) : null}
          {view.phase === "ended" && saveState !== "idle" ? (
            <p
              role="status"
              className={cn(
                "text-sm",
                saveState === "failed" ? "text-warning" : "text-muted-foreground",
              )}
            >
              {saveState === "saving"
                ? "Adding the call transcript to your ticket…"
                : saveState === "saved"
                  ? SUPPORT_CALL_COPY.transcriptSaved
                  : SUPPORT_CALL_COPY.transcriptFailed}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={view.micOn ? "secondary" : "outline"}
            className="min-h-11"
            aria-pressed={view.micOn}
            disabled={!live}
            onClick={call.toggleMic}
          >
            {view.micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
            {view.micOn ? "Mic on" : "Turn mic on"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!live}
            onClick={call.interrupt}
          >
            <Hand aria-hidden />
            Interrupt
          </Button>
          <Button type="button" variant="destructive" className="min-h-11" onClick={call.end}>
            <PhoneOff aria-hidden />
            End call
          </Button>
        </div>
      )}
      {view.micNotice ? <p className="text-sm text-warning">{view.micNotice}</p> : null}

      {!idle ? (
        <>
          <Transcript view={view} />
          <form className="flex gap-2" onSubmit={(e) => void submit(e)}>
            <Input
              aria-label={`Type a message to ${SUPPORT_CALL_AGENT_NAME}`}
              placeholder={live ? "Type instead of talking" : "Available once the call is live"}
              value={draft}
              maxLength={LIMITS.supportCallSayMaxChars}
              disabled={!live}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-11"
            />
            <Button type="submit" className="min-h-11" disabled={!live || !draft.trim()}>
              <Send aria-hidden />
              Send
            </Button>
          </form>
        </>
      ) : null}

      <SupportCallCredits />
    </section>
  );
}
