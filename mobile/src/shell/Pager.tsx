import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { ease } from "../theme/tokens";
import { feel } from "../native/haptics";

// Three pages side by side: Progress ← Navi → Plan. Pulling one away rounds
// its corners, shrinks and dims it, while the page underneath stays put and
// comes into focus (blur and darkness fade out). Matches M4-Proto `pageLook`.
//
// Drag frames write styles straight to the DOM (no React render per frame) so
// the pull keeps up with 120 Hz screens.

export type PagerHandle = { goTo: (n: number) => void };
type Props = {
  page: number;
  onPage: (n: number) => void;
  /** Called every frame with the drag offset in px, so the header can follow. */
  onDrag?: (dx: number, animate: boolean, page: number) => void;
  /** While false, swipes are ignored (a sheet or overlay is open). */
  enabled: boolean;
  children: [ReactNode, ReactNode, ReactNode];
  handle?: Ref<PagerHandle>;
};

const COMMIT = 0.28; // share of the width that turns a pull into a page change
const SETTLE_MS = 400;

export function Pager({ page, onPage, onDrag, enabled, children, handle }: Props) {
  const secs = useRef<(HTMLElement | null)[]>([null, null, null]);
  const gap = useRef<HTMLDivElement>(null);
  const st = useRef({ x: 0, y: 0, down: false, drag: false, dx: 0, settling: false, crossed: false, w: 390 });
  const pageRef = useRef(page);
  pageRef.current = page;

  const width = () => st.current.w;

  const paint = useCallback(
    (dx: number, animate: boolean, dirOverride?: number) => {
      const w = width();
      const p = pageRef.current;
      const dir = dirOverride ?? (dx < 0 ? 1 : -1);
      const target = p + dir;
      const prog = Math.min(1, Math.abs(dx) / w);
      const active = dx !== 0 || st.current.settling;
      const tr = animate ? `transform ${SETTLE_MS}ms ${ease}, border-radius ${SETTLE_MS}ms, filter ${SETTLE_MS}ms` : "none";
      secs.current.forEach((el, i) => {
        if (!el) return;
        el.style.transition = tr;
        if (!active) {
          Object.assign(el.style, { transform: `translateX(${(i - p) * w}px)`, borderRadius: "0px", filter: "none", zIndex: i === p ? "2" : "0", visibility: i === p ? "visible" : "hidden" });
          return;
        }
        if (i === p) {
          const k = Math.min(1, prog * 2.2);
          Object.assign(el.style, { transform: `translateX(${dx}px) scale(${(1 - 0.07 * k).toFixed(3)})`, borderRadius: `${Math.round(44 * k)}px`, filter: `brightness(${(1 - 0.35 * prog).toFixed(2)})`, zIndex: "2", visibility: "visible" });
        } else if (i === target && target >= 0 && target <= 2) {
          Object.assign(el.style, { transform: `translateX(0px) scale(${(0.93 + 0.07 * prog).toFixed(3)})`, borderRadius: `${Math.round(44 * (1 - prog))}px`, filter: `blur(${(14 * (1 - prog)).toFixed(1)}px) brightness(${(0.55 + 0.45 * prog).toFixed(2)})`, zIndex: "1", visibility: "visible" });
        } else {
          Object.assign(el.style, { visibility: "hidden", zIndex: "0" });
        }
      });
      if (gap.current) gap.current.style.opacity = active ? "1" : "0";
      onDrag?.(dx, animate, p);
    },
    [onDrag],
  );

  const settleTo = useCallback(
    (n: number, fromDx: number) => {
      const p = pageRef.current;
      const s = st.current;
      s.settling = true;
      const dir = n === p ? (fromDx < 0 ? 1 : -1) : n > p ? 1 : -1;
      const fin = n === p ? 0 : n > p ? -width() : width();
      // Start from the current offset, then animate to the end on the next frame.
      paint(fromDx, false, dir);
      requestAnimationFrame(() => paint(fin, true, dir));
      window.setTimeout(() => {
        s.settling = false;
        s.dx = 0;
        if (n !== p) {
          pageRef.current = n;
          feel("pageSettle");
          onPage(n);
        }
        paint(0, false);
      }, SETTLE_MS);
    },
    [onPage, paint],
  );

  useImperativeHandle(handle, () => ({
    goTo: (n: number) => {
      if (n === pageRef.current || st.current.settling || n < 0 || n > 2) return;
      settleTo(n, 0);
    },
  }));

  useLayoutEffect(() => {
    const measure = () => {
      st.current.w = window.innerWidth;
      if (!st.current.settling && !st.current.drag) paint(0, false);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [paint]);

  useEffect(() => {
    if (!st.current.settling) paint(0, false);
  }, [page, paint]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || st.current.settling) return;
    Object.assign(st.current, { x: e.clientX, y: e.clientY, down: true, drag: false, crossed: false });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.down) return;
    const dx = e.clientX - s.x;
    if (!s.drag) {
      const dy = e.clientY - s.y;
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        s.down = false; // vertical scroll wins
        return;
      }
      if (Math.abs(dx) < 10) return;
      s.drag = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
    }
    const p = pageRef.current;
    let d = dx;
    if ((p === 0 && d > 0) || (p === 2 && d < 0)) d *= 0.25; // rubber band at the ends
    d = Math.max(-width(), Math.min(width(), d));
    s.dx = d;
    const crossed = Math.abs(d) > width() * COMMIT && !((p === 0 && d > 0) || (p === 2 && d < 0));
    if (crossed !== s.crossed) {
      s.crossed = crossed;
      feel("pageCross");
    }
    paint(d, false);
  };
  const onPointerUp = () => {
    const s = st.current;
    const was = s.drag;
    s.down = false;
    s.drag = false;
    if (!was) return;
    const p = pageRef.current;
    const n = s.crossed ? Math.max(0, Math.min(2, p + (s.dx < 0 ? 1 : -1))) : p;
    settleTo(n, s.dx);
  };

  return (
    <>
      <div ref={gap} aria-hidden="true" style={{ position: "absolute", inset: 0, background: "#141416", opacity: 0 }} />
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ position: "absolute", inset: 0, touchAction: "pan-y" }}
      >
        {children.map((child, i) => (
          <section
            key={i}
            ref={(el) => {
              secs.current[i] = el;
            }}
            aria-hidden={i !== page}
            style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000", transformOrigin: "50% 50%", willChange: "transform" }}
          >
            {child}
          </section>
        ))}
      </div>
    </>
  );
}
