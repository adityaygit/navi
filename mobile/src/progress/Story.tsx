import { useEffect, useState } from "react";
import type { MStoryCard } from "@shared/mobile-api-you";
import { feel } from "../native/haptics";
import { skyProps, useSkyOn, type SkyName } from "../ui/sky";
import { useExit } from "../ui/useExit";
import { Layer } from "../ui/Layer";
import { ease, glass, ink } from "../theme/tokens";

// A story (M6): the one place the sky fills the screen. One sentence a card,
// the word that matters in italic, the sky drifting a little with each card.

const POS = ["50% 10%", "50% 45%", "50% 100%", "50% 70%"];

export function Story({ name, cards, sky, onClose }: { name: string; cards: MStoryCard[]; sky: SkyName; onClose: () => void }) {
  const [i, setI] = useState(0);
  const skyOn = useSkyOn();
  const { closing, close } = useExit(300);
  const s = skyProps(sky, skyOn);
  const last = i === cards.length - 1;
  const c = cards[i];
  const next = () => {
    if (last) {
      feel("success");
      close(onClose);
    } else {
      feel("select");
      setI(i + 1);
    }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(onClose);
      if (e.key === "ArrowRight") setI((x) => Math.min(cards.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [cards.length, close, onClose]);
  if (!c) return null;

  return (
    <Layer>
    <section role="dialog" aria-label={name} style={{ position: "absolute", inset: 0, zIndex: 25, overflow: "hidden", background: ink.bg, animation: closing ? "nFadeOut 0.3s ease both" : "nFade 0.35s ease both" }}>
      <div aria-hidden="true" className={s.className} style={{ ...s.style, position: "absolute", inset: 0, backgroundPosition: POS[i % POS.length], transition: `background-position 0.8s ${ease}` }} />
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(251,251,253,0) 35%, rgba(251,251,253,0.65) 62%, rgba(251,251,253,0.95) 100%)" }} />
      <div aria-hidden="true" style={{ position: "absolute", left: 16, right: 16, top: "calc(var(--sat) + 8px)", display: "flex", gap: 4 }}>
        {cards.map((_, k) => (
          <span key={k} style={{ flex: 1, height: 3, borderRadius: 2, background: k <= i ? ink.text : "rgba(17,20,26,0.15)", transition: "background-color 0.3s" }} />
        ))}
      </div>
      <button type="button" aria-label="Close" onClick={() => close(onClose)} style={{ ...glass, position: "absolute", right: 16, top: "calc(var(--sat) + 24px)", width: 48, height: 48, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke={ink.text} strokeWidth="1.9" strokeLinecap="round" /></svg>
      </button>
      <h2 key={i} aria-live="polite" style={{ position: "absolute", left: 24, right: 24, bottom: "calc(var(--sab) + 98px)", margin: 0, fontSize: "clamp(34px, 11vw, 44px)", lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.035em", color: "#0E1116", animation: `nRise 0.5s ${ease} both` }}>
        {c.a}
        <span className="em">{c.b}</span>
        {c.c}
      </h2>
      <div style={{ position: "absolute", left: 16, right: 16, bottom: "var(--sab)", display: "flex", gap: 8 }}>
        <button type="button" disabled={i === 0} onClick={() => { feel("select"); setI(i - 1); }} style={{ ...glass, flex: 1, height: 58, borderRadius: 29, fontSize: 17, fontWeight: 600, textAlign: "center", opacity: i === 0 ? 0.5 : 1 }}>Back</button>
        <button type="button" onClick={next} style={{ flex: 2, height: 58, borderRadius: 29, background: ink.text, color: "#fff", fontSize: 17, fontWeight: 600, textAlign: "center" }}>{last ? "Done" : "Next"}</button>
      </div>
    </section>
    </Layer>
  );
}
