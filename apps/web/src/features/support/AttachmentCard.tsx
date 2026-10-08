import { useState } from "react";
import { Download, TriangleAlert } from "lucide-react";
import type { CriticOverride, TicketAttachment } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { mediaUrls } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDuckSamWhile } from "./call/CallProvider";
import { ATTACHMENT_PURPOSE_LABELS, shortHash } from "./labels";

interface AttachmentCardProps {
  ticketId: string;
  attachment: TicketAttachment;
  /** Set when the customer sent this clip although the Gemini check flagged it needs_revision. */
  criticOverride?: CriticOverride | null;
  className?: string;
}

/**
 * One ticket attachment, played inline through the ticket attachment route (which checks ticket +
 * attachment membership) with a download of the exact same bytes. While the clip plays over a live
 * Sam call, Sam is ducked so the two do not talk over each other.
 */
export function AttachmentCard({
  ticketId,
  attachment,
  criticOverride,
  className,
}: AttachmentCardProps) {
  const label = ATTACHMENT_PURPOSE_LABELS[attachment.purpose];
  const src = mediaUrls.ticketAttachment(ticketId, attachment.assetId);
  const href = mediaUrls.ticketAttachmentDownload(ticketId, attachment.assetId);
  const isVideo = attachment.mime.startsWith("video/");
  const isImage = attachment.mime.startsWith("image/");
  const [playing, setPlaying] = useState(false);
  useDuckSamWhile(playing);

  return (
    <figure className={cn("flex flex-col gap-3 rounded-xl border bg-surface-2 p-3", className)}>
      {isVideo ? (
        <video
          className="aspect-video w-full rounded-lg bg-background object-contain"
          src={src}
          controls
          playsInline
          preload="metadata"
          aria-label={`${label}: ${attachment.filename}`}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      ) : isImage ? (
        <img
          className="aspect-video w-full rounded-lg bg-background object-contain"
          src={src}
          alt={`${label}: ${attachment.filename}`}
          loading="lazy"
        />
      ) : null}
      {criticOverride && attachment.purpose === "customer_take" ? (
        <div
          role="note"
          className="space-y-1 rounded-lg border border-magenta/60 bg-magenta-soft p-2.5 text-magenta"
        >
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <TriangleAlert className="size-4" aria-hidden />
            Gemini check: needs revision
          </p>
          <p className="text-[13px] text-foreground">
            {criticOverride.reason?.trim()
              ? criticOverride.reason
              : "The check did not record a reason."}
          </p>
          <p className="text-xs text-muted-foreground">
            The customer sent this clip anyway; treat it as unconfirmed.
          </p>
        </div>
      ) : null}
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="hud-label">{label}</p>
          <p className="truncate font-mono text-xs text-foreground" title={attachment.filename}>
            {attachment.filename}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {formatBytes(attachment.sizeBytes)}
            {attachment.durationMs !== null ? ` · ${formatDuration(attachment.durationMs)}` : ""}
            {" · "}
            <span title={`SHA-256 ${attachment.sha256}`}>sha {shortHash(attachment.sha256)}</span>
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="min-h-11">
          <a href={href} download={attachment.filename}>
            <Download aria-hidden />
            Download
            <span className="sr-only"> {attachment.filename}</span>
          </a>
        </Button>
      </figcaption>
    </figure>
  );
}
