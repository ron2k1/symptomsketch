import { useId, useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { LIMITS, type SessionState } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSession, errorMessage } from "@/lib/api";
import { hasCustomerAccess } from "./access";

export interface AccessCodeDialogProps {
  open: boolean;
  /** What the visitor was doing, e.g. "Robot vacuum"; kept while the code is entered. */
  context?: string;
  onGranted: (session: SessionState) => void;
  onCancel: () => void;
}

/** Short demo-access-code sheet (spec 4 step 3). POST /api/session sets the HttpOnly cookie. */
export function AccessCodeDialog({ open, context, onGranted, onCancel }: AccessCodeDialogProps) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  const reset = () => {
    setCode("");
    setError(null);
    setPending(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const accessCode = code.trim();
    if (!accessCode || pending) return;
    setPending(true);
    setError(null);
    try {
      const session = await createSession(accessCode);
      if (!hasCustomerAccess(session)) {
        setError("That code did not unlock the demo. Check it and try again.");
        setPending(false);
        return;
      }
      reset();
      onGranted(session);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || pending) return;
        reset();
        onCancel();
      }}
    >
      <DialogContent data-lenis-prevent className="border-border bg-popover sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono">
              <KeyRound aria-hidden className="size-5 text-neon" />
              Enter the demo access code
            </DialogTitle>
            <DialogDescription>
              {context
                ? `Your choice (${context}) is kept. The code unlocks this browser for the demo.`
                : "The code unlocks this browser for the demo."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId} className="hud-label">
              Access code
            </Label>
            <Input
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              required
              maxLength={LIMITS.accessCodeMaxChars}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="h-11 font-mono"
            />
            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                reset();
                onCancel();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || code.trim().length === 0}
              className="font-mono"
            >
              {pending && <LoaderCircle aria-hidden className="animate-spin" />}
              {pending ? "Checking…" : "Continue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
