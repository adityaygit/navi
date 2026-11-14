import { useEffect, useRef, useState } from "react";
import { useChat } from "../data/chat";
import { Composer } from "../ui/Composer";
import { HoldToTalk } from "../ui/HoldToTalk";
import { Stone } from "../ui/Stone";
import { Thread, buildItems } from "../ui/Thread";
import { useExit } from "../ui/useExit";
import { useHideToast } from "../ui/Toast";
import { feel } from "../native/haptics";
import { ease, ink, type Palette } from "../theme/tokens";

// Navi in context (M4): a half sheet over Plan or Progress that knows what
// you're looking at. It starts its own chat; "expand" carries that chat over
// to the Navi page. The page underneath never moves.

export type AskRequest = { context: string; viewing: string; prompt?: string; send?: boolean };

type Props = { palette: Palette; req: AskRequest; onClose: () => void; onExpand: (chatId: string | null) => void; onVoice: () => void };

export function AskSheet({ palette: P, req, onClose, onExpand, onVoice }: Props) {
  const { state, sendText, undo, decide } = useChat(null);
  const hideToast = useHideToast();
  useEffect(() => hideToast(), [hideToast]);
  const { closing, close } = useExit(280);
  const [full, setFull] = useState(false);
  const sent = useRef(false);

  useEffect(() => {
    if (req.send && req.prompt && !sent.current) {
      sent.current = true;
      void sendText(req.prompt, req.viewing);
    }
  }, [req, sendText]);

  const items = buildItems(state.messages, state.actions, state.live);
  const seen = useRef(new Set<string>());
  const isNew = (k: string) => !seen.current.has(k);
  useEffect(() => {
    items.forEach((i) => seen.current.add(i.key));
  });

  const empty = !items.length;
  const shut = () => close(onClose);
  const hasCard = items.some((i) => i.k === "card");
  const height = full ? "calc(100% - var(--sat) - 12px)" : hasCard ? "min(640px, 78%)" : empty ? "min(420px, 60%)" : "min(540px, 70%)";

  return (
    <>
      <button type="button" aria-label="Close" onClick={shut} style={{ position: "absolute", inset: 0, zIndex: 11, background: full ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.25)", animation: closing ? "nFadeOut 0.28s ease both" : "nFade 0.3s ease both", transition: "background-color 0.3s" }} />
      <section aria-label={`Navi, about ${req.context}`} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height, zIndex: 12, background: "#0D0D0F", borderRadius: "32px 32px 0 0", borderTop: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 -24px 60px rgba(0,0,0,0.7)", display: "flex", flexDirection: "column", transition: `height 0.32s ${ease}`, animation: closing ? `nDown 0.28s ${ease} both` : `nUp 0.36s ${ease} both` }}>
        <button type="button" aria-label={full ? "Make smaller" : "Make bigger"} onClick={() => { feel("select"); setFull((f) => !f); }} style={{ flex: "none", height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span aria-hidden="true" style={{ width: 40, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.25)" }} />
        </button>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 8px 0 20px", minHeight: 56 }}>
          <Stone w={20} h={18} bg={P.stone} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Navi</span>
            <span style={{ fontSize: 13, color: ink.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>About {req.context}</span>
          </span>
          <button type="button" aria-label="Open as a full chat" onClick={() => close(() => onExpand(state.conversationId))} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: ink.muted }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>
          </button>
          <button type="button" aria-label="Close" onClick={shut} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: ink.soft }}>
            <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.10)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </span>
          </button>
        </div>
        <div className="scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column-reverse", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 40px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 40px)" }}>
          <div style={{ padding: "32px 20px 16px" }}>
            {empty ? <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: ink.faint }}>Ask about {req.context}: move something, find time, or check what's coming.</p> : null}
            <Thread items={items} P={P} undone={state.undone} onUndo={undo} onDecide={decide} isNew={isNew} />
            {state.error ? <p role="alert" style={{ margin: "12px 0 0", fontSize: 15, color: "#FF9A9A" }}>{state.error}</p> : null}
          </div>
        </div>
        <div style={{ flex: "none", padding: "8px 16px var(--sab)" }}>
          <Composer palette={P} bg="#19191C" placeholder="Ask…" initial={req.send ? "" : req.prompt ?? ""} autoFocus={!req.send && !!req.prompt} onSend={(t) => void sendText(t, req.viewing)} onVoice={onVoice} />
        </div>
      </section>
    </>
  );
}

/** The resting bar at the bottom of Plan and Progress. */
export function AskBar({ palette: P, text, onOpen, onVoice }: { palette: Palette; text: string; onOpen: () => void; onVoice: () => void }) {
  return (
    <>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 130, zIndex: 4, background: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.92) 45%, #000 100%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: 16, right: 16, bottom: "var(--sab)", zIndex: 5, display: "flex", alignItems: "center", gap: 8, height: 56, boxSizing: "border-box", padding: "0 6px 0 20px", borderRadius: 28, background: "rgba(30,30,33,0.94)", border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 12px 30px rgba(0,0,0,0.5)" }}>
        <button type="button" onClick={() => { feel("select"); onOpen(); }} style={{ flex: 1, minWidth: 0, height: 52, display: "flex", alignItems: "center", gap: 12 }}>
          <Stone w={16} h={15} bg={P.stone} />
          <span style={{ fontSize: 17, color: ink.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
        </button>
        <HoldToTalk compact bg="transparent" color={ink.soft} onVoice={onVoice} />
      </div>
    </>
  );
}
