import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS } from "@symptomsketch/contracts";

/**
 * Delay before the next poll (spec 5): the base interval while healthy, doubled per consecutive
 * failure and capped at maxMs.
 */
export function pollDelay(
  failures: number,
  baseMs: number = LIMITS.pollIntervalMs,
  maxMs: number = LIMITS.pollMaxBackoffMs,
): number {
  if (failures <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures, 16));
}

export interface PollingOptions {
  /** False pauses polling entirely (e.g. no ticket yet, not signed in). */
  enabled: boolean;
  intervalMs?: number;
  maxBackoffMs?: number;
  /** Stop retrying after this error (auth lost, resource gone) until refresh() or a key change. */
  stopOn?: (err: unknown) => boolean;
}

export interface PollingResult<T> {
  data: T | null;
  error: unknown;
  /** Consecutive failures since the last success. */
  failures: number;
  /** Date.now() of the last successful fetch for the current key. */
  updatedAt: number | null;
  /** True until the first result (or error) for the current key arrives. */
  loading: boolean;
  /** True when stopOn halted polling. */
  stopped: boolean;
  /** Fetch now and restart the schedule (clears a stop). */
  refresh(): void;
  /** Replace data with a fresher copy the caller already has (e.g. a POST response). */
  setData(next: T): void;
}

interface State<T> {
  key: string | null;
  data: T | null;
  error: unknown;
  failures: number;
  updatedAt: number | null;
  loading: boolean;
  stopped: boolean;
}

function initial<T>(key: string | null): State<T> {
  return {
    key,
    data: null,
    error: null,
    failures: 0,
    updatedAt: null,
    loading: key !== null,
    stopped: false,
  };
}

const isHidden = () => typeof document !== "undefined" && document.hidden;

/**
 * Poll `fetcher` every intervalMs while the document is visible. Hidden tabs pause (no timer, no
 * request); becoming visible fetches immediately. Failures back off exponentially. A change of
 * `key` resets the data and restarts. No WebSockets, no presence: this only re-reads stored state.
 */
export function usePolling<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: PollingOptions,
): PollingResult<T> {
  const {
    enabled,
    intervalMs = LIMITS.pollIntervalMs,
    maxBackoffMs = LIMITS.pollMaxBackoffMs,
  } = options;
  const fetcherRef = useRef(fetcher);
  const stopOnRef = useRef(options.stopOn);
  useEffect(() => {
    fetcherRef.current = fetcher;
    stopOnRef.current = options.stopOn;
  });

  const [state, setState] = useState<State<T>>(() => initial<T>(key));
  const [restart, setRestart] = useState(0);

  useEffect(() => {
    if (key === null || !enabled) return;
    let cancelled = false;
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;

    setState((s) => (s.key === key ? { ...s, stopped: false } : initial<T>(key)));

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!cancelled && !stopped && !isHidden()) timer = setTimeout(() => void tick(), ms);
    };

    const tick = async () => {
      if (cancelled || stopped || inFlight || isHidden()) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const value = await fetcherRef.current(controller.signal);
        if (cancelled) return;
        failures = 0;
        setState({
          key,
          data: value,
          error: null,
          failures: 0,
          updatedAt: Date.now(),
          loading: false,
          stopped: false,
        });
        inFlight = false;
        schedule(intervalMs);
      } catch (err) {
        if (cancelled) return;
        failures += 1;
        stopped = stopOnRef.current?.(err) ?? false;
        setState((s) => ({
          ...(s.key === key ? s : initial<T>(key)),
          error: err,
          failures,
          loading: false,
          stopped,
        }));
        inFlight = false;
        schedule(pollDelay(failures, intervalMs, maxBackoffMs));
      } finally {
        controller = null;
      }
    };

    const onVisibility = () => {
      if (isHidden()) clearTimeout(timer);
      else void tick();
    };

    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, enabled, intervalMs, maxBackoffMs, restart]);

  const refresh = useCallback(() => setRestart((n) => n + 1), []);
  const setData = useCallback(
    (next: T) =>
      setState({
        key,
        data: next,
        error: null,
        failures: 0,
        updatedAt: Date.now(),
        loading: false,
        stopped: false,
      }),
    [key],
  );

  const current = state.key === key ? state : initial<T>(key);
  return {
    data: current.data,
    error: current.error,
    failures: current.failures,
    updatedAt: current.updatedAt,
    loading: enabled ? current.loading : false,
    stopped: current.stopped,
    refresh,
    setData,
  };
}
