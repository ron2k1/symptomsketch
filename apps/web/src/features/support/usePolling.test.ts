import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollDelay, usePolling } from "./usePolling";

describe("pollDelay", () => {
  it("polls every 3 s while healthy and backs off exponentially to the cap", () => {
    expect(pollDelay(0)).toBe(3_000);
    expect(pollDelay(1)).toBe(6_000);
    expect(pollDelay(2)).toBe(12_000);
    expect(pollDelay(3)).toBe(24_000);
    expect(pollDelay(4)).toBe(30_000);
    expect(pollDelay(50)).toBe(30_000);
  });
});

describe("usePolling", () => {
  let hidden = false;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("re-reads every interval while visible and pauses while the tab is hidden", async () => {
    const fetcher = vi.fn(async () => "ok");
    const { result } = renderHook(() => usePolling("k", fetcher, { enabled: true }));
    await flush(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe("ok");

    await flush(3_000);
    expect(fetcher).toHaveBeenCalledTimes(2);

    hidden = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush(30_000);
    expect(fetcher).toHaveBeenCalledTimes(2);

    hidden = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("backs off after failures and resets after a success", async () => {
    let fail = true;
    const fetcher = vi.fn(async () => {
      if (fail) throw new Error("down");
      return 1;
    });
    const { result } = renderHook(() => usePolling("k", fetcher, { enabled: true }));
    await flush(0);
    expect(result.current.failures).toBe(1);

    await flush(3_000);
    expect(fetcher).toHaveBeenCalledTimes(1); // waiting 6 s, not 3 s
    await flush(3_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.failures).toBe(2);

    fail = false;
    await flush(12_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.failures).toBe(0);
    expect(result.current.data).toBe(1);
  });

  it("stops on a terminal error until refreshed", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("gone");
    });
    const { result } = renderHook(() =>
      usePolling("k", fetcher, { enabled: true, stopOn: () => true }),
    );
    await flush(0);
    expect(result.current.stopped).toBe(true);
    await flush(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    await flush(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does nothing when disabled", async () => {
    const fetcher = vi.fn(async () => "x");
    renderHook(() => usePolling("k", fetcher, { enabled: false }));
    await flush(10_000);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
