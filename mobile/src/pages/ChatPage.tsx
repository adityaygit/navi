import { useEffect, useRef } from "react";
import { useMe } from "../data/me";
import { useChat } from "../data/chat";
import { rememberChat } from "../data/chats";
import { Composer } from "../ui/Composer";
import { Stone } from "../ui/Stone";
import { Thread, buildItems } from "../ui/Thread";
import { ink, momentAt, type Palette } from "../theme/tokens";

const greetWord = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" } as const;

type Props = { palette: Palette; chatId: string | null; onChatId: (id: string | null) => void; onVoice: () => void };

export function ChatPage({ palette: P, chatId, onChatId, onVoice }: Props) {
  const me = useMe();
  const { state, sendText, undo, decide } = useChat(chatId);
  const first = me?.name?.split(/\s+/)[0];

  // A new chat gets its id from the server on the first message.
  useEffect(() => {
    // Only a brand-new chat reports its server id upward; switching chats flows the other way.
    if (!chatId && state.conversationId) onChatId(state.conversationId);
    if (state.conversationId) rememberChat(state.conversationId);
  }, [state.conversationId, chatId, onChatId]);

  // Only messages that arrive while you watch animate in.
  const seen = useRef<Set<string> | null>(null);
  const items = buildItems(state.messages, state.actions, state.live);
  if (seen.current === null && !state.loading) seen.current = new Set(items.map((i) => i.key));
  const isNew = (k: string) => !!seen.current && !seen.current.has(k);
  useEffect(() => {
    if (seen.current) items.forEach((i) => seen.current!.add(i.key));
  });

  const fresh = !state.conversationId && state.messages.length === 0;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {fresh ? <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 520, background: P.scene, pointerEvents: "none", animation: "nFade 0.4s ease both" }} /> : null}
      <div style={{ height: "calc(var(--sat) + 48px)", flex: "none" }} />
      {fresh ? (
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px 32px", textAlign: "center", animation: "nFade 0.4s ease both" }}>
          <button type="button" aria-label="Talk to Navi" onClick={onVoice} style={{ width: 112, height: 104, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Stone w={96} h={88} bg={P.stone} shadow={`0 22px 50px ${P.stoneShadow}`} />
          </button>
          <p style={{ margin: "24px 0 0", fontSize: 30, lineHeight: 1.22, fontWeight: 600, letterSpacing: "-0.02em", color: "rgba(255,255,255,0.5)" }}>
            <span style={{ color: "#fff" }}>{greetWord[momentAt()]}{first ? `, ${first}` : ""}.</span> What's on your mind?
          </p>
        </div>
      ) : (
        <div className="scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column-reverse", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 40px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 40px)" }}>
          <div style={{ padding: "40px 20px 24px" }}>
            {state.loading && !state.messages.length ? <p style={{ margin: 0, textAlign: "center", color: ink.faint, fontSize: 15 }}>Opening your chat…</p> : null}
            <Thread items={items} P={P} undone={state.undone} onUndo={undo} onDecide={decide} isNew={isNew} />
          </div>
        </div>
      )}
      {state.error ? (
        <p role="alert" style={{ position: "relative", margin: "0 20px 4px", fontSize: 15, color: "#FF9A9A", animation: "nRise 0.3s ease both" }}>{state.error}</p>
      ) : null}
      <div style={{ position: "relative", flex: "none", padding: "8px 16px var(--sab)" }}>
        <Composer palette={P} onSend={(t) => void sendText(t)} onVoice={onVoice} />
      </div>
    </div>
  );
}
