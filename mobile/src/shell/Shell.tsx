import { useCallback, useRef, useState } from "react";
import { Header, type HeaderHandle } from "./Header";
import { Pager, type PagerHandle } from "./Pager";
import { ChatPage } from "../pages/ChatPage";
import { PlanPage } from "../pages/PlanPage";
import { ProgressPage } from "../pages/ProgressPage";
import { momentAt, palettes } from "../theme/tokens";

export function Shell() {
  const [page, setPage] = useState(1);
  const [overlay, setOverlay] = useState<null | "drawer" | "voice">(null);
  const header = useRef<HeaderHandle>(null);
  const pager = useRef<PagerHandle>(null);
  const P = palettes[momentAt()];

  const onDrag = useCallback((dx: number, animate: boolean, p: number) => header.current?.follow(dx, animate, p), []);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
      <Pager page={page} onPage={setPage} onDrag={onDrag} enabled={overlay === null} handle={pager}>
        <ProgressPage palette={P} />
        <ChatPage palette={P} onVoice={() => setOverlay("voice")} />
        <PlanPage palette={P} />
      </Pager>
      <Header ref={header} page={page} onPick={(n) => pager.current?.goTo(n)} onMenu={() => setOverlay("drawer")} planDot={null} />
    </div>
  );
}
