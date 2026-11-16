import { useId, useState } from "react";
import { HoldToTalk } from "./HoldToTalk";
import { feel } from "../native/haptics";
import { glass, ink, type Palette } from "../theme/tokens";

// The message bar (M6): a glass pill to type in, with send inside once there's
// text, and Navi's orb beside it: hold the orb to talk.
type Props = { palette: Palette; placeholder?: string; initial?: string; autoFocus?: boolean; onSend: (text: string) => void; onVoice: () => void; offline?: boolean; onOfflineTalk?: () => void; bg?: string };

export function Composer({ placeholder = "Ask Navi anything", initial = "", autoFocus, onSend, onVoice, offline, onOfflineTalk }: Props) {
  const [draft, setDraft] = useState(initial);
  const id = useId();
  const send = () => {
    const t = draft.trim();
    if (!t) return;
    feel("send");
    setDraft("");
    onSend(t);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ ...glass, flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, height: 56, boxSizing: "border-box", padding: "0 6px 0 20px", borderRadius: 28 }}>
        <label htmlFor={id} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{placeholder}</label>
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          enterKeyHint="send"
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder={placeholder}
          style={{ flex: 1, minWidth: 0, height: 44, border: 0, outline: "none", background: "transparent", fontSize: 17, fontWeight: 500, color: ink.text }}
        />
        {draft.trim() ? (
          <button type="button" aria-label="Send" onPointerDown={(e) => e.preventDefault()} onClick={send} style={{ width: 44, height: 44, borderRadius: 22, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: ink.text, color: "#fff", animation: "nFade 0.15s ease both" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
          </button>
        ) : null}
      </div>
      <HoldToTalk disabled={offline} onDisabledTap={onOfflineTalk} onVoice={onVoice} />
    </div>
  );
}
