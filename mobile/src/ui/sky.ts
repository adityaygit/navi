import dayUrl from "../assets/sky-day.jpg";
import duskUrl from "../assets/sky-dusk.jpg";
import focusUrl from "../assets/sky-focus.jpg";
import { getSetting, subscribeSettings } from "../native/settings";
import { useSyncExternalStore } from "react";

// The three skies (M6): day, dusk and the one above the clouds for Focus.
// Each element also carries a colour class so something calm shows while the
// picture loads, and "Sky backgrounds" in Settings swaps them for a plain wash.

export type SkyName = "day" | "dusk" | "focus";
const urls: Record<SkyName, string> = { day: dayUrl, dusk: duskUrl, focus: focusUrl };

export function skyUrl(name: SkyName): string {
  return urls[name];
}

/** True unless the person switched sky backgrounds off. */
export function useSkyOn(): boolean {
  return useSyncExternalStore(subscribeSettings, () => getSetting("sky"));
}

/** className + style for an element that shows a sky. */
export function skyProps(name: SkyName, on: boolean): { className: string; style: React.CSSProperties } {
  if (!on) return { className: "sky sky-off", style: {} };
  return { className: `sky sky-${name}`, style: { backgroundImage: `url(${urls[name]})` } };
}
