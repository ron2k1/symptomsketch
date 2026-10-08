import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clapperboard, LoaderCircle } from "lucide-react";
import { storyPaths } from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";

/** Workspace entry point to Story mode: saves the draft (the director reads it), then opens it. */
export function TellAsStoryButton({
  caseId,
  missing,
  save,
  onError,
}: {
  caseId: string;
  /** What still blocks a story ("Add a product photo first."), or null. */
  missing: string | null;
  save: () => Promise<string | null>;
  onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  async function open() {
    if (missing) {
      onError(missing);
      return;
    }
    setBusy(true);
    const message = await save();
    setBusy(false);
    if (message) {
      onError(message);
      return;
    }
    navigate(storyPaths.page(caseId));
  }
  return (
    <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={open}>
      {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Clapperboard aria-hidden />}
      Tell it as a story
    </Button>
  );
}
