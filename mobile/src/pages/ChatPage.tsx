import { useMe } from "../data/me";
import { Composer } from "../ui/Composer";
import { Stone } from "../ui/Stone";
import { momentAt, type Palette } from "../theme/tokens";

const greetWord = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" } as const;

export function ChatPage({ palette: P, onVoice }: { palette: Palette; onVoice: () => void }) {
  const me = useMe();
  const first = me?.name?.split(/\s+/)[0];
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 520, background: P.scene, pointerEvents: "none" }} />
      <div style={{ height: "calc(var(--sat) + 48px)", flex: "none" }} />
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px 32px", textAlign: "center", animation: "nFade 0.4s ease both" }}>
        <button type="button" aria-label="Talk to Navi" onClick={onVoice} style={{ width: 112, height: 104, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Stone w={96} h={88} bg={P.stone} shadow={`0 22px 50px ${P.stoneShadow}`} />
        </button>
        <p style={{ margin: "24px 0 0", fontSize: 30, lineHeight: 1.22, fontWeight: 600, letterSpacing: "-0.02em", color: "rgba(255,255,255,0.5)" }}>
          <span style={{ color: "#fff" }}>{greetWord[momentAt()]}{first ? `, ${first}` : ""}.</span> What's on your mind?
        </p>
      </div>
      <div style={{ position: "relative", flex: "none", padding: "8px 16px var(--sab)" }}>
        <Composer palette={P} onSend={() => {}} onVoice={onVoice} />
      </div>
    </div>
  );
}
