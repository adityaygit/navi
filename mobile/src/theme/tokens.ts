// Navi M4 design system (approved 2026-11-13). Source of truth:
// docs/navi-1.5/design-canvas/M4-*.dc.html (M4-Colour board and the M4 spacing pass).

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

export const palettes: Record<Moment, Palette> = {
  morning: {
    accent: "#FFC4A3", cta: "#FFC4A3", hi: "#FFC4A3",
    stone: "radial-gradient(circle at 34% 28%, #FFF6EE 0%, #FFC4A3 32%, #B65A5A 100%)",
    stoneShadow: "rgba(255,150,130,0.35)", glow: "rgba(255,170,150,0.14)",
    scene: "radial-gradient(ellipse 120% 70% at 50% 0%, rgba(150,60,70,0.55) 0%, rgba(90,40,60,0.25) 45%, rgba(0,0,0,0) 75%)",
    ctaGrad: "linear-gradient(90deg, #FFD3B8, #FFB4A8)",
  },
  afternoon: {
    accent: "#A7EBC0", cta: "#B8F0C8", hi: "#CFF7A6",
    stone: "radial-gradient(circle at 34% 28%, #F4FFF8 0%, #A7EBC0 30%, #2E7D63 100%)",
    stoneShadow: "rgba(140,230,190,0.30)", glow: "rgba(167,235,192,0.11)",
    scene: "radial-gradient(ellipse 120% 70% at 50% 0%, rgba(30,100,90,0.50) 0%, rgba(20,60,70,0.22) 45%, rgba(0,0,0,0) 75%)",
    ctaGrad: "linear-gradient(90deg, #C9F5D6, #9EE6D8)",
  },
  evening: {
    accent: "#FFD08A", cta: "#FFD08A", hi: "#FFD08A",
    stone: "radial-gradient(circle at 34% 28%, #FFF8EA 0%, #FFD08A 32%, #A9663A 100%)",
    stoneShadow: "rgba(255,190,110,0.32)", glow: "rgba(255,190,120,0.13)",
    scene: "radial-gradient(ellipse 120% 70% at 50% 0%, rgba(150,80,40,0.50) 0%, rgba(110,40,70,0.25) 45%, rgba(0,0,0,0) 75%)",
    ctaGrad: "linear-gradient(90deg, #FFE0A8, #FFB79A)",
  },
  night: {
    accent: "#C7C1FF", cta: "#C7C1FF", hi: "#C7C1FF",
    stone: "radial-gradient(circle at 34% 28%, #F4F2FF 0%, #B9B2FF 32%, #4B3F9A 100%)",
    stoneShadow: "rgba(160,150,255,0.32)", glow: "rgba(170,160,255,0.13)",
    scene: "radial-gradient(ellipse 120% 70% at 50% 0%, rgba(60,50,140,0.55) 0%, rgba(30,30,90,0.25) 45%, rgba(0,0,0,0) 75%)",
    ctaGrad: "linear-gradient(90deg, #C7C1FF, #F7BFD8)",
  },
};

export function momentAt(date = new Date()): Moment {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

/** Fixed meanings, independent of the time of day. */
export const meaning = {
  kept: "#9FF0D8",
  slipping: "#FF9A9A",
  steady: "#C7C1FF",
  needsOk: "#F4B37A",
} as const;

export const spaceColor: Record<string, string> = {
  school: "#8C9EFF",
  work: "#8CC6EC",
  friends: "#F4B37A",
  health: "#F3988C",
  hobby: "#B79CF2",
  home: "#EBC66B",
};

export const ink = {
  bg: "#000000",
  raised: "#0D0D0F",
  field: "#141416",
  text: "#F5F5F7",
  soft: "#C8C8CE",
  muted: "#A0A0A8",
  faint: "#8E8E96",
  dim: "#7C7C85",
  line: "rgba(255,255,255,0.07)",
  edge: "rgba(255,255,255,0.09)",
} as const;

/** Type scale: 12 label · 13 footnote · 15 secondary · 17 body · 20 card title · 24 sentence · 28/30 display · 34 page title. */
export const type = {
  label: { fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const },
  foot: { fontSize: 13 },
  secondary: { fontSize: 15 },
  body: { fontSize: 17 },
  cardTitle: { fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" },
  sentence: { fontSize: 24, fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.015em" },
  display: { fontSize: 30, fontWeight: 600, lineHeight: 1.22, letterSpacing: "-0.02em" },
  title: { fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" },
} as const;

/** 4/8 grid. Page margin is 20; floating bars sit 16 from the edges. */
export const space = { margin: 20, float: 16 } as const;

/** 12 rows · 16 blocks and tiles · 24 cards · 28 dialogs · 32 sheets. */
export const radius = { row: 12, block: 16, card: 24, dialog: 28, sheet: 32 } as const;

export const ease = "cubic-bezier(0.2, 0.9, 0.25, 1)";

/** The stone's organic outline. */
export const stoneShape = "50% 50% 46% 54% / 56% 52% 48% 44%";
