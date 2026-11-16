import { forwardRef, useImperativeHandle, useRef } from "react";
import { ease, glass, ink } from "../theme/tokens";
import { Orb } from "../ui/Orb";
import type { SkyName } from "../ui/sky";

// M6 header: ☰ (chats and account), a glass pill with the three pages whose
// white thumb follows the finger while you pull between pages, and Inbox with
// its count. Navi's tab carries a small orb so it reads as the assistant.
export const NAMES = ["Progress", "Navi", "Plan"] as const;
const SLOT = 80;

export type HeaderHandle = { follow: (dx: number, animate: boolean, page: number) => void };

type Props = {
  page: number;
  onPick: (n: number) => void;
  onMenu: () => void;
  onInbox: () => void;
  /** Things waiting in Inbox (approvals + things to add). */
  waiting: number;
  /** A small dot after "Plan" when something needs your OK. */
  planDot?: boolean;
  sky: SkyName;
};

export const Header = forwardRef<HeaderHandle, Props>(function Header({ page, onPick, onMenu, onInbox, waiting, planDot, sky }, ref) {
  const thumb = useRef<HTMLSpanElement>(null);

  const place = (dx: number, animate: boolean, p: number) => {
    const w = window.innerWidth;
    const x = Math.max(0, Math.min(SLOT * 2, p * SLOT - (dx * SLOT) / w));
    if (thumb.current) {
      thumb.current.style.transition = animate ? `transform 0.4s ${ease}` : "none";
      thumb.current.style.transform = `translateX(${x}px)`;
    }
  };
  useImperativeHandle(ref, () => ({ follow: place }));

  const round: React.CSSProperties = { ...glass, width: 48, height: 48, borderRadius: 24, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", position: "relative" };

  return (
    <header style={{ position: "absolute", left: 12, right: 12, top: "calc(var(--sat) + 4px)", height: 48, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "space-between", pointerEvents: "none" }}>
      <button type="button" aria-label="Chats and account" onClick={onMenu} style={{ ...round, pointerEvents: "auto" }}>
        <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true"><path d="M2 2h16M2 7h11M2 12h16" stroke={ink.text} strokeWidth="1.9" strokeLinecap="round" /></svg>
      </button>
      <nav aria-label="Pages" style={{ ...glass, position: "relative", height: 48, padding: 4, boxSizing: "border-box", borderRadius: 24, display: "flex", pointerEvents: "auto" }}>
        <span ref={thumb} aria-hidden="true" style={{ position: "absolute", top: 4, left: 4, width: SLOT, height: 38, borderRadius: 19, background: "#FFFFFF", boxShadow: "0 2px 8px rgba(36,62,110,0.16)", transform: `translateX(${page * SLOT}px)` }} />
        {NAMES.map((t, i) => {
          const cur = i === page;
          return (
            <button key={t} type="button" aria-current={cur ? "page" : undefined} onClick={() => onPick(i)} style={{ position: "relative", width: SLOT, height: 38, borderRadius: 19, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 15, fontWeight: cur ? 700 : 600, color: cur ? ink.text : ink.muted, transition: "color 0.25s" }}>
              {i === 1 ? <Orb size={16} sky={sky} /> : null}
              {t}
              {i === 2 && planDot && page !== 2 ? <span aria-label="needs your OK" style={{ width: 6, height: 6, borderRadius: 3, background: "#E2552B" }} /> : null}
            </button>
          );
        })}
      </nav>
      <button type="button" aria-label={waiting ? `Inbox, ${waiting} waiting` : "Inbox"} onClick={onInbox} style={{ ...round, pointerEvents: "auto" }}>
        <svg width="20" height="18" viewBox="0 0 20 18" aria-hidden="true"><path d="M2 10l2.5-7h11L18 10v5.5H2z" fill="none" stroke={ink.text} strokeWidth="1.8" strokeLinejoin="round" /><path d="M2 10h5l1 2h4l1-2h5" fill="none" stroke={ink.text} strokeWidth="1.8" strokeLinejoin="round" /></svg>
        {waiting ? <span aria-hidden="true" style={{ position: "absolute", top: 5, right: 5, minWidth: 18, height: 18, padding: "0 5px", boxSizing: "border-box", borderRadius: 9, background: ink.text, color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{waiting}</span> : null}
      </button>
    </header>
  );
});
