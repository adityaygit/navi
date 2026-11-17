import { useEffect, useRef, useState } from "react";
import { useChat } from "../data/chat";
import { Composer } from "../ui/Composer";
import { Thread, buildItems } from "../ui/Thread";
import { useExit } from "../ui/useExit";
import { useSheetDrag } from "../ui/Sheet";
import { useHideToast } from "../ui/Toast";
import { feel } from "../native/haptics";
import { Orb } from "../ui/Orb";
import { useMoment } from "../theme/colour";
import { ease, glass, glassStrong, ink, skyFor, type Palette } from "../theme/tokens";

// Navi in context (M4): a half sheet over Plan or Progress that knows what
// you're looking at. It starts its own chat; "expand" carries that chat over
// to the Navi page. The page underneath never moves.

export type AskRequest = { context: string; viewing: string; prompt?: string; send?: boolean };

type Props = { palette: Palette; req: AskRequest; onClose: () => void; onExpand: (chatId: string | null) => void; onVoice: () => void };

export function AskSheet({ palette: P, req, onClose, onExpand, onVoice }: Props) {
  const { state, sendText, stop, undo, decide } = useChat(null);
  const [editing, setEditing] = useState<{ text: string; nonce: number } | null>(null);
  const sky = skyFor(useMoment());
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
  const drag = useSheetDrag(onClose);
  const hasCard = items.some((i) => i.k === "card");
  const height = full ? "calc(100% - var(--sat) - 12px)" : hasCard ? "min(640px, 78%)" : empty ? "min(420px, 60%)" : "min(540px, 70%)";

  return (
    <>
      <button ref={drag.scrim} type="button" aria-label="Close" tabIndex={-1} onClick={shut} style={{ position: "absolute", inset: 0, zIndex: 11, background: full ? "rgba(20,30,52,0.2)" : "rgba(20,30,52,0.14)", animation: closing ? "nFadeOut 0.28s ease both" : "nFade 0.3s ease backwards", transition: "background-color 0.3s" }} />
      <div ref={drag.wrap} style={{ position: "absolute", inset: 0, zIndex: 12, pointerEvents: "none" }}>
      <section role="dialog" aria-label={`Navi, about ${req.context}`} {...drag.handlers} style={{ pointerEvents: "auto", position: "absolute", left: 0, right: 0, bottom: 0, height, maxHeight: "calc(100% - var(--sat) - 12px)", zIndex: 12, ...glassStrong, borderRadius: "38px 38px 0 0", borderTop: "1px solid rgba(17,20,26,0.08)", boxShadow: "0 -24px 60px rgba(20,30,52,0.2)", display: "flex", flexDirection: "column", transition: `height 0.32s ${ease}`, animation: closing ? `nDown 0.28s ${ease} both` : `nUp 0.36s ${ease} both` }}>
        <button type="button" aria-label={full ? "Make smaller" : "Make bigger"} onClick={() => { feel("select"); setFull((f) => !f); }} style={{ flex: "none", height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span aria-hidden="true" style={{ width: 40, height: 5, borderRadius: 3, background: "rgba(17,20,26,0.22)" }} />
        </button>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 8px 0 20px", minHeight: 56 }}>
          <Orb size={22} sky={sky} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Navi</span>
            <span style={{ fontSize: 13, color: ink.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>About {req.context}</span>
          </span>
          <button type="button" aria-label="Open as a full chat" onClick={() => close(() => onExpand(state.conversationId))} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: ink.muted }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>
          </button>
          <button type="button" aria-label="Close" onClick={shut} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: ink.soft }}>
            <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(17,20,26,0.08)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </span>
          </button>
        </div>
        <div className="scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column-reverse", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 40px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 40px)" }}>
          <div style={{ padding: "32px 20px 16px" }}>
            {empty ? <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: ink.faint }}>Ask about {req.context}: move something, find time, or check what's coming.</p> : null}
            <Thread items={items} P={P} undone={state.undone} onUndo={undo} onDecide={decide} isNew={isNew} onEdit={(text) => setEditing({ text, nonce: Date.now() })} busy={state.sending} />
            {state.error ? <p role="alert" style={{ margin: "12px 0 0", fontSize: 15, color: "#B23A17" }}>{state.error}</p> : null}
          </div>
        </div>
        <div style={{ flex: "none", padding: "8px 16px var(--sab)" }}>
          <Composer palette={P} bg="#FFFFFF" placeholder="Ask…" initial={req.send ? "" : req.prompt ?? ""} autoFocus={!req.send && !!req.prompt} onSend={(t) => { setEditing(null); void sendText(t, req.viewing); }} onVoice={onVoice} busy={state.sending} onStop={stop} editing={editing} onCancelEdit={() => setEditing(null)} />
        </div>
      </section>
      </div>
    </>
  );
}

/** The resting bar at the bottom of Plan and Progress (M6): glass, Navi's orb, what you'd ask about. */
export function AskBar({ text, onOpen }: { palette: Palette; text: string; onOpen: () => void; onVoice: () => void }) {
  const sky = skyFor(useMoment());
  return (
    <>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 130, zIndex: 4, background: "linear-gradient(to bottom, rgba(251,251,253,0) 0%, rgba(251,251,253,0.92) 45%, #FBFBFD 100%)", pointerEvents: "none" }} />
      <button type="button" onClick={onOpen} style={{ ...glass, position: "absolute", left: 16, right: 16, bottom: "var(--sab)", zIndex: 5, display: "flex", alignItems: "center", gap: 12, height: 56, boxSizing: "border-box", padding: "0 10px", borderRadius: 28 }}>
        <Orb size={38} sky={sky} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 600, color: ink.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
      </button>
    </>
  );
}
