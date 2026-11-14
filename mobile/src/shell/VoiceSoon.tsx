import { Stone } from "../ui/Stone";
import { useExit } from "../ui/useExit";
import { ease, ink, type Palette } from "../theme/tokens";

// Placeholder until live voice lands (build step 4): honest, and easy to leave.
export function VoiceSoon({ palette: P, onClose }: { palette: Palette; onClose: () => void }) {
  const { closing, close } = useExit(300);
  return (
    <section aria-label="Voice" style={{ position: "absolute", inset: 0, zIndex: 20, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", padding: "calc(var(--sat) + 10px) 20px var(--sab)", boxSizing: "border-box", animation: closing ? `nSink 0.3s ${ease} both` : `nGrow 0.36s ${ease} both` }}>
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: 150, width: 520, height: 520, marginLeft: -260, borderRadius: "50%", background: `radial-gradient(circle, ${P.glow} 0%, rgba(0,0,0,0) 70%)` }} />
      <div style={{ alignSelf: "stretch", display: "flex", justifyContent: "flex-start", position: "relative" }}>
        <button type="button" aria-label="Close voice" onClick={() => close(onClose)} style={{ width: 44, height: 44, borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.08)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      <Stone w={150} h={136} bg={P.stone} style={{ marginTop: 70, position: "relative" }} shadow={`0 0 0 14px ${P.glow}, 0 0 0 30px rgba(255,255,255,0.03)`} />
      <p style={{ position: "relative", margin: "44px 0 0", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em", textAlign: "center" }}>Voice arrives in the next build.</p>
      <p style={{ position: "relative", margin: "12px 0 0", fontSize: 17, lineHeight: 1.45, color: ink.muted, textAlign: "center" }}>Holding Talk will open a live conversation with Navi right here.</p>
      <div style={{ flex: 1 }} />
      <button type="button" onClick={() => close(onClose)} style={{ position: "relative", alignSelf: "stretch", height: 56, borderRadius: 28, background: P.cta, color: "#0B0B0C", fontSize: 17, fontWeight: 600, textAlign: "center" }}>Back to chat</button>
    </section>
  );
}
