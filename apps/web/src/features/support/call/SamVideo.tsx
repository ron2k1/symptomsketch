import { useEffect, useRef, type Ref } from "react";
import { SUPPORT_CALL_AGENT_NAME } from "@symptomsketch/contracts";
import { cn } from "@/lib/utils";

export interface SamVideoProps {
  media: MediaStream | null;
  className?: string;
  videoRef?: Ref<HTMLVideoElement>;
}

/**
 * Sam's live main_video from the Reactor stream. Always muted: the call provider plays Sam's voice
 * once for the whole app, so the full view, the dock and the PiP window never double it.
 */
export function SamVideo({ media, className, videoRef }: SamVideoProps) {
  const own = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = own.current;
    if (!video) return;
    video.muted = true;
    if (video.srcObject !== media) video.srcObject = media;
    if (media) void video.play?.()?.catch(() => undefined);
  }, [media]);

  return (
    <video
      ref={(el) => {
        own.current = el;
        if (typeof videoRef === "function") videoRef(el);
        else if (videoRef) videoRef.current = el;
      }}
      autoPlay
      muted
      playsInline
      data-sam-video=""
      aria-label={`${SUPPORT_CALL_AGENT_NAME}, AI support agent video`}
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
}
