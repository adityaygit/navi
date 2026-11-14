import { useEffect, useState, useSyncExternalStore } from "react";
import { NAVI_COLORS, type NaviColor } from "@shared/navi-colors";
import { momentAt, palettes, type Moment, type Palette } from "./tokens";

// Navi's colour in the app: either the time of day (M4 default, "Follow the
// day") or one of the eight colours the person also sees on the website. The
// last choice is kept on the phone so the first frame after launch is right.

export type ColourChoice = { followsDay: boolean; color: Pick<NaviColor, "key" | "light" | "mid" | "dark" | "text"> };

const KEY = "navi.colour";
const listeners = new Set<() => void>();

function load(): ColourChoice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null") as ColourChoice | null;
    if (v && typeof v.followsDay === "boolean" && v.color?.mid) return v;
  } catch {
    /* fall through */
  }
  return { followsDay: true, color: NAVI_COLORS[0] };
}

let choice = load();

export function rememberColour(next: ColourChoice) {
  if (next.followsDay === choice.followsDay && next.color.key === choice.color.key) return;
  choice = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: still applies for this session */
  }
  listeners.forEach((l) => l());
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A full M4 palette built from one of Navi's colours. */
export function paletteFromColour(c: ColourChoice["color"]): Palette {
  return {
    accent: c.text,
    cta: c.text,
    hi: c.text,
    stone: `radial-gradient(circle at 34% 28%, ${c.light} 0%, ${c.mid} 34%, ${c.dark} 100%)`,
    stoneShadow: hexA(c.mid, 0.32),
    glow: hexA(c.mid, 0.13),
    scene: `radial-gradient(ellipse 120% 70% at 50% 0%, ${hexA(c.dark, 0.55)} 0%, ${hexA(c.dark, 0.22)} 45%, rgba(0,0,0,0) 75%)`,
    ctaGrad: `linear-gradient(90deg, ${c.light}, ${c.text})`,
  };
}

export function paletteFor(ch: ColourChoice, moment: Moment = momentAt()): Palette {
  return ch.followsDay ? palettes[moment] : paletteFromColour(ch.color);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The palette every screen uses. Follows the person's choice and, when it follows the day, the clock. */
export function usePalette(): Palette {
  const ch = useSyncExternalStore(subscribe, () => choice);
  const [moment, setMoment] = useState(momentAt());
  useEffect(() => {
    if (!ch.followsDay) return;
    const t = window.setInterval(() => setMoment(momentAt()), 60_000);
    return () => window.clearInterval(t);
  }, [ch.followsDay]);
  return paletteFor(ch, moment);
}
