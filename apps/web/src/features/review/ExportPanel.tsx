import { useEffect, useRef, useState } from "react";
import { ArrowRight, Copy, Download, LoaderCircle, RefreshCw } from "lucide-react";
import type { MediaAsset, Take } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, getTakeMessage, mediaUrls } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";

interface ExportPanelProps {
  take: Take;
  /** Untouched original reference photo this take used. */
  original: MediaAsset | null;
  continueLabel: string;
  onContinue(): void;
  announce(text: string): void;
}

type CopyState = "idle" | "copied" | "manual";

/**
 * Accepted take handoff (spec 6 "Review and export state", spec 13): Download MP4, an editable
 * email explanation with clipboard copy and a manual-copy fallback, Download original, and
 * Continue to Support, which sends nothing by itself.
 */
export function ExportPanel({
  take,
  original,
  continueLabel,
  onContinue,
  announce,
}: ExportPanelProps) {
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    getTakeMessage(take.id)
      .then((msg) => {
        if (active) setText(`Subject: ${msg.subject}\n\n${msg.body}`);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [take.id, reloadToken]);

  function retryLoad() {
    setLoadError(null);
    setReloadToken((n) => n + 1);
  }

  async function copy() {
    if (text === null) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      announce("Message copied");
    } catch {
      setCopyState("manual");
      announce("Copy did not work. Select the message text and copy it manually.");
      requestAnimationFrame(() => areaRef.current?.select());
    }
  }

  const downloadUrl = take.downloadUrl ?? mediaUrls.takeDownload(take.id);
  const originalUrl = original
    ? (original.downloadUrl ?? mediaUrls.assetDownload(original.id))
    : null;

  return (
    <section aria-labelledby={`export-${take.id}`} className="space-y-3">
      <h3 id={`export-${take.id}`} className="hud-label">
        Ready to attach to your message
      </h3>
      <div className="flex flex-wrap gap-2">
        <Button asChild className="min-h-11">
          <a href={downloadUrl} download>
            <Download aria-hidden />
            Download MP4
            <span className="font-mono text-[12px] opacity-80">
              {formatBytes(take.sizeBytes)} / {formatDuration(take.durationMs)}
            </span>
          </a>
        </Button>
        {originalUrl ? (
          <Button asChild variant="outline" className="min-h-11">
            <a href={originalUrl} download>
              <Download aria-hidden />
              Download original
            </a>
          </Button>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`email-${take.id}`}>Email explanation (you can edit it)</Label>
        {text === null && !loadError ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Preparing the explanation
          </p>
        ) : null}
        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
            {loadError}
            <Button type="button" variant="outline" size="sm" onClick={retryLoad}>
              <RefreshCw aria-hidden />
              Retry
            </Button>
          </div>
        ) : null}
        {text !== null ? (
          <Textarea
            id={`email-${take.id}`}
            ref={areaRef}
            rows={copyState === "manual" ? 10 : 6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCopyState("idle");
            }}
          />
        ) : null}
        {copyState === "manual" ? (
          <p role="alert" className="text-sm text-warning">
            Clipboard access was blocked. The text above is selected: press Ctrl+C (Cmd+C on a Mac)
            to copy it.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={text === null}
            onClick={copy}
          >
            <Copy aria-hidden />
            Copy email explanation
          </Button>
          {copyState === "copied" ? (
            <span className="text-sm text-success">Message copied</span>
          ) : null}
        </div>
        <p className="text-[12px] text-muted-foreground">
          Nothing is emailed for you. Attach the downloaded MP4 to your own message.
        </p>
      </div>

      <Button type="button" variant="outline" className="min-h-11" onClick={onContinue}>
        {continueLabel}
        <ArrowRight aria-hidden />
      </Button>
    </section>
  );
}
