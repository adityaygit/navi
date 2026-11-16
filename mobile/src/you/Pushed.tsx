import { useRef, type ReactNode } from "react";
import { feel } from "../native/haptics";
import { useExit } from "../ui/useExit";
import { ease, glass, ink } from "../theme/tokens";

// A You screen (M6): slides in from the right over grey, a glass Back, a big
// title. Drag from the left edge to go back (past ~110 px); a short pull
// springs back. `children` gets `close` so a screen can leave the same way.

type Props = { title: string; onClose: () => void; z?: number; children: (close: () => void) => ReactNode; aside?: ReactNode };

export function Pushed({ title, onClose, z = 20, children, aside }: Props) {
  const { closing, close } = useExit(300);
  const shut = () => close(onClose);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; dx: number; crossed: boolean } | null>(null);

  const start = (e: React.PointerEvent) => {
    if (e.clientX > 28) return;
    drag.current = { x: e.clientX, dx: 0, crossed: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    d.dx = Math.max(0, e.clientX - d.x);
    if (d.dx > 110 !== d.crossed) {
      d.crossed = d.dx > 110;
      if (d.crossed) feel("sheet");
    }
    panel.current.style.transition = "none";
    panel.current.style.transform = `translateX(${d.dx}px)`;
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !panel.current) return;
    if (d.dx > 110) {
      panel.current.style.transition = `transform 0.24s ${ease}`;
      panel.current.style.transform = "translateX(100%)";
      window.setTimeout(onClose, 230);
    } else {
      panel.current.style.transition = `transform 0.3s ${ease}`;
      panel.current.style.transform = "translateX(0)";
    }
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: z }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(20,30,52,0.16)", animation: closing ? "nFadeOut 0.3s ease both" : "nFade 0.3s ease both" }} />
      <div ref={panel} style={{ position: "absolute", inset: 0 }}>
        <section
          role="dialog"
          aria-label={title}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          style={{ position: "absolute", inset: 0, background: ink.grouped, display: "flex", flexDirection: "column", boxShadow: "-20px 0 40px rgba(20,30,52,0.16)", animation: closing ? `nRightOut 0.3s ${ease} both` : `nRight 0.38s ${ease} both` }}
        >
          <div style={{ flex: "none", padding: "calc(var(--sat) + 4px) 12px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <button type="button" aria-label="Back" onClick={() => { feel("select"); shut(); }} style={{ ...glass, width: 48, height: 48, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true"><path d="M10 2L3 9l7 7" fill="none" stroke={ink.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {aside}
          </div>
          <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "4px 16px calc(var(--sab) + 32px)", boxSizing: "border-box" }}>
            <h1 style={{ margin: "4px 4px 18px", fontSize: 36, lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.035em" }}>{title}</h1>
            {children(shut)}
          </div>
        </section>
      </div>
    </div>
  );
}
