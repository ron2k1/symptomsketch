import { useRef, useState, type ChangeEvent } from "react";
import { ImageUp, LoaderCircle } from "lucide-react";
import {
  ERROR_COPY,
  LIMITS,
  SOURCE_TYPE_LABELS,
  type ProcedureRevision,
  type Purpose,
} from "@symptomsketch/contracts";
import { Button } from "@/components/ui/button";
import { errorMessage, uploadAsset } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useWorkspace } from "./WorkspaceProvider";

/** Change photo: upload a new original; the server makes it the canonical product revision. */
function useChangePhoto() {
  const { caseId, reload, announce } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(file: File) {
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
    setBusy(true);
    try {
      // The upload itself creates the new current product revision (server UploadAssetResult).
      await uploadAsset(caseId, file);
      await reload();
      announce("Reference photo updated. Saved takes keep their earlier photo.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, change };
}

function ProcedureSource({ procedure }: { procedure: ProcedureRevision }) {
  return (
    <section aria-labelledby="source-instructions" className="space-y-2">
      <h3 id="source-instructions" className="hud-label">
        Source instructions
      </h3>
      <p className="text-sm font-medium">{procedure.title}</p>
      {procedure.procedureCode ? (
        <p className="font-mono text-[12px] text-muted-foreground">{procedure.procedureCode}</p>
      ) : null}
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {procedure.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <p className="text-[12px] text-muted-foreground">Source: {procedure.sourceDescription}</p>
      <p className="text-[12px] text-muted-foreground">
        Applies to this model:{" "}
        {procedure.modelApplicabilityConfirmed ? "confirmed" : "not confirmed"}
      </p>
    </section>
  );
}

interface ProductPanelProps {
  purpose: Purpose;
  /** Show the immutable original account box (Recreate). Issue edits it in place instead. */
  showAccount: boolean;
  procedure: ProcedureRevision | null;
}

export function ProductPanel({ purpose, showAccount, procedure }: ProductPanelProps) {
  const { state, productName, modelLabel, captureBusy } = useWorkspace();
  const { busy, error, change } = useChangePhoto();
  const inputRef = useRef<HTMLInputElement>(null);
  const caseData = state.caseData;
  if (!caseData) return null;
  const product = caseData.product;
  const isDemo = product?.sourceType === "demo_photo";

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void change(file);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">Your product</h2>
      {product ? (
        <figure className="space-y-2">
          <div className="relative overflow-hidden rounded-xl border border-border bg-surface-2">
            <img
              src={product.normalized.mediaUrl}
              alt={`Reference photo of ${productName}`}
              className="aspect-[4/3] w-full object-contain"
            />
            {isDemo ? (
              <span className="absolute left-2 top-2 rounded-full border border-neon/50 bg-background/80 px-2 py-0.5 font-mono text-[11px] text-neon">
                {SOURCE_TYPE_LABELS.demo_photo}
              </span>
            ) : null}
          </div>
          <figcaption className="space-y-0.5">
            <p className="text-sm font-medium">{productName}</p>
            <p className="text-[12px] text-muted-foreground">
              {modelLabel ? `Model: ${modelLabel}` : "Model not provided"}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {SOURCE_TYPE_LABELS[product.sourceType]}
              {product.original.filename ? ` / ${product.original.filename}` : ""}
            </p>
          </figcaption>
        </figure>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Make the movement easier to explain. Upload a photo of your product to begin.
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={LIMITS.uploadMimeTypes.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={onPick}
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        disabled={busy || captureBusy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <ImageUp aria-hidden />}
        {busy ? "Uploading photo" : product ? "Change photo" : "Upload a photo"}
      </Button>
      {product ? (
        <p className="text-[12px] text-muted-foreground">
          A new photo creates a new reference. Saved takes keep the photo they used.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {showAccount && caseData.ownerRole === "customer" && caseData.originalAccount ? (
        <section
          aria-labelledby="original-account"
          className="space-y-2 rounded-xl border border-border bg-surface-2 p-3"
        >
          <h3 id="original-account" className="hud-label">
            Original account
          </h3>
          <p className="whitespace-pre-wrap font-voice text-[15px] leading-relaxed">
            {caseData.originalAccount}
          </p>
          {caseData.actionsTried ? (
            <>
              <p className="hud-label pt-1">What I tried</p>
              <p className="whitespace-pre-wrap font-voice text-[15px] leading-relaxed">
                {caseData.actionsTried}
              </p>
            </>
          ) : null}
          <p className="text-[11px] text-muted-foreground">Kept exactly as written.</p>
        </section>
      ) : null}

      {purpose === "solution" && procedure ? <ProcedureSource procedure={procedure} /> : null}
    </div>
  );
}
