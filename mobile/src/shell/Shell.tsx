import { useCallback, useRef, useState } from "react";
import { Header, type HeaderHandle } from "./Header";
import { Pager, type PagerHandle } from "./Pager";
import { Drawer } from "./Drawer";
import { VoiceSoon } from "./VoiceSoon";
import { AskSheet, type AskRequest } from "./AskSheet";
import { Focus, type FocusTarget } from "../focus/Focus";
import { sceneFor } from "../focus/scenes";
import { Stone } from "../ui/Stone";
import { feel } from "../native/haptics";
import { ChatPage } from "../pages/ChatPage";
import { PlanPage } from "../pages/PlanPage";
import { ProgressPage } from "../pages/ProgressPage";
import { chatToResume, rememberChat } from "../data/chats";
import { ToastHost } from "../ui/Toast";
import { useMoment, usePalette } from "../theme/colour";
import { skyFor } from "../theme/tokens";
import { Settings } from "../settings/Settings";

export function Shell() {
  const [page, setPage] = useState(1);
  const [overlay, setOverlay] = useState<null | "drawer" | "voice" | "settings">(null);
  const [ask, setAsk] = useState<AskRequest | null>(null);
  const [chatId, setChatId] = useState<string | null>(() => chatToResume());
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [pill, setPill] = useState<{ left: number; title: string } | null>(null);
  const [planVersion, setPlanVersion] = useState(0);
  const header = useRef<HeaderHandle>(null);
  const pager = useRef<PagerHandle>(null);
  const P = usePalette();
  const sky = skyFor(useMoment());
  const [waiting, setWaiting] = useState({ n: 0, ok: false });
  const [inboxSignal, setInboxSignal] = useState(0);
  const onWaiting = useCallback((n: number, ok: boolean) => setWaiting((w) => (w.n === n && w.ok === ok ? w : { n, ok })), []);

  const onDrag = useCallback((dx: number, animate: boolean, p: number) => header.current?.follow(dx, animate, p), []);
  const openChat = useCallback((id: string | null) => {
    setChatId(id);
    rememberChat(id);
  }, []);
  const voice = () => setOverlay("voice");

  return (
    <ToastHost bottom="calc(var(--sab) + 72px)">
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#E9EEF5" }}>
        <Pager page={page} onPage={setPage} onDrag={onDrag} enabled={overlay === null && ask === null && (!focus || !!pill)} handle={pager}>
          <ProgressPage palette={P} />
          <ChatPage palette={P} chatId={chatId} onChatId={setChatId} onVoice={voice} />
          <PlanPage palette={P} active={page === 2} onAsk={setAsk} onVoice={voice} onFocus={(f) => { setPill(null); setFocus(f); }} version={planVersion} inboxSignal={inboxSignal} onWaiting={onWaiting} />
        </Pager>
        <Header ref={header} page={page} sky={sky} waiting={waiting.n} planDot={waiting.ok} onPick={(n) => pager.current?.goTo(n)} onMenu={() => setOverlay("drawer")} onInbox={() => { if (page !== 2) pager.current?.goTo(2); setInboxSignal((v) => v + 1); }} />
        {ask ? (
          <AskSheet
            key={JSON.stringify(ask)}
            palette={P}
            req={ask}
            onClose={() => setAsk(null)}
            onVoice={voice}
            onExpand={(id) => {
              setAsk(null);
              if (id) openChat(id);
              pager.current?.goTo(1);
            }}
          />
        ) : null}
        {focus ? (
          <Focus
            key={focus.title + focus.blockId}
            target={focus}
            hidden={!!pill}
            onMinimize={(s) => setPill((prev) => (prev && prev.left === s.left && prev.title === s.title ? prev : s))}
            onClose={() => { setFocus(null); setPill(null); setPlanVersion((v) => v + 1); }}
          />
        ) : null}
        {focus && pill ? (
          <button type="button" onClick={() => { feel("select"); setPill(null); }} style={{ position: "absolute", left: 16, right: 16, bottom: "calc(var(--sab) + 68px)", zIndex: 9, height: 52, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", borderRadius: 26, background: "#FFFFFF", border: `1px solid ${sceneFor(focus.space).tint}55`, boxShadow: "0 12px 30px rgba(20,30,52,0.2)", animation: "nRise 0.34s ease both" }}>
            <Stone w={18} h={16} bg={sceneFor(focus.space).stone} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>In focus · {pill.title}</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{Math.floor(pill.left / 60)}:{String(pill.left % 60).padStart(2, "0")}</span>
          </button>
        ) : null}
        {overlay === "voice" ? <VoiceSoon palette={P} onClose={() => setOverlay(null)} /> : null}
        {overlay === "drawer" ? <Drawer currentId={chatId} onOpen={openChat} onClose={() => setOverlay(null)} onSettings={() => setOverlay("settings")} /> : null}
        {overlay === "settings" ? <Settings onClose={() => setOverlay(null)} /> : null}
      </div>
    </ToastHost>
  );
}
