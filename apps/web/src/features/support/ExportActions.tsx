import { useEffect, useId, useRef, useState } from "react";
import { Copy, Download, ImageDown } from "lucide-react";
import type { ProductRevision, Take } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { mediaUrls } from "@/lib/api";
import { formatBytes, formatDuration, formatTakeNumber } from "@/lib/format";
import { copyToClipboard } from "./clipboard";

interface ExportActionsProps {
  take: Take;
  product: ProductRevision | null;
  /** Current edited explanation (subject + body) for the selected take. */
  getCopyText(): string;
  copyDisabled?: boolean;
}

type CopyState = "idle" | "copied" | "manual";

/**
 * Manual handoff for an external email (spec 6, 13): exact MP4 download, copied explanation, and
 * the original photo. Nothing here sends anything; a successful copy only means clipboard text.
 */
export function ExportActions({ take, product, getCopyText, copyDisabled }: ExportActionsProps) {
  const manualId = useId();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [manualText, setManualText] = useState("");
  const manualRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setCopyState("idle");
  }, [take.id]);

  useEffect(() => {
    if (copyState === "manual") {
      manualRef.current?.focus();
      manualRef.current?.select();
    }
  }, [copyState]);

  async function onCopy() {
    const text = getCopyText();
    if (await copyToClipboard(text)) {
      setCopyState("copied");
    } else {
      setManualText(text);
      setCopyState("manual");
    }
  }

  const mp4Href = take.downloadUrl ?? mediaUrls.takeDownload(take.id);
  const originalHref = product ? (product.original.downloadUrl ?? null) : null;

  return (
    <section aria-label="Download and copy for email" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="min-h-11">
          <a href={mp4Href} download>
            <Download aria-hidden />
            Download MP4
            <span className="sr-only">
              {" "}
              for {formatTakeNumber(take.number)} ({formatBytes(take.sizeBytes)},{" "}
              {formatDuration(take.durationMs)})
            </span>
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void onCopy()}
          disabled={copyDisabled}
        >
          <Copy aria-hidden />
          Copy email explanation
        </Button>
        {originalHref ? (
          <Button asChild variant="ghost" className="min-h-11">
            <a href={originalHref} download>
              <ImageDown aria-hidden />
              Download original
            </a>
          </Button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-success">
        {copyState === "copied" ? "Message copied" : ""}
      </p>
      {copyState === "manual" ? (
        <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-surface-2 p-3">
          <label htmlFor={manualId} className="text-sm text-warning">
            The browser blocked clipboard access. Select the text below and press Ctrl+C (Cmd+C on
            Mac) to copy it.
          </label>
          <textarea
            id={manualId}
            ref={manualRef}
            readOnly
            value={manualText}
            onFocus={(e) => e.currentTarget.select()}
            rows={8}
            className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setCopyState("idle")}
          >
            Done
          </Button>
        </div>
      ) : null}
    </section>
  );
}
