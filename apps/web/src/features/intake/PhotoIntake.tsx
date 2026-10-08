import { useId, useImperativeHandle, useRef, useState, type DragEvent, type Ref } from "react";
import { CloudUpload, ImageUp, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react";
import { LIMITS } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PHOTO_ACCEPT } from "./photo-check";
import type { IntakeStep, PhotoIntake as PhotoIntakeState } from "./usePhotoIntake";

export interface PhotoIntakeHandle {
  openPicker: () => void;
}

export interface PhotoIntakeProps {
  intake: PhotoIntakeState;
  /** Another product row is opening; block a second submission. */
  disabled?: boolean;
  notes: readonly string[];
  ref?: Ref<PhotoIntakeHandle>;
}

const STEP_COPY: Record<IntakeStep | "access", string> = {
  access: "Checking access…",
  case: "Creating your case…",
  label: "Saving the model label…",
  upload: "Uploading your photo…",
};

/** File picker + drag and drop for "Your own product" (spec 3, 4). */
export function PhotoIntake({ intake, disabled = false, notes, ref }: PhotoIntakeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const modelId = useId();
  const { photo, phase, rejection } = intake;
  const submitting = phase.kind === "submitting";
  const locked = submitting || disabled;

  useImperativeHandle(ref, () => ({
    openPicker: () => {
      panelRef.current?.scrollIntoView({ block: "nearest" });
      inputRef.current?.click();
    },
  }));

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (locked) return;
    intake.choose(event.dataTransfer.files.item(0));
  };

  const status = submitting ? STEP_COPY[phase.step ?? "access"] : "";

  return (
    <div
      ref={panelRef}
      onDragOver={(event) => {
        event.preventDefault();
        if (!locked) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "mt-4 rounded-xl border border-dashed bg-surface/60 p-4 transition-colors sm:p-5",
        dragging ? "border-magenta bg-magenta-soft" : "border-border",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => {
          intake.choose(event.target.files?.item(0));
          event.target.value = "";
        }}
      />
      <p className="sr-only" aria-live="polite">
        {status}
      </p>

      {photo ? (
        <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
          <img
            src={photo.previewUrl}
            alt={`Selected photo: ${photo.file.name}`}
            className="aspect-square w-full max-w-[140px] rounded-lg border border-border object-cover"
          />
          <div className="flex min-w-0 flex-col gap-3">
            <div>
              <p className="hud-label text-magenta">Your photo</p>
              <p className="truncate font-medium">{photo.file.name}</p>
              <p className="text-sm text-muted-foreground">
                {photo.file.type || "image"} · {formatBytes(photo.file.size)}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={modelId} className="hud-label">
                Product or model (optional)
              </Label>
              <Input
                id={modelId}
                value={intake.modelLabel}
                maxLength={LIMITS.modelLabelMaxChars}
                disabled={submitting}
                placeholder="e.g. Robot vacuum, kitchen blender"
                onChange={(event) => intake.setModelLabel(event.target.value)}
                className="h-10"
              />
            </div>
            {phase.kind === "error" && (
              <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{phase.message} Your photo is still selected.</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void intake.submit()}
                disabled={locked}
                className="h-11 font-mono"
              >
                {submitting ? (
                  <LoaderCircle aria-hidden className="animate-spin" />
                ) : phase.kind === "error" ? (
                  <RotateCcw aria-hidden />
                ) : (
                  <ImageUp aria-hidden />
                )}
                {submitting ? status : phase.kind === "error" ? "Try again" : "Use this photo"}
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={locked}
                onClick={() => inputRef.current?.click()}
              >
                Choose another
              </Button>
              <Button
                variant="ghost"
                className="h-11 text-muted-foreground"
                disabled={locked}
                onClick={intake.clear}
              >
                <X aria-hidden />
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-4 text-center sm:flex-row sm:text-left">
          <span className="grid size-12 shrink-0 place-items-center rounded-full border border-magenta/60 bg-magenta-soft">
            <CloudUpload aria-hidden className="size-5 text-magenta" />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="font-medium">Drop a product photo here</span>
            <span className="text-sm text-muted-foreground">
              JPEG, PNG or WebP · up to {formatBytes(LIMITS.uploadMaxBytes)}
            </span>
          </span>
          <Button
            variant="outline"
            className="h-11 border-magenta/60 font-mono text-magenta hover:bg-magenta-soft hover:text-magenta"
            disabled={locked}
            onClick={() => inputRef.current?.click()}
          >
            Choose photo
          </Button>
        </div>
      )}

      {rejection && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {rejection}
            {photo ? " Your earlier photo is still selected." : ""}
          </span>
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
