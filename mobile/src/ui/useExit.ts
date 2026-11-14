import { useCallback, useState } from "react";

/** Keeps an overlay mounted while its exit animation plays. */
export function useExit(ms = 260): { closing: boolean; close: (after: () => void) => void } {
  const [closing, setClosing] = useState(false);
  const close = useCallback(
    (after: () => void) => {
      setClosing(true);
      window.setTimeout(() => {
        setClosing(false);
        after();
      }, ms);
    },
    [ms],
  );
  return { closing, close };
}
