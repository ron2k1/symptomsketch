import { useId, useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { SUPPORT_QUEUE_LABEL } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, isApiClientError } from "@/lib/api";

interface SupportLoginCardProps {
  signIn(code: string): Promise<void>;
  /** This browser already holds a customer session (use a separate profile for staff). */
  customerSession: boolean;
  /** A previous staff session ended while the page was open. */
  expired: boolean;
}

function loginErrorCopy(err: unknown): string {
  if (isApiClientError(err)) {
    if (
      err.code === "SUPPORT_FORBIDDEN" ||
      err.code === "FORBIDDEN" ||
      err.code === "ACCESS_REQUIRED" ||
      err.code === "VALIDATION_FAILED"
    ) {
      return "That support code was not accepted.";
    }
    if (err.code === "RATE_LIMITED") return "Too many attempts. Wait a moment and try again.";
  }
  return errorMessage(err);
}

/** POST /api/support/session with the support code; the server assigns the role. */
export function SupportLoginCard({ signIn, customerSession, expired }: SupportLoginCardProps) {
  const inputId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      await signIn(trimmed);
      setCode("");
    } catch (err) {
      setError(loginErrorCopy(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className="holo-tray mx-auto mt-10 w-full max-w-md p-6 sm:p-8"
    >
      <p className="hud-label">{SUPPORT_QUEUE_LABEL}</p>
      <h1 id={`${inputId}-title`} className="mt-2 text-2xl font-semibold">
        Staff sign in
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter the demo support code to open the submitted ticket queue.
      </p>
      {expired ? (
        <p role="status" className="mt-4 text-sm text-warning">
          Your staff session ended. Sign in again to continue.
        </p>
      ) : null}
      {customerSession ? (
        <p className="mt-4 text-sm text-muted-foreground">
          This browser has a customer session. Use a separate browser profile for the staff side so
          the two roles stay apart.
        </p>
      ) : null}
      <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <Label htmlFor={inputId}>Support code</Label>
        <Input
          id={inputId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-11"
          required
        />
        {error ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="mt-2 min-h-11" disabled={pending || !code.trim()}>
          {pending ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <KeyRound aria-hidden />
          )}
          {pending ? "Checking code" : "Open Demo Support"}
        </Button>
      </form>
    </section>
  );
}
