/** Set by the Navi desktop app (Windows/Mac) in its preload script. */
export type NaviDesktop = { platform: "win32" | "darwin" | "linux"; version: string | null };

/** The desktop shell, when the page is running inside it (browser only). */
export function naviDesktop(): NaviDesktop | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { naviDesktop?: NaviDesktop }).naviDesktop ?? null;
}
