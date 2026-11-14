import { stoneShape } from "../theme/tokens";

/** Navi's stone. `fill` (0–1) shows a partly filled stone (Progress). */
export function Stone({ w, h, bg, shadow, style }: { w: number; h: number; bg: string; shadow?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" style={{ display: "block", flex: "none", width: w, height: h, borderRadius: stoneShape, background: bg, boxShadow: shadow, ...style }} />;
}
