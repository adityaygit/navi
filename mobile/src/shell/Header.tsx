import { forwardRef, useImperativeHandle, useRef } from "react";
import { ease, ink } from "../theme/tokens";

// Sliding page names (M4 navigation A): the current page sits centred, its
// neighbours dim at the sides, and the whole row follows the finger.
export const NAMES = ["Progress", "Navi", "Plan"] as const;
const SLOT = 96;

export type HeaderHandle = { follow: (dx: number, animate: boolean, page: number) => void };

type Props = {
  page: number;
  onPick: (n: number) => void;
  onMenu: () => void;
  /** A small dot after "Plan" when something waits there. */
  planDot?: string | null;
};

export const Header = forwardRef<HeaderHandle, Props>(function Header({ page, onPick, onMenu, planDot }, ref) {
  const track = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLButtonElement>(null);

  const place = (dx: number, animate: boolean, page: number) => {
    const w = window.innerWidth;
    const x = w / 2 - (page * SLOT + SLOT / 2) + Math.round((dx * SLOT) / w);
    if (track.current) {
      track.current.style.transition = animate ? `transform 0.4s ${ease}` : "none";
      track.current.style.transform = `translateX(${x}px)`;
    }
    if (menu.current) {
      // ☰ belongs to the Navi page: it fades as Navi is pulled away, and in as Navi arrives.
      const towardNavi = page !== 1 && ((page === 0 && dx < 0) || (page === 2 && dx > 0));
      const k = Math.min(1, Math.abs(dx) / w);
      const o = page === 1 ? 1 - k : towardNavi ? k : 0;
      menu.current.style.transition = animate ? `opacity 0.4s ${ease}` : "none";
      menu.current.style.opacity = String(o);
      menu.current.style.pointerEvents = o > 0.5 ? "auto" : "none";
    }
  };

  useImperativeHandle(ref, () => ({ follow: place }));

  const w = typeof window === "undefined" ? 390 : window.innerWidth;
  return (
    <header style={{ position: "absolute", left: 0, right: 0, top: "var(--sat)", height: 48, zIndex: 5 }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: "calc(-1 * var(--sat))", height: "calc(var(--sat) + 70px)", background: "linear-gradient(to bottom, rgba(0,0,0,0.94) 0, rgba(0,0,0,0.9) calc(100% - 24px), rgba(0,0,0,0) 100%)", pointerEvents: "none" }} />
      <nav aria-label="Pages" style={{ position: "absolute", inset: 0, overflow: "hidden", WebkitMaskImage: "linear-gradient(to right, transparent 0, #000 70px, #000 calc(100% - 70px), transparent 100%)", maskImage: "linear-gradient(to right, transparent 0, #000 70px, #000 calc(100% - 70px), transparent 100%)" }}>
        <div ref={track} style={{ position: "absolute", top: 0, left: 0, height: 48, display: "flex", transform: `translateX(${w / 2 - (page * SLOT + SLOT / 2)}px)` }}>
          {NAMES.map((t, i) => {
            const cur = i === page;
            return (
              <button
                key={t}
                type="button"
                aria-current={cur ? "page" : undefined}
                onClick={() => onPick(i)}
                style={{ width: SLOT, height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: cur ? 17 : 15, fontWeight: cur ? 600 : 500, color: cur ? ink.text : ink.faint, opacity: Math.abs(i - page) > 1 ? 0 : 1, transition: "all 0.25s" }}
              >
                {t}
                {i === 2 && planDot && page !== 2 ? <span aria-label="something waiting" style={{ width: 6, height: 6, borderRadius: 3, background: planDot }} /> : null}
              </button>
            );
          })}
        </div>
      </nav>
      <button
        ref={menu}
        type="button"
        aria-label="Chats and account"
        onClick={onMenu}
        style={{ position: "absolute", left: 6, top: 2, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: ink.soft, opacity: page === 1 ? 1 : 0, pointerEvents: page === 1 ? "auto" : "none" }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M4 9h16M4 15h10" />
        </svg>
      </button>
    </header>
  );
});
