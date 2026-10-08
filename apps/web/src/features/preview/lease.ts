import { paths } from "@symptomsketch/contracts";
import { isApiClientError, previewLease } from "@/lib/api";

/** Heartbeat result: keep going, the lease is gone, or a transient failure worth one more try. */
export type HeartbeatResult = "ok" | "lost" | "transient";

export async function heartbeatLease(caseId: string, leaseId: string): Promise<HeartbeatResult> {
  try {
    const res = await previewLease(caseId, { leaseId, action: "heartbeat" });
    return res.active ? "ok" : "lost";
  } catch (err) {
    const definitive =
      isApiClientError(err) && err.status >= 400 && err.status < 500 && err.status !== 429;
    return definitive ? "lost" : "transient";
  }
}

/** Frees the app-side live-scene capacity. Never throws; the lease also expires on its TTL. */
export function releaseLease(caseId: string, leaseId: string): void {
  void previewLease(caseId, { leaseId, action: "release" }).catch(() => undefined);
}

/** Release that survives page unload (pagehide). */
export function releaseLeaseKeepalive(caseId: string, leaseId: string): void {
  try {
    void fetch(paths.casePreviewLease(caseId), {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId, action: "release" }),
    }).catch(() => undefined);
  } catch {
    // keepalive unsupported: the lease expires on its own TTL.
  }
}

/** The normalized product reference as bytes (for X2 upload) and a decoded still (for canvases). */
export async function loadReference(url: string): Promise<{ blob: Blob; still: ImageBitmap }> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`reference ${res.status}`);
  const blob = await res.blob();
  return { blob, still: await createImageBitmap(blob) };
}
