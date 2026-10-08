import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, LoaderCircle, Send } from "lucide-react";
import { APP_PATHS, type StorySubmitResponse } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { beatsUpload, sendStory } from "./story-api";
import type { PlayedBeat } from "./story-state";
import type { StoryRecorder } from "./useStoryRecorder";

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; result: StorySubmitResponse }
  | { kind: "error"; message: string };

/** Shown once the story ends: the recorded reel (exactly what played), then send it to support. */
export function StorySendPanel({
  caseId,
  beats,
  recorder,
  clipSeconds,
}: {
  caseId: string;
  beats: PlayedBeat[];
  recorder: StoryRecorder;
  clipSeconds: number;
}) {
  const result = recorder.result;
  const reel = result?.reel ?? null;
  const [reelUrl, setReelUrl] = useState<string | null>(null);
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  useEffect(() => {
    if (!reel) return;
    const url = URL.createObjectURL(reel);
    setReelUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reel]);

  const onSend = async () => {
    if (!reel || beats.length === 0) return;
    setSend({ kind: "sending" });
    try {
      const out = await sendStory(caseId, {
        reel,
        frame: result?.frame ?? null,
        beats: beatsUpload(beats, clipSeconds, result?.durationMs ?? 0),
      });
      setSend({ kind: "sent", result: out });
    } catch (err) {
      setSend({ kind: "error", message: errorMessage(err) });
    }
  };

  const supportTab = APP_PATHS.caseTab(caseId, "support");

  return (
    <section
      aria-labelledby="story-done-title"
      className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4"
    >
      <h2 id="story-done-title" className="text-sm font-semibold">
        Your story ({beats.length} {beats.length === 1 ? "scene" : "scenes"})
      </h2>
      {recorder.finishing ? (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Saving the recording
        </p>
      ) : result?.problem ? (
        <p className="text-sm text-muted-foreground">{result.problem}</p>
      ) : reelUrl ? (
        <video
          src={reelUrl}
          controls
          className="aspect-video w-full max-w-xl rounded-md bg-foreground"
          aria-label="Recording of your story"
        />
      ) : null}

      {reel && beats.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          {send.kind === "sent" ? (
            <div role="status" className="space-y-1 text-sm">
              <p className="inline-flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="size-4" aria-hidden />
                {send.result.ticketId ? "Sent to Demo Support" : "Saved to your case"}
              </p>
              <p className="text-muted-foreground">
                {send.result.ticketId
                  ? "Support sees the recording, every scene and the last frame on your ticket."
                  : "Support sees it on your ticket once you send one from the Support tab."}{" "}
                <Link to={supportTab} className="underline underline-offset-2">
                  Open the Support tab
                </Link>
              </p>
            </div>
          ) : (
            <>
              <Button
                type="button"
                className="min-h-11"
                onClick={() => void onSend()}
                disabled={send.kind === "sending"}
              >
                {send.kind === "sending" ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                {send.kind === "sending" ? "Sending" : "Send this story to support"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Sends the recording ({formatBytes(reel.size)}), the scenes with their captions and
                choices, and the last frame.
              </p>
              {send.kind === "error" ? (
                <p role="alert" className="text-sm text-destructive">
                  {send.message}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
