import { NAVI_COLORS } from "@shared/navi-colors";
import type { MMe } from "@shared/mobile-api-types";
import { Stone } from "../ui/Stone";
import { paletteFor, type ColourChoice } from "../theme/colour";
import { ink, momentAt, palettes, type Moment } from "../theme/tokens";
import { card } from "./parts";

// Navi's colour: a live preview (the stone, a highlighted word and the main
// button as they'll look) above a grid of swatches. "The day" keeps the M4
// behaviour, where the colour moves with morning, afternoon, evening, night.

const momentName: Record<Moment, string> = { morning: "peach this morning", afternoon: "mint this afternoon", evening: "gold this evening", night: "lilac tonight" };
const dayDisc = `conic-gradient(from 210deg, ${palettes.morning.accent}, ${palettes.afternoon.accent}, ${palettes.evening.accent}, ${palettes.night.accent}, ${palettes.morning.accent})`;

type Props = { me: MMe; onPick: (followsDay: boolean, key?: MMe["naviColor"]["key"]) => void };

export function ColourPicker({ me: raw, onPick }: Props) {
  const me = { ...raw, colourFollowsDay: raw.colourFollowsDay !== false };
  const choice: ColourChoice = { followsDay: me.colourFollowsDay, color: me.naviColor };
  const P = paletteFor(choice);
  const name = me.colourFollowsDay ? "the day" : me.naviColor.name;

  return (
    <section style={{ marginTop: 28 }} aria-label="Navi's colour">
      <h2 style={{ margin: "0 0 8px 16px", fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: ink.faint }}>Navi's colour</h2>
      <div style={{ borderRadius: 16, background: card, overflow: "hidden" }}>
        {/* Preview */}
        <div aria-hidden="true" style={{ position: "relative", height: 148, background: P.scene, display: "flex", alignItems: "center", gap: 18, padding: "0 20px", transition: "background 0.4s" }}>
          <Stone key={me.colourFollowsDay ? "day" : me.naviColor.key} w={68} h={62} bg={P.stone} shadow={`0 14px 34px ${P.stoneShadow}`} style={{ animation: "nGrow 0.36s ease both" }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
              You have <span style={{ color: P.hi }}>2 hours free</span> after lunch.
            </p>
            <span style={{ alignSelf: "flex-start", height: 34, padding: "0 16px", borderRadius: 17, display: "flex", alignItems: "center", background: P.ctaGrad, color: "#0B0B0C", fontSize: 15, fontWeight: 600 }}>Start focus</span>
          </div>
        </div>

        {/* Swatches */}
        <div role="radiogroup" aria-label="Choose Navi's colour" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", rowGap: 14, padding: "18px 8px 16px" }}>
          <Swatch label="The day" bg={dayDisc} on={me.colourFollowsDay} onPick={() => onPick(true)} />
          {NAVI_COLORS.map((c) => (
            <Swatch key={c.key} label={c.name} bg={`radial-gradient(circle at 34% 28%, ${c.light} 0%, ${c.mid} 40%, ${c.dark} 100%)`} on={!me.colourFollowsDay && me.naviColor.key === c.key} onPick={() => onPick(false, c.key)} />
          ))}
        </div>
      </div>
      <p style={{ margin: "8px 16px 0", fontSize: 13, lineHeight: 1.45, color: ink.dim }}>
        {me.colourFollowsDay
          ? `Navi follows the time of day: ${momentName[momentAt()]}. Meaning colours, like done and slipping, never change.`
          : `Navi is ${name.toLowerCase()} everywhere, on the website too. Meaning colours, like done and slipping, never change.`}
      </p>
    </section>
  );
}

function Swatch({ label, bg, on, onPick }: { label: string; bg: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} onClick={onPick} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, minHeight: 72 }}>
      <span aria-hidden="true" style={{ position: "relative", width: 46, height: 46, borderRadius: 23, background: bg, boxShadow: on ? `0 0 0 3px ${card}, 0 0 0 5px #F5F5F7` : "inset 0 0 0 1px rgba(255,255,255,0.08)", transform: on ? "scale(1)" : "scale(0.92)", transition: "transform 0.22s cubic-bezier(0.2,0.9,0.25,1), box-shadow 0.22s" }}>
        {on ? (
          <svg width="16" height="12" viewBox="0 0 13 10" fill="none" stroke="rgba(0,0,0,0.72)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 15, top: 17 }}><path d="M1.5 5.2 4.8 8.5 11.5 1.5" /></svg>
        ) : null}
      </span>
      <span style={{ fontSize: 12, fontWeight: on ? 600 : 400, color: on ? ink.text : ink.faint }}>{label}</span>
    </button>
  );
}
