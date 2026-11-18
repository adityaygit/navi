import type React from "react";
// Navi M6 "Sky" design system (owner lock 2026-11-16). Source of truth:
// docs/navi-1.5/mobile/DESIGN_M6.md and docs/navi-1.5/design-canvas/M6-*.dc.html.

export type Moment = "morning" | "afternoon" | "evening" | "night";

export type Palette = {
  /** Navi's colour for this part of the day: accents, links, the dot. */
  accent: string;
  /** Solid primary buttons. */
  cta: string;
  /** The stone (Navi's orb). */
  stone: string;
  stoneShadow: string;
  glow: string;
  /** Soft wash behind the top of a page. */
  scene: string;
  /** Highlighted words in sentences. */
  hi: string;
  /** Focus "Start" is the only gradient button. */
  ctaGrad: string;
};

// M6 "Sky" (owner lock 2026-11-16): one light palette for every moment. The
// moment only picks which sky is shown (day or dusk). Field names are kept
// from M4 so every screen reads them the same way.
const day: Palette = {
  accent: "#2457D6",
  cta: "#11141A",
  hi: "#11141A",
  stone: "#CADCFC",
  stoneShadow: "rgba(60,100,170,0.45)",
  glow: "rgba(160,200,255,0.35)",
  scene: "linear-gradient(180deg, rgba(251,251,253,0.22) 0px, rgba(251,251,253,0.12) 150px, rgba(251,251,253,0.62) 300px, #FBFBFD 430px)",
  ctaGrad: "#11141A",
};

export const palettes: Record<Moment, Palette> = { morning: day, afternoon: day, evening: day, night: day };

/** Which sky a moment uses. */
export const skyFor = (m: Moment): "day" | "dusk" => (m === "evening" || m === "night" ? "dusk" : "day");

export function momentAt(date = new Date()): Moment {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

/** Fixed meanings, independent of the time of day (text-safe on white). */
export const meaning = {
  kept: "#1E7A53",
  slipping: "#B23A17",
  steady: "#5B4BB0",
  needsOk: "#7A4300",
  needsOkBg: "rgba(233,169,58,0.18)",
  deadlineBg: "rgba(238,122,92,0.16)",
  deadline: "#A3330F",
} as const;

/** Category dots. */
export const spaceColor: Record<string, string> = {
  school: "#EE7A5C",
  work: "#4D86FF",
  friends: "#E9A93A",
  health: "#36B386",
  hobby: "#9A7BE0",
  home: "#D9A93A",
  rest: "#A3A8BF",
};

export const ink = {
  bg: "#FBFBFD",
  grouped: "#F3F5F9",
  raised: "#FFFFFF",
  field: "rgba(255,255,255,0.6)",
  text: "#11141A",
  onCta: "#FFFFFF",
  soft: "#1A1F2A",
  muted: "#2E3442",
  faint: "#3B4252",
  dim: "#5B6272",
  line: "rgba(17,20,26,0.06)",
  edge: "rgba(17,20,26,0.08)",
  link: "#2457D6",
  flexible: "#EEF3FC",
  flexibleEdge: "rgba(77,134,255,0.18)",
} as const;

/** Glass for things you touch, and the stronger glass for sheets. */
export const glass: React.CSSProperties = {
  background: "rgba(255,255,255,0.6)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  backdropFilter: "blur(24px) saturate(180%)",
  border: "1px solid rgba(17,20,26,0.06)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 6px 20px -12px rgba(36,62,110,0.3)",
};
export const glassStrong: React.CSSProperties = {
  background: "rgba(255,255,255,0.86)",
  WebkitBackdropFilter: "blur(30px) saturate(180%)",
  backdropFilter: "blur(30px) saturate(180%)",
  border: "1px solid rgba(17,20,26,0.05)",
  boxShadow: "inset 0 1px 0 #fff, 0 24px 50px -20px rgba(36,62,110,0.28)",
};
export const floatShadow = "0 1px 2px rgba(20,32,64,0.05), 0 10px 30px -14px rgba(20,32,64,0.18)";

/** Type scale (M6): nothing under 14; 15 secondary · 17 body · 19–20 card title · 24 sentence · 36–46 bold display. */
export const type = {
  label: { fontSize: 14, fontWeight: 700, letterSpacing: "0.02em" },
  foot: { fontSize: 14, fontWeight: 500 },
  secondary: { fontSize: 15, fontWeight: 500 },
  body: { fontSize: 17 },
  cardTitle: { fontSize: 19, fontWeight: 700, letterSpacing: "-0.015em" },
  sentence: { fontSize: 24, fontWeight: 700, lineHeight: 1.25, letterSpacing: "-0.02em" },
  display: { fontSize: 36, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.035em" },
  title: { fontSize: 36, fontWeight: 700, letterSpacing: "-0.035em" },
  hero: { fontSize: 50, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.04em" },
} as const;

/** 4/8 grid. Page margin is 20; floating bars sit 16 from the edges. */
export const space = { margin: 20, float: 16 } as const;

/** 18 rows · 20 blocks · 24 cards · 28 pills · 36 dialogs · 38 sheets. */
export const radius = { row: 18, block: 20, card: 24, dialog: 36, sheet: 38 } as const;

export const ease = "cubic-bezier(0.2, 0.9, 0.25, 1)";
export const easeOut = "cubic-bezier(0.4, 0, 1, 1)";

/** The stone's organic outline. */
export const stoneShape = "50% 50% 46% 54% / 56% 52% 48% 44%";
