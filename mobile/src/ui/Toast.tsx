import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { feel } from "../native/haptics";
import { ease } from "../theme/tokens";

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
      setT({ id: ++n.current, text, undo: opts?.undo, accent: opts?.accent ?? "#A7EBC0" });
      timer.current = window.setTimeout(hide, 5000);
    },
    [hide],
  );

  return (
    <Ctx.Provider value={show}>
      <HideCtx.Provider value={hide}>
      {children}
      {t ? (
        <div key={t.id} role="status" style={{ position: "absolute", left: 16, right: 16, bottom, zIndex: 30, minHeight: 52, display: "flex", alignItems: "center", gap: 12, padding: "0 8px 0 20px", borderRadius: 16, background: "#1C1C1F", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 12px 30px rgba(0,0,0,0.5)", animation: closing ? `nSink 0.22s ${ease} both` : `nRise 0.3s ${ease} both` }}>
          <span style={{ flex: 1, fontSize: 15, color: "#E8E8EC", padding: "14px 0" }}>{t.text}</span>
          {t.undo ? (
            <button
              type="button"
              onClick={() => {
                window.clearTimeout(timer.current);
                feel("undo");
                t.undo?.();
                hide();
              }}
              style={{ minHeight: 44, padding: "0 12px", color: t.accent, fontWeight: 600, fontSize: 15 }}
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
