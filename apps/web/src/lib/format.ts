/** 1536 -> "1.5 KB", 8_000_000 -> "7.6 MB" (binary units, as the limits use MiB). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

/** 8200 -> "0:08", 75_000 -> "1:15". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "-";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Elapsed seconds with one decimal for recording timers: 4321 -> "4.3 s". */
export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** Local date-time for an ISO timestamp. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Take 03" */
/** Null: a ticket a sent FastH3 story opened, with no X2 take. */
export function formatTakeNumber(n: number | null): string {
  if (n === null) return "Customer story (no X2 take)";
  return `Take ${String(n).padStart(2, "0")}`;
}
