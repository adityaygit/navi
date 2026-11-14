import { useState } from "react";
import { useChatList, type ChatSummary } from "../data/chats";
import { useMe } from "../data/me";
import { supabase } from "../auth/supabase";
import { feel } from "../native/haptics";
import { getSetting, setSetting } from "../native/settings";
import { useExit } from "../ui/useExit";
import { ease, ink } from "../theme/tokens";

type Props = { currentId: string | null; onOpen: (id: string | null) => void; onClose: () => void };

function group(chats: ChatSummary[]): { h: string; items: ChatSummary[] }[] {
  const today = new Date().toDateString();
  const t = chats.filter((c) => new Date(c.updated_at).toDateString() === today);
  const e = chats.filter((c) => new Date(c.updated_at).toDateString() !== today);
  return [
    ...(t.length ? [{ h: "Today", items: t }] : []),
    ...(e.length ? [{ h: "Earlier", items: e }] : []),
  ];
}

export function Drawer({ currentId, onOpen, onClose }: Props) {
  const { chats } = useChatList(true);
  const me = useMe();
  const [q, setQ] = useState("");
  const [acct, setAcct] = useState(false);
  const [haptics, setHaptics] = useState(getSetting("haptics"));
  const { closing, close } = useExit(260);
  const shut = (after?: () => void) => close(() => { onClose(); after?.(); });

  const list = (chats ?? []).filter((c) => !q.trim() || (c.title ?? "").toLowerCase().includes(q.trim().toLowerCase()));
  const name = me?.name ?? "You";

  return (
    <>
      <button type="button" aria-label="Close" onClick={() => shut()} style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(0,0,0,0.6)", animation: closing ? "nFadeOut 0.26s ease both" : "nFade 0.3s ease both" }} />
      <aside aria-label="Chats and account" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "min(320px, 82vw)", zIndex: 11, background: ink.raised, boxSizing: "border-box", padding: "calc(var(--sat) + 10px) 12px var(--sab)", display: "flex", flexDirection: "column", animation: closing ? `nLeftOut 0.26s ${ease} both` : `nLeft 0.34s ${ease} both` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ flex: 1, height: 48, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderRadius: 14, background: "rgba(255,255,255,0.06)", color: ink.faint, fontSize: 17 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Search chats</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" style={{ flex: 1, minWidth: 0, height: 44, border: 0, outline: "none", background: "transparent", fontSize: 17 }} />
          </label>
          <button type="button" aria-label="New chat" onClick={() => { feel("select"); shut(() => onOpen(null)); }} style={{ width: 48, height: 48, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.06)" }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h8" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          </button>
        </div>
        <div className="scroll" style={{ flex: 1, marginTop: 8, display: "flex", flexDirection: "column" }}>
          {chats === null ? <p style={{ padding: "20px 12px", margin: 0, color: ink.faint, fontSize: 15 }}>Loading your chats…</p> : null}
          {chats && !list.length ? <p style={{ padding: "20px 12px", margin: 0, color: ink.faint, fontSize: 15 }}>{q ? "No chats match." : "No chats yet."}</p> : null}
          {group(list).map((g) => (
            <div key={g.h} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "20px 12px 8px", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: ink.faint }}>{g.h}</div>
              {g.items.map((c) => {
                const cur = c.id === currentId;
                return (
                  <button key={c.id} type="button" aria-current={cur || undefined} onClick={() => { feel("select"); shut(() => onOpen(c.id)); }} style={{ minHeight: 48, display: "flex", alignItems: "center", padding: "0 12px", borderRadius: 12, fontSize: 17, color: cur ? ink.text : ink.soft, background: cur ? "rgba(255,255,255,0.08)" : "transparent", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.title || "New chat"}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {acct ? (
          <div style={{ marginBottom: 8, padding: 4, borderRadius: 16, background: "#1A1A1D", border: `1px solid ${ink.edge}`, display: "flex", flexDirection: "column", animation: `nRise 0.26s ${ease} both` }}>
            <button type="button" role="switch" aria-checked={haptics} onClick={() => { const v = !haptics; setSetting("haptics", v); setHaptics(v); if (v) feel("select"); }} style={{ minHeight: 48, display: "flex", alignItems: "center", padding: "0 12px", borderRadius: 12, fontSize: 17 }}>
              <span style={{ flex: 1 }}>Vibrations</span>
              <span aria-hidden="true" style={{ width: 44, height: 26, borderRadius: 13, background: haptics ? "#A7EBC0" : "rgba(255,255,255,0.16)", position: "relative", transition: "background-color 0.2s" }}>
                <span style={{ position: "absolute", top: 3, left: haptics ? 21 : 3, width: 20, height: 20, borderRadius: 10, background: "#fff", transition: `left 0.2s ${ease}` }} />
              </span>
            </button>
            <button type="button" onClick={() => void supabase.auth.signOut()} style={{ minHeight: 48, display: "flex", alignItems: "center", padding: "0 12px", borderRadius: 12, fontSize: 17, color: "#FF9A9A" }}>Sign out</button>
          </div>
        ) : null}
        <button type="button" aria-expanded={acct} onClick={() => { feel("select"); setAcct((a) => !a); }} style={{ height: 56, display: "flex", alignItems: "center", gap: 12, padding: "0 8px 0 6px", borderRadius: 16 }}>
          <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "#2A2A2E", fontWeight: 600 }}>{name.slice(0, 1).toUpperCase()}</span>
          <span style={{ flex: 1, fontSize: 17, fontWeight: 500 }}>{name}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={ink.muted} strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></svg>
        </button>
      </aside>
    </>
  );
}
