import { useRef, useState, type ChangeEvent } from "react";
import { ImageUp, LoaderCircle } from "lucide-react";
import { ERROR_COPY, LIMITS, type CaseDetail } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, getCase, patchCase, uploadAsset } from "@/lib/api";
import { formatBytes } from "@/lib/format";

/**
 * Idle stage of Story mode. A story needs the product photo (the opening starts from it) and the
 * customer's account (the director reads it); a missing one is added right here with the same
 * calls the Issue tab makes, so a visitor who lands on Story mode is never sent elsewhere first.
 */
export function StoryStartControls({
  caseData,
  onCaseChange,
  onStart,
}: {
  caseData: CaseDetail;
  onCaseChange(next: CaseDetail): void;
  onStart(): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState<null | "photo" | "account">(null);
  const [error, setError] = useState<string | null>(null);
  const hasPhoto = Boolean(caseData.product?.normalized.mediaUrl);
  const needsAccount = !caseData.originalAccount.trim();

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (!LIMITS.uploadMimeTypes.includes(file.type)) {
      setError("Use a JPEG, PNG or WebP photo.");
      return;
    }
    if (file.size > LIMITS.uploadMaxBytes) {
      setError(
        `${ERROR_COPY.PAYLOAD_TOO_LARGE} The limit is ${formatBytes(LIMITS.uploadMaxBytes)}.`,
      );
      return;
    }
    setBusy("photo");
    try {
      // The upload itself creates the case's current product revision (as on the Issue tab).
      await uploadAsset(caseData.id, file);
      onCaseChange((await getCase(caseData.id)).case);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onStartClick() {
    if (needsAccount) {
      const text = account.trim();
      if (text.length < 3) return;
      setError(null);
      setBusy("account");
      try {
        onCaseChange((await patchCase(caseData.id, { originalAccount: text })).case);
      } catch (err) {
        setError(errorMessage(err));
        return;
      } finally {
        setBusy(null);
      }
    }
    onStart();
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      {needsAccount ? (
        <div className="w-full space-y-1 text-left">
          <label htmlFor="story-account" className="text-xs font-medium">
            Describe what happened
          </label>
          <Textarea
            id="story-account"
            value={account}
            maxLength={LIMITS.accountMaxChars}
            placeholder="For example: it stops, then jerks backward."
            onChange={(e) => setAccount(e.target.value)}
            rows={3}
            disabled={busy !== null}
            className="min-h-11 bg-background text-foreground"
          />
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={LIMITS.uploadMimeTypes.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onPick(e)}
      />
      {hasPhoto ? (
        <Button
          type="button"
          size="lg"
          className="min-h-11"
          onClick={() => void onStartClick()}
          disabled={busy !== null || (needsAccount && account.trim().length < 3)}
        >
          {busy === "account" ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Start the story
        </Button>
      ) : (
        <>
          <p className="text-xs">The story opens from a photo of your product.</p>
          <Button
            type="button"
            size="lg"
            className="min-h-11"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
          >
            {busy === "photo" ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <ImageUp aria-hidden />
            )}
            {busy === "photo" ? "Uploading the photo" : "Add a product photo"}
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
