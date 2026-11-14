import { useState } from "react";
import { HoldToTalk } from "./HoldToTalk";
import { feel } from "../native/haptics";
import { ink, type Palette } from "../theme/tokens";

// The message bar: type, or hold Talk for voice. Send appears once there's text.
type Props = { palette: Palette; placeholder?: string; onSend: (text: string) => void; onVoice: () => void; offline?: boolean; onOfflineTalk?: () => void };

export function Composer({ palette, placeholder = "Tell Navi anything", onSend, onVoice, offline, onOfflineTalk }: Props) {
  const [draft, setDraft] = useState("");
  const send = () => {
    const t = draft.trim();
    if (!t) return;
    feel("send");
    setDraft("");
    onSend(t);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 56, boxSizing: "border-box", padding: "5px 5px 5px 20px", borderRadius: 28, background: ink.field, border: `1px solid ${ink.edge}` }}>
      <label htmlFor="composer" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{placeholder}</label>
      <input
        id="composer"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            send();
          }
        }}
        enterKeyHint="send"
        autoComplete="off"
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, height: 44, border: 0, outline: "none", background: "transparent", fontSize: 17 }}
      />
      {draft.trim() ? (
        <button type="button" aria-label="Send" onPointerDown={(e) => e.preventDefault()} onClick={send} style={{ width: 44, height: 44, borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "center", background: ink.text, color: "#000", animation: "nFade 0.15s ease both" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      ) : (
        <HoldToTalk bg={offline ? "rgba(255,255,255,0.08)" : palette.cta} color={offline ? ink.dim : "#0B0B0C"} disabled={offline} onDisabledTap={onOfflineTalk} onVoice={onVoice} />
      )}
    </div>
  );
}
