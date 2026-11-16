import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { feel } from "../native/haptics";
import { ease, glassStrong, ink } from "../theme/tokens";

// One toast at a time, above the bottom bar, gone after 5 s. Undo runs the
// given function; the toast closes with the same motion it opened with.

type Toast = { id: number; text: string; undo?: () => void; accent: string };
const Ctx = createContext<(text: string, opts?: { undo?: () => void; accent?: string }) => void>(() => {});

export const useToast = () => useContext(Ctx);
const HideCtx = createContext<() => void>(() => {});
/** Sheets call this as they open, so a toast never sits on top of them. */
export const useHideToast = () => useContext(HideCtx);

export function ToastHost({ children, bottom }: { children: ReactNode; bottom: string }) {
  const [t, setT] = useState<Toast | null>(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number>(0);
  const n = useRef(0);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setClosing(true);
    window.setTimeout(() => {
      setT(null);
      setClosing(false);
    }, 220);
  }, []);

  const show = useCallback(
    (text: string, opts?: { undo?: () => void; accent?: string }) => {
      window.clearTimeout(timer.current);
      setClosing(false);
      setT({ id: ++n.current, text, undo: opts?.undo, accent: opts?.accent ?? ink.link });
      timer.current = window.setTimeout(hide, 5000);
    },
    [hide],
  );

  return (
    <Ctx.Provider value={show}>
      <HideCtx.Provider value={hide}>
      {children}
      {t ? (
        <div key={t.id} role="status" style={{ ...glassStrong, position: "absolute", left: 0, right: 0, margin: "0 auto", width: "fit-content", maxWidth: "calc(100% - 32px)", boxSizing: "border-box", bottom, zIndex: 30, minHeight: 48, display: "flex", alignItems: "center", gap: 6, padding: t.undo ? "0 6px 0 18px" : "0 18px", borderRadius: 24, animation: closing ? `nSink 0.22s ${ease} both` : `nRise 0.3s ${ease} both` }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: ink.text, padding: "12px 0" }}>{t.text}</span>
          {t.undo ? (
            <button
              type="button"
              onClick={() => {
                window.clearTimeout(timer.current);
                feel("undo");
                t.undo?.();
                hide();
              }}
              style={{ minHeight: 44, padding: "0 12px", color: t.accent, fontWeight: 700, fontSize: 16 }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
      </HideCtx.Provider>
    </Ctx.Provider>
  );
}
