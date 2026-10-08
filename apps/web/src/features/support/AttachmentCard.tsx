import { useState } from "react";
import { Download } from "lucide-react";
import type { TicketAttachment } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { mediaUrls } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDuckSamWhile } from "./call/CallProvider";
import { ATTACHMENT_PURPOSE_LABELS, shortHash } from "./labels";

interface AttachmentCardProps {
  ticketId: string;
  attachment: TicketAttachment;
  className?: string;
}

/**
 * One ticket attachment, played inline through the ticket attachment route (which checks ticket +
 * attachment membership) with a download of the exact same bytes. While the clip plays over a live
 * Sam call, Sam is ducked so the two do not talk over each other.
 */
export function AttachmentCard({ ticketId, attachment, className }: AttachmentCardProps) {
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
