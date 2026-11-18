import { skyUrl, type SkyName } from "./sky";

// Navi's orb (M6): a flat disc of sky turning slowly, soft white petals and a
// breathing white ring, after ChatGPT voice and the ElevenLabs orb. No 3D
// lighting. It appears only where Navi is.

type Props = { size: number; sky?: SkyName; mode?: "idle" | "talk" | "mute"; style?: React.CSSProperties; className?: string };

export function Orb({ size, sky = "day", mode = "idle", style, className }: Props) {
  const cls = ["orb", size < 70 ? "sm" : "", mode === "talk" ? "talk" : "", mode === "mute" ? "mute" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span aria-hidden="true" className={cls} style={{ width: size, height: size, ...style }}>
      <span className="orb-sky" style={{ backgroundImage: `url(${skyUrl(sky === "focus" ? "day" : sky)})` }} />
      {size >= 24 ? <span className="orb-petal" /> : null}
      {size >= 24 ? <span className="orb-ring" /> : null}
    </span>
  );
}
