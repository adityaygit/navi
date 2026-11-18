import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HoldToTalk } from "./HoldToTalk";
import { feel } from "../native/haptics";
import { ease, glass, ink, type Palette } from "../theme/tokens";

// The message bar (M6): a glass pill that grows with what you type (up to
// about six lines, then it scrolls inside), with Navi's orb beside it. Hold
// the orb to talk; once there's text the orb becomes Send; while Navi is
// working it becomes Stop. Editing a message puts it back here to change and
// send again.
type Props = {
  palette: Palette;
  placeholder?: string;
  initial?: string;
  autoFocus?: boolean;
  onSend: (text: string) => void;
  onVoice: () => void;
  offline?: boolean;
  onOfflineTalk?: () => void;
  /** Navi is answering: the button beside the bar stops it. */
  busy?: boolean;
  onStop?: () => void;
  /** A message to change and send again (a new `nonce` loads it). */
  editing?: { text: string; nonce: number } | null;
  onCancelEdit?: () => void;
  bg?: string;
};

const LINE = 24;
const PAD = 15;
const MAX = LINE * 6 + PAD * 2;

export function Composer({ placeholder = "Ask Navi anything", initial = "", autoFocus, onSend, onVoice, offline, onOfflineTalk, busy, onStop, editing, onCancelEdit }: Props) {
  const [draft, setDraft] = useState(initial);
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const has = draft.trim().length > 0;

  // Grow with the text; past six lines, scroll inside the bar.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    const h = Math.min(Math.max(el.scrollHeight, LINE + PAD * 2), MAX);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > MAX ? "auto" : "hidden";
  }, [draft]);

  // "Edit": the message comes back into the bar.
  useEffect(() => {
    if (!editing) return;
    setDraft(editing.text);
    const el = area.current;
    if (el) {
      el.focus();
      const n = editing.text.length;
      requestAnimationFrame(() => el.setSelectionRange(n, n));
    }
  }, [editing]);

  const send = () => {
    const t = draft.trim();
    if (!t || busy) return;
    feel("send");
    setDraft("");
    onSend(t);
  };
  const fine = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: fine)").matches;
  const keep = (e: React.PointerEvent) => e.preventDefault(); // pressing the button keeps the keyboard up

  const circle: React.CSSProperties = { width: 56, height: 56, borderRadius: 28, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: ink.text, color: "#fff", animation: `nPop 0.2s ${ease} both` };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {editing ? (
        <div style={{ ...glass, alignSelf: "flex-start", height: 36, padding: "0 6px 0 14px", borderRadius: 18, display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 600, color: ink.soft, animation: `nRise 0.26s ${ease} both` }}>
          Changing your message
          <button type="button" aria-label="Cancel editing" onPointerDown={keep} onClick={() => { setDraft(""); onCancelEdit?.(); }} style={{ width: 28, height: 28, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", color: ink.muted }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <div style={{ ...glass, flex: 1, minWidth: 0, position: "relative", boxSizing: "border-box", padding: "0 20px", borderRadius: 28 }}>
          <label htmlFor={id} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{placeholder}</label>
          <textarea
            ref={area}
            id={id}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // A phone's return key adds a line (Send is the button); a keyboard's Enter sends, Shift+Enter adds a line.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && fine()) {
                e.preventDefault();
                send();
              }
            }}
            enterKeyHint="enter"
            autoFocus={autoFocus}
            autoComplete="off"
            autoCapitalize="sentences"
            placeholder={placeholder}
            className="scroll"
            style={{ display: "block", width: "100%", boxSizing: "border-box", height: LINE + PAD * 2, padding: `${PAD}px 0`, margin: 0, border: 0, outline: "none", resize: "none", background: "transparent", fontSize: 17, lineHeight: `${LINE}px`, fontWeight: 500, color: ink.text, overflowY: "hidden" }}
          />
        </div>
        {busy ? (
          <button key="stop" type="button" aria-label="Stop" onPointerDown={keep} onClick={onStop} style={circle}>
            <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 5, background: "#fff" }} />
          </button>
        ) : has ? (
          <button key="send" type="button" aria-label="Send" onPointerDown={keep} onClick={send} style={circle}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
          </button>
        ) : (
          <div key="talk" style={{ animation: `nPop 0.2s ${ease} both` }}>
            <HoldToTalk disabled={offline} onDisabledTap={onOfflineTalk} onVoice={onVoice} />
          </div>
        )}
      </div>
    </div>
  );
}
