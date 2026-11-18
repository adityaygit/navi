import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// Overlays opened from inside a page (sheets, the day picker, stories) render
// here, in one layer above the pages and the header and below toasts (z 40), so a
// page's own stacking can never put the header on top of them.

export const LAYER_ID = "navi-layer";

export function OverlayLayer() {
  return <div id={LAYER_ID} style={{ position: "absolute", inset: 0, zIndex: 35, pointerEvents: "none" }} />;
}

export function Layer({ children }: { children: ReactNode }) {
  const host = typeof document === "undefined" ? null : document.getElementById(LAYER_ID);
  const body = <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}>{children}</div>;
  return host ? createPortal(body, host) : body;
}
