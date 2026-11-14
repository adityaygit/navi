import { ink, type Palette } from "../theme/tokens";

const fmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const fmtSub = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function PlanPage({ palette: P }: { palette: Palette }) {
  const now = new Date();
  return (
    <div className="scroll" style={{ position: "absolute", inset: 0, padding: "calc(var(--sat) + 54px) 0 150px", boxSizing: "border-box" }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 460, background: P.scene, pointerEvents: "none" }} />
      <div style={{ position: "relative", padding: "0 20px", display: "flex", alignItems: "baseline", gap: 10, minHeight: 48 }}>
        <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>{fmt.format(now)}</span>
        <span style={{ fontSize: 17, color: ink.faint }}>{fmtSub.format(now)}</span>
      </div>
      <p style={{ position: "relative", margin: "20px 0 0", padding: "0 20px", fontSize: 17, lineHeight: 1.45, color: ink.faint }}>Your day arrives here in the next build.</p>
    </div>
  );
}
