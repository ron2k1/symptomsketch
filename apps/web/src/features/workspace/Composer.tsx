import type { KeyboardEvent, Ref } from "react";
import { LoaderCircle, Send } from "lucide-react";
import { LIMITS } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ComposerProps {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  disabled: boolean;
  busy: boolean;
  /** A clarification question is open: the next message answers it. */
  answering: boolean;
  disabledReason: string | null;
  /** Overrides for the first description, when no plan exists yet. */
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

/** Correction composer: Ctrl/Cmd+Enter submits, Enter inserts a new line (spec 6). */
export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  answering,
  disabledReason,
  label,
  placeholder,
  submitLabel,
  ref,
}: ComposerProps) {
  const canSubmit = !disabled && !busy && value.trim().length > 0;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <div className="flex items-end justify-between gap-2">
        <Label htmlFor="composer">
          {label ?? (answering ? "Answer the question" : "Refine the movement")}
        </Label>
        <span className="font-mono text-[12px] text-muted-foreground" aria-live="off">
          {value.length}/{LIMITS.composerMaxChars}
        </span>
      </div>
      <Textarea
        id="composer"
        ref={ref}
        rows={3}
        value={value}
        maxLength={LIMITS.composerMaxChars}
        disabled={disabled}
        aria-describedby="composer-hint"
        placeholder={
          placeholder ??
          (answering
            ? "Type your answer"
            : "For example: the backward jerk is smaller and quicker.")
        }
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <p id="composer-hint" className="text-[12px] text-muted-foreground">
        {disabledReason ?? "Ctrl+Enter (Cmd+Enter on a Mac) to send. Enter adds a new line."}
      </p>
      <Button type="submit" className="min-h-11 w-full" disabled={!canSubmit}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        {busy ? "Updating the movement" : (submitLabel ?? "Update preview")}
      </Button>
    </form>
  );
}
