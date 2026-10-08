import { useCallback, useState } from "react";

const PREFIX = "ss.support.draft.";

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(PREFIX + key);
    else window.sessionStorage.setItem(PREFIX + key, value);
  } catch {
    // storage blocked (private mode): the draft just lives in memory
  }
}

/**
 * A text draft that survives tab unmounts and in-app navigation within this browser tab
 * (e.g. support leaves to build a demonstration and comes back). Typing never transmits anything.
 */
export function useSessionDraft(key: string) {
  const [state, setState] = useState(() => ({ key, value: read(key) }));
  const current = state.key === key ? state : { key, value: read(key) };

  const setValue = useCallback(
    (value: string) => {
      write(key, value);
      setState({ key, value });
    },
    [key],
  );
  const clear = useCallback(() => {
    write(key, null);
    setState({ key, value: null });
  }, [key]);

  /** null when nothing was saved for this key. */
  return { value: current.value, setValue, clear } as const;
}
