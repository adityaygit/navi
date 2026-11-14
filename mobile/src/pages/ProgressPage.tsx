import { ink, type Palette } from "../theme/tokens";

export function ProgressPage({ palette: P }: { palette: Palette }) {
  return (
    <div className="scroll" style={{ position: "absolute", inset: 0, padding: "calc(var(--sat) + 54px) 20px 150px", boxSizing: "border-box" }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 460, background: P.scene, pointerEvents: "none" }} />
      <h1 style={{ position: "relative", margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>This week</h1>
      <p style={{ position: "relative", margin: "24px 0 0", fontSize: 17, lineHeight: 1.45, color: ink.faint }}>Your week arrives here in a later build.</p>
    </div>
  );
}
