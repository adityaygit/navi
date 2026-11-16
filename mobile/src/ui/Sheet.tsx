import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { feel } from "../native/haptics";
import { ease, easeOut, glassStrong } from "../theme/tokens";
import { useExit } from "./useExit";

// M6 sheets leave the way they came. A bottom sheet closes by dragging down
// from its top bar (past ~110 px); the day picker closes by pushing it up.
// Short pulls spring back. The drag moves a wrapper, so the sheet's own
// enter/exit animation never fights it.

const LINE = 110;

type Dir = "down" | "up";

export function useSheetDrag(onDismiss: () => void, dir: Dir = "down", zone = LINE) {
  const wrap = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLButtonElement>(null);
  const s = useRef({ y: null as number | null, drag: false, dy: 0, crossed: false, id: -1 });

  const put = (dy: number, animate: boolean) => {
    const w = wrap.current;
    if (w) {
      w.style.transition = animate ? `transform 0.32s ${ease}` : "none";
      w.style.transform = dy ? `translateY(${dy}px)` : "";
    }
    const sc = scrim.current;
    if (sc) {
      sc.style.transition = animate ? "opacity 0.32s ease" : "none";
      sc.style.opacity = String(Math.max(0, 1 - Math.abs(dy) / 500));
    }
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      if (dir === "down" && e.clientY - r.top > zone) return;
      s.current = { y: e.clientY, drag: false, dy: 0, crossed: false, id: e.pointerId };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const st = s.current;
      if (st.y === null || e.pointerId !== st.id) return;
      const raw = e.clientY - st.y;
      const along = dir === "down" ? raw : -raw;
      if (!st.drag) {
        if (Math.abs(raw) < 6) return;
        if (along < 0) {
          st.y = null; // pushing the wrong way: leave it to the content (scroll, buttons)
          return;
        }
        st.drag = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety */
        }
      }
      st.dy = along > 0 ? along : along * 0.15;
      const past = st.dy > LINE;
      if (past !== st.crossed) {
        st.crossed = past;
        if (past) feel("sheet");
      }
      put(dir === "down" ? st.dy : -st.dy, false);
    },
    onPointerUp: () => {
      const st = s.current;
      const was = st.drag;
      st.y = null;
      st.drag = false;
      if (!was) return;
      if (st.dy > LINE) {
        const w = wrap.current;
        if (w) {
          w.style.transition = `transform 0.26s ${easeOut}`;
          w.style.transform = dir === "down" ? "translateY(110%)" : "translateY(-120%)";
        }
        if (scrim.current) {
          scrim.current.style.transition = "opacity 0.26s ease";
          scrim.current.style.opacity = "0";
        }
        window.setTimeout(onDismiss, 260);
      } else put(0, true);
    },
  };
  return { wrap, scrim, handlers: { ...handlers, onPointerCancel: handlers.onPointerUp } };
}

/** The little bar at the top that says "drag me". */
export function Grabber() {
  return (
    <span aria-hidden="true" style={{ flex: "none", alignSelf: "center", width: 120, height: 28, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", cursor: "grab" }}>
      <span style={{ width: 40, height: 5, borderRadius: 3, background: "rgba(17,20,26,0.22)" }} />
    </span>
  );
}

type Props = {
  label: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
  /** Full-width from the bottom (default) or floating with a margin all round. */
  floating?: boolean;
  height?: string;
  z?: number;
  style?: CSSProperties;
};

/** A bottom sheet: glass, a scrim, Escape and the scrim close it, and it drags down to close. */
export function Sheet({ label, onClose, children, floating, height, z = 10, style }: Props) {
  const { closing, close } = useExit(260);
  const shut = () => close(onClose);
  const drag = useSheetDrag(onClose);
  const shutRef = useRef(shut);
  shutRef.current = shut;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") shutRef.current();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const geo: CSSProperties = floating
    ? { left: 8, right: 8, bottom: "max(8px, calc(var(--sab) - 18px))", borderRadius: 36, maxHeight: "calc(100% - var(--sat) - 24px)" }
    : { left: 0, right: 0, bottom: 0, borderRadius: "38px 38px 0 0", height: height ?? "auto", maxHeight: "calc(100% - var(--sat) - 24px)", paddingBottom: "var(--sab)" };

  return (
    <>
      <button
        ref={drag.scrim}
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={shut}
        style={{ position: "absolute", inset: 0, zIndex: z, background: "rgba(20,30,52,0.2)", animation: closing ? "nFadeOut 0.26s ease both" : "nFade 0.3s ease backwards" }}
      />
      <div ref={drag.wrap} style={{ position: "absolute", inset: 0, zIndex: z + 1, pointerEvents: "none" }}>
        <section
          role="dialog"
          aria-modal="true"
          aria-label={label}
          {...drag.handlers}
          style={{
            ...glassStrong,
            position: "absolute",
            ...geo,
            pointerEvents: "auto",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 -20px 60px rgba(20,30,52,0.18)",
            animation: closing ? `nDown 0.26s ${easeOut} both` : `nUp 0.42s ${ease} both`,
            ...style,
          }}
        >
          <Grabber />
          {children(shut)}
        </section>
      </div>
    </>
  );
}
