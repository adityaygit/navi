import type { CSSProperties } from "react";

/** The Navi stone: Navi's presence on every page. Decorative unless labelled. */
export function Stone({ size = 18, lit = false, live = false, label, className = "" }: { size?: number; lit?: boolean; live?: boolean; label?: string; className?: string }) {
  return (
    <span
      className={`stone${lit ? " stone-lit" : ""}${live ? " stone-live" : ""} ${className}`}
      style={{ "--stone-size": `${size}px` } as CSSProperties}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}
