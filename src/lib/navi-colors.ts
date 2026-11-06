/**
 * Navi's own colour (Pebble's body and Navi's small accents). The person picks it
 * in Settings; it's stored in profiles.preferences.navi_color. Meaning colours
 * (fixed, flexible, focus, recovery, clash) never change with it.
 */
export type NaviColorKey = "amber" | "rose" | "lilac" | "sky" | "mint" | "lime" | "peach" | "pearl";

export type NaviColor = {
  key: NaviColorKey;
  name: string;
  /** Highlight, body and shade stops of Pebble's gradient. */
  light: string;
  mid: string;
  dark: string;
  /** Pebble's eyes, and text placed on the mid colour. */
  ink: string;
  /** Navi-coloured text on the dark page (checked for at least 4.5:1 on #060608). */
  text: string;
};

export const NAVI_COLORS: NaviColor[] = [
  { key: "amber", name: "Amber", light: "#FFE7B0", mid: "#F5A83A", dark: "#C9661C", ink: "#2A1606", text: "#FFD58A" },
  { key: "rose", name: "Rose", light: "#FFD3E1", mid: "#F27BA0", dark: "#B9406A", ink: "#2E0A18", text: "#FFB8CE" },
  { key: "lilac", name: "Lilac", light: "#E6DCFF", mid: "#A98BFF", dark: "#6A4BCB", ink: "#1B1033", text: "#CDBDFF" },
  { key: "sky", name: "Sky", light: "#D9EEFF", mid: "#6FB7FF", dark: "#2F6FC4", ink: "#0A1A2E", text: "#AFD6FF" },
  { key: "mint", name: "Mint", light: "#D6FBEF", mid: "#5FD3B0", dark: "#22906F", ink: "#062219", text: "#9FEBD3" },
  { key: "lime", name: "Lime", light: "#F0FFD0", mid: "#B5E05A", dark: "#6E9A22", ink: "#172404", text: "#D3F09A" },
  { key: "peach", name: "Peach", light: "#FFE2D6", mid: "#FF9E7A", dark: "#C4593A", ink: "#2B0F06", text: "#FFC4AE" },
  { key: "pearl", name: "Pearl", light: "#FFFFFF", mid: "#DDDAD3", dark: "#9A968E", ink: "#1A1A1C", text: "#EDEBE6" },
];

export const DEFAULT_NAVI_COLOR: NaviColorKey = "amber";

export function naviColor(key: unknown): NaviColor {
  return NAVI_COLORS.find((c) => c.key === key) ?? NAVI_COLORS[0];
}

/** CSS custom properties that colour Pebble and Navi's accents everywhere below them. */
export function naviColorVars(key: unknown): Record<string, string> {
  const c = naviColor(key);
  return {
    "--navi-light": c.light,
    "--navi-mid": c.mid,
    "--navi-dark": c.dark,
    "--navi-ink": c.ink,
    "--navi-text": c.text,
  };
}
