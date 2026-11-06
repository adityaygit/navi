import type { CSSProperties } from "react";

export type PebbleMood = "idle" | "listening" | "working" | "speaking" | "done" | "ask" | "nudge" | "quiet";

/**
 * Pebble, Navi's face. Pure CSS so it renders on the server and takes its colour
 * from the --navi-* variables the app layout sets from the person's choice.
 * Decorative unless a label is given. All motion stops under reduced motion.
 */
export function Pebble({
  size = 40,
  mood = "idle",
  glow = false,
  float = false,
  label,
  className = "",
}: {
  size?: number;
  mood?: PebbleMood;
  /** Only for moments that matter: the Today hero, Navi listening or working live. */
  glow?: boolean;
  float?: boolean;
  label?: string;
  className?: string;
}) {
  const style = { "--pebble-size": `${size}px` } as CSSProperties;
  return (
    <span
      className={`pebble pebble-${mood}${glow ? " pebble-glow" : ""}${float ? " pebble-float" : ""} ${className}`}
      style={style}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <span className="pebble-body">
        <span className="pebble-shine" />
        <span className="pebble-eye pebble-eye-l" />
        <span className="pebble-eye pebble-eye-r" />
        <span className="pebble-mouth" />
        <span className="pebble-brow" />
        <span className="pebble-blush pebble-blush-l" />
        <span className="pebble-blush pebble-blush-r" />
        <span className="pebble-dots"><i /><i /><i /></span>
      </span>
      {mood === "quiet" && <span className="pebble-z">z</span>}
    </span>
  );
}
