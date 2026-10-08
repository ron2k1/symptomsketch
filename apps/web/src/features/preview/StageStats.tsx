import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { readoutCells, type LiveStats } from "./x2-stats";

export interface StageStatsProps {
  stats: LiveStats;
  /** Latest Gemini planner round trip that created a plan (HTTP 201), or null. */
  plannedMs: number | null;
  /** The latest planner response replayed a stored plan (HTTP 200). */
  planCached: boolean;
  /** performance.now() of the explicit Start; the uptime spans reconnects. */
  startedAt: number | null;
  reconnecting: boolean;
}

/**
 * Live Reactor X2 numbers in the Reactor face. Only measured values render: fps and round trip
 * from WebRTC stats, X2's prompt acceptance time, the planner request time, the session uptime.
 */
export function StageStats({
  stats,
  plannedMs,
  planCached,
  startedAt,
  reconnecting,
}: StageStatsProps) {
  const sessionMs = useUptime(startedAt);
  const cells = readoutCells({ stats, plannedMs, planCached, sessionMs });
  if (cells.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Reactor X2 live stats"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-reactor-line bg-reactor-ink px-3 py-2 font-reactor text-reactor-ink-foreground shadow-[var(--reactor-glow)]"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-reactor-signal">
        <span
          className={cn(
            "size-1.5 rounded-full bg-reactor-signal",
            !reconnecting && "animate-pulse",
          )}
          aria-hidden
        />
        {reconnecting ? "X2 reconnecting" : "X2 live"}
      </span>
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {cells.map((c) => (
          <div key={c.key} className="flex items-baseline gap-1.5" data-stat={c.key}>
            <dt className="text-[10px] uppercase tracking-[0.12em] text-reactor-ink-foreground/70">
              {c.label}
            </dt>
            <dd className="text-[13px] font-semibold tabular-nums">{c.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Milliseconds since `startedAt`, refreshed every second; null while stopped. */
function useUptime(startedAt: number | null): number | null {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? null : Math.max(0, now - startedAt);
}
