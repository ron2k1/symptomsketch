import type { ReactNode, RefObject } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { formatDuration, formatTakeNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface StageScreenProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  referenceImageUrl: string;
  productLabel: string;
  purposeLabel: string;
  /** Live output is current for the shown run (otherwise the reference covers the frozen video). */
  showLiveVideo: boolean;
  isLive: boolean;
  /** Saved take mode: its final MP4 replaces the live player. */
  take: { id: string; number: number; mediaUrl: string | null; stateLabel: string } | null;
  compareOriginal: boolean;
  recordingSec: number | null;
  updating: boolean;
  overlay: { kind: "busy" | "error"; title: string; detail?: string | null } | null;
}

const PILL =
  "rounded-full border border-border bg-background/80 px-2.5 py-1 font-mono text-[12px] uppercase tracking-[0.12em] backdrop-blur";

/** The undistorted 16:9 player area: live main_video, reference still, saved take MP4. */
export function StageScreen(p: StageScreenProps) {
  const takeSrc = p.take?.mediaUrl ?? null;
  const coverWithReference = !p.take && !p.showLiveVideo;
  const recPill =
    p.recordingSec !== null ? (
      <Pill tone="magenta">
        <span className="size-2 animate-pulse rounded-full bg-magenta" aria-hidden />
        Rec {formatDuration(p.recordingSec * 1000)}
      </Pill>
    ) : null;
  return (
    <div className="flex flex-col gap-2">
      {p.take && (
        // A saved take's MP4 has purpose, product and caption burned into its corners and bottom
        // band (capture/compositor.ts), so its chips sit above the frame instead of over it.
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="neon">Saved · {formatTakeNumber(p.take.number)}</Pill>
            <Pill tone="muted">{p.purposeLabel}</Pill>
            <Pill tone="muted">{p.take.stateLabel}</Pill>
          </div>
          {recPill}
        </div>
      )}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-background">
        {/* Always mounted (never display:none) so requestVideoFrameCallback keeps firing. */}
        <video
          ref={p.videoRef}
          className="absolute inset-0 h-full w-full object-contain"
          muted
          playsInline
          autoPlay
          aria-label="Live generated preview"
        />
        {coverWithReference && <Still src={p.referenceImageUrl} alt={p.productLabel} />}
        {p.take && takeSrc && (
          <video
            key={p.take.id}
            className="absolute inset-0 h-full w-full bg-background object-contain"
            src={takeSrc}
            controls
            playsInline
            preload="metadata"
            aria-label={`${formatTakeNumber(p.take.number)} final MP4`}
          />
        )}
        {p.take && !takeSrc && <Still src={p.referenceImageUrl} alt={p.productLabel} />}
        {p.compareOriginal && (
          <div className="absolute inset-0 z-20">
            <Still src={p.referenceImageUrl} alt={`${p.productLabel}, original reference`} />
            <span className={cn(PILL, "absolute bottom-3 left-3 text-foreground")}>
              Original reference
            </span>
          </div>
        )}

        {!p.take && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {p.isLive ? (
                <Pill tone="neon">
                  <span className="size-2 animate-pulse rounded-full bg-neon" aria-hidden /> Live
                </Pill>
              ) : (
                <Pill tone="muted">Reference</Pill>
              )}
              {p.isLive && <Pill tone="muted">{p.purposeLabel}</Pill>}
            </div>
            {recPill}
          </div>
        )}

        {p.updating && !p.take && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
            <Pill tone="neon">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Updating the movement
            </Pill>
          </div>
        )}

        {p.overlay && !p.take && !p.compareOriginal && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/55 p-4">
            <div className="max-w-md rounded-xl border border-border bg-surface/95 px-5 py-4 text-center shadow-[var(--glow)]">
              {p.overlay.kind === "busy" ? (
                <LoaderCircle className="mx-auto mb-2 size-6 animate-spin text-neon" aria-hidden />
              ) : (
                <TriangleAlert className="mx-auto mb-2 size-6 text-warning" aria-hidden />
              )}
              <p className="text-[15px] font-medium text-foreground">{p.overlay.title}</p>
              {p.overlay.detail && (
                <p className="mt-1 text-[13px] text-muted-foreground">{p.overlay.detail}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Still({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      className="absolute inset-0 h-full w-full bg-background object-contain"
      src={src}
      alt={alt}
      draggable={false}
    />
  );
}

function Pill({ tone, children }: { tone: "neon" | "magenta" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cn(
        PILL,
        "inline-flex items-center gap-1.5",
        tone === "neon" && "border-neon/50 text-neon",
        tone === "magenta" && "border-magenta/60 text-magenta",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
