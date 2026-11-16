import { useRef, useState } from "react";
import { useChatList, type ChatSummary } from "../data/chats";
import { useMe } from "../data/me";
import { feel } from "../native/haptics";
import { useExit } from "../ui/useExit";
import { ease, easeOut, glassStrong, ink } from "../theme/tokens";

type Props = { currentId: string | null; onOpen: (id: string | null) => void; onClose: () => void; onSettings: () => void };

function group(chats: ChatSummary[]): { h: string; items: ChatSummary[] }[] {
  const today = new Date().toDateString();
  const t = chats.filter((c) => new Date(c.updated_at).toDateString() === today);
  const e = chats.filter((c) => new Date(c.updated_at).toDateString() !== today);
  return [
    ...(t.length ? [{ h: "Today", items: t }] : []),
    ...(e.length ? [{ h: "Earlier", items: e }] : []),
  ];
}

export function Drawer({ currentId, onOpen, onClose, onSettings }: Props) {
  const { chats } = useChatList(true);
  const me = useMe();
  const [q, setQ] = useState("");
  const { closing, close } = useExit(260);
  const shut = (after?: () => void) => close(() => { onClose(); after?.(); });

  // Drag it back to the left to close (past ~110 px); a short pull springs back.
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; on: boolean; crossed: boolean } | null>(null);
  const put = (dx: number, animate: boolean) => {
    if (!wrap.current) return;
    wrap.current.style.transition = animate ? `transform 0.3s ${ease}` : "none";
    wrap.current.style.transform = dx ? `translateX(${dx}px)` : "";
  };
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, on: false, crossed: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.on) {
      if (Math.abs(dx) < 8) return;
      if (dx > 0 || Math.abs(e.clientY - d.y) > Math.abs(dx)) {
        drag.current = null; // a scroll or a push the wrong way
        return;
      }
      d.on = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* fine */
      }
    }
    d.dx = Math.min(0, dx);
    if (-d.dx > 110 !== d.crossed) {
      d.crossed = -d.dx > 110;
      if (d.crossed) feel("sheet");
    }
    put(d.dx, false);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.on) return;
    if (-d.dx > 110) {
      if (wrap.current) {
        wrap.current.style.transition = `transform 0.24s ${easeOut}`;
        wrap.current.style.transform = "translateX(-110%)";
      }
      window.setTimeout(onClose, 230);
    } else put(0, true);
  };

  const list = (chats ?? []).filter((c) => !q.trim() || (c.title ?? "").toLowerCase().includes(q.trim().toLowerCase()));
  const name = me?.name ?? "You";

  return (
    <>
      <button type="button" aria-label="Close" onClick={() => shut()} style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(20,30,52,0.2)", animation: closing ? "nFadeOut 0.26s ease both" : "nFade 0.3s ease both" }} />
      <div ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ position: "absolute", inset: 0, zIndex: 11, pointerEvents: "none" }}>
      <aside aria-label="Chats and account" style={{ ...glassStrong, pointerEvents: "auto", position: "absolute", left: 8, top: 8, bottom: 8, width: "min(310px, 80vw)", zIndex: 11, borderRadius: 36, boxSizing: "border-box", padding: "calc(var(--sat) + 6px) 12px calc(var(--sab) - 8px)", display: "flex", flexDirection: "column", overflow: "hidden", animation: closing ? `nLeftOut 0.26s ${ease} both` : `nLeft 0.38s ${ease} both`}}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ flex: 1, height: 48, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderRadius: 14, background: "rgba(17,20,26,0.05)", color: ink.faint, fontSize: 17 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Search chats</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" style={{ flex: 1, minWidth: 0, height: 44, border: 0, outline: "none", background: "transparent", fontSize: 17 }} />
          </label>
          <button type="button" aria-label="New chat" onClick={() => { feel("select"); shut(() => onOpen(null)); }} style={{ width: 48, height: 48, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(17,20,26,0.05)" }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h8" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          </button>
        </div>
        <div className="scroll" style={{ flex: 1, marginTop: 8, display: "flex", flexDirection: "column" }}>
          {chats === null ? <p style={{ padding: "20px 12px", margin: 0, color: ink.faint, fontSize: 15 }}>Loading your chats…</p> : null}
          {chats && !list.length ? <p style={{ padding: "20px 12px", margin: 0, color: ink.faint, fontSize: 15 }}>{q ? "No chats match." : "No chats yet."}</p> : null}
          {group(list).map((g) => (
            <div key={g.h} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "20px 12px 8px", fontSize: 14, fontWeight: 700, color: ink.muted }}>{g.h}</div>
              {g.items.map((c) => {
                const cur = c.id === currentId;
                return (
                  <button key={c.id} type="button" aria-current={cur || undefined} onClick={() => { feel("select"); shut(() => onOpen(c.id)); }} style={{ minHeight: 48, display: "flex", alignItems: "center", padding: "0 12px", borderRadius: 12, fontSize: 17, color: cur ? ink.text : ink.soft, background: cur ? "rgba(17,20,26,0.05)" : "transparent", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.title || "New chat"}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => { feel("select"); shut(onSettings); }} style={{ height: 56, display: "flex", alignItems: "center", gap: 12, padding: "0 8px 0 6px", borderRadius: 16 }}>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Settings, memory, notes, activity and spaces</span>
          <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "#11141A", fontWeight: 600 }}>{name.slice(0, 1).toUpperCase()}</span>
          <span style={{ flex: 1, fontSize: 17, fontWeight: 500 }}>{name}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={ink.muted} strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></svg>
        </button>
      </aside>
      </div>
    </>
  );
}
