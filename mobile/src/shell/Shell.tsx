import { useCallback, useRef, useState } from "react";
import { Header, type HeaderHandle } from "./Header";
import { Pager, type PagerHandle } from "./Pager";
import { Drawer } from "./Drawer";
import { VoiceSoon } from "./VoiceSoon";
import { ChatPage } from "../pages/ChatPage";
import { PlanPage } from "../pages/PlanPage";
import { ProgressPage } from "../pages/ProgressPage";
import { chatToResume, rememberChat } from "../data/chats";
import { momentAt, palettes } from "../theme/tokens";

export function Shell() {
  const [page, setPage] = useState(1);
  const [overlay, setOverlay] = useState<null | "drawer" | "voice">(null);
  const [chatId, setChatId] = useState<string | null>(() => chatToResume());
  const header = useRef<HeaderHandle>(null);
  const pager = useRef<PagerHandle>(null);
  const P = palettes[momentAt()];

  const onDrag = useCallback((dx: number, animate: boolean, p: number) => header.current?.follow(dx, animate, p), []);
  const openChat = useCallback((id: string | null) => {
    setChatId(id);
    rememberChat(id);
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
      <Pager page={page} onPage={setPage} onDrag={onDrag} enabled={overlay === null} handle={pager}>
        <ProgressPage palette={P} />
        <ChatPage palette={P} chatId={chatId} onChatId={setChatId} onVoice={() => setOverlay("voice")} />
        <PlanPage palette={P} />
      </Pager>
      <Header ref={header} page={page} onPick={(n) => pager.current?.goTo(n)} onMenu={() => setOverlay("drawer")} planDot={null} />
      {overlay === "voice" ? <VoiceSoon palette={P} onClose={() => setOverlay(null)} /> : null}
      {overlay === "drawer" ? <Drawer currentId={chatId} onOpen={openChat} onClose={() => setOverlay(null)} /> : null}
    </div>
  );
}
