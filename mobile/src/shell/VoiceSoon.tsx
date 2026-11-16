import { useExit } from "../ui/useExit";
import { Orb } from "../ui/Orb";
import { useMoment } from "../theme/colour";
import { ease, ink, skyFor, type Palette } from "../theme/tokens";

// Placeholder until live voice lands (M6 build step 3): white, Navi's orb,
// honest about what's coming, and easy to leave.
export function VoiceSoon({ onClose }: { palette: Palette; onClose: () => void }) {
  const { closing, close } = useExit(300);
  const sky = skyFor(useMoment());
  return (
    <section aria-label="Voice" style={{ position: "absolute", inset: 0, zIndex: 20, background: ink.bg, display: "flex", flexDirection: "column", alignItems: "center", padding: "calc(var(--sat) + 10px) 20px var(--sab)", boxSizing: "border-box", animation: closing ? `nDim 0.26s ${ease} both` : `nFade 0.4s ease both` }}>
      <Orb size={220} sky={sky} mode="talk" style={{ marginTop: 130, animation: `nOrbIn 0.7s ${ease} both` }} />
      <p style={{ margin: "48px 0 0", fontSize: 30, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.03em", textAlign: "center" }}>Voice is <span className="em">almost here</span>.</p>
      <p style={{ margin: "12px 0 0", fontSize: 17, lineHeight: 1.45, fontWeight: 500, color: ink.muted, textAlign: "center" }}>Holding the orb will open a live conversation with Navi right here.</p>
      <div style={{ flex: 1 }} />
      <button type="button" onClick={() => close(onClose)} style={{ alignSelf: "stretch", height: 58, borderRadius: 29, background: ink.text, color: "#fff", fontSize: 17, fontWeight: 600, textAlign: "center" }}>Back to chat</button>
    </section>
  );
}
