import { useCallback, useEffect, useRef, useState } from "react";
import { createCase, errorMessage, isApiClientError, patchCase, uploadAsset } from "@/lib/api";
import { newClientRequestId } from "@/lib/ids";
import type { CustomerAccess } from "@/features/access/useCustomerAccess";
import { precheckPhoto } from "./photo-check";

export type IntakeStep = "case" | "label" | "upload";

export type IntakePhase =
  | { kind: "empty" }
  | { kind: "selected" }
  | { kind: "submitting"; step: IntakeStep | null }
  | { kind: "error"; message: string };

export interface SelectedPhoto {
  file: File;
  previewUrl: string;
}

export interface PhotoIntake {
  photo: SelectedPhoto | null;
  phase: IntakePhase;
  /** Pre-check problem with the most recently chosen file (the previous photo is kept). */
  rejection: string | null;
  modelLabel: string;
  setModelLabel: (value: string) => void;
  choose: (file: File | null | undefined) => void;
  clear: () => void;
  submit: () => Promise<void>;
}

/** Saved progress so a retry resumes instead of duplicating the case or the upload. */
interface Progress {
  clientRequestId: string;
  caseId: string | null;
  /** Model label already stored on the case ("" = none). */
  savedLabel: string;
}

const freshProgress = (): Progress => ({
  clientRequestId: newClientRequestId(),
  caseId: null,
  savedLabel: "",
});

/**
 * Photo intake for "Your own product": pre-check -> access code -> POST /api/cases (problem)
 * -> PATCH model label (only if entered) -> POST /api/cases/:id/assets -> onReady(caseId).
 * The server makes the uploaded photo the case's current product revision (server-core
 * UploadAssetResult). A cancelled picker or a failed step keeps the photo and saved progress.
 */
export function usePhotoIntake(
  access: CustomerAccess,
  onReady: (caseId: string) => void,
): PhotoIntake {
  const [photo, setPhoto] = useState<SelectedPhoto | null>(null);
  const [phase, setPhase] = useState<IntakePhase>({ kind: "empty" });
  const [rejection, setRejection] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState("");
  const progress = useRef<Progress>(freshProgress());

  useEffect(() => {
    if (!photo) return;
    return () => URL.revokeObjectURL(photo.previewUrl);
  }, [photo]);

  const choose = useCallback((file: File | null | undefined) => {
    if (!file) return; // picker cancelled: keep whatever was there
    const check = precheckPhoto(file);
    if (!check.ok) {
      setRejection(check.message);
      return;
    }
    setRejection(null);
    setPhoto({ file, previewUrl: URL.createObjectURL(file) });
    setPhase({ kind: "selected" });
  }, []);

  const clear = useCallback(() => {
    setPhoto(null);
    setRejection(null);
    setPhase({ kind: "empty" });
  }, []);

  const submit = useCallback(async () => {
    if (!photo) return;
    const file = photo.file;
    const label = modelLabel.trim();
    setPhase({ kind: "submitting", step: null });
    try {
      const outcome = await access.run(async () => {
        const saved = progress.current;
        let caseId = saved.caseId;
        if (!caseId) {
          setPhase({ kind: "submitting", step: "case" });
          const created = await createCase({
            purpose: "problem",
            title: label || "Your own product",
            fixtureId: null,
            clientRequestId: saved.clientRequestId,
          });
          caseId = created.case.id;
          saved.caseId = caseId;
        }
        if (label !== saved.savedLabel) {
          setPhase({ kind: "submitting", step: "label" });
          await patchCase(caseId, { modelLabel: label || null });
          saved.savedLabel = label;
        }
        setPhase({ kind: "submitting", step: "upload" });
        await uploadAsset(caseId, file);
        return caseId;
      }, "your photo");
      if (!outcome.granted) {
        setPhase({ kind: "selected" });
        return;
      }
      progress.current = freshProgress();
      onReady(outcome.value);
    } catch (err) {
      if (isApiClientError(err) && (err.code === "CASE_INACTIVE" || err.code === "NOT_FOUND")) {
        progress.current = freshProgress();
      }
      setPhase({ kind: "error", message: errorMessage(err) });
    }
  }, [access, modelLabel, onReady, photo]);

  return { photo, phase, rejection, modelLabel, setModelLabel, choose, clear, submit };
}
