import { useEffect, useState } from "react";
import markUrl from "../assets/logo-n.png";
import wordUrl from "../assets/logo-word.png";

// The opening (M6, ≈3.2 s, see docs/navi-1.5/design-canvas/M6-Opening.dc.html):
// white; the N fades in centred, slides left while "Navi" comes out from
// behind it; the lockup blurs out and the white dissolves as home rises.
// It holds on the lockup until the first screen is ready, so a slow start
// never reveals a half-drawn page. Plays once per cold launch.

const MARK_W = 97;
const MARK_H = 72;
const WORD_W = 156;
const WORD_H = 57;
const GAP = 17;
const LOCK_W = MARK_W + GAP + WORD_W;
const IN_MS = 2000; // mark in, slide, word in

type Props = { ready: boolean; onReveal: () => void; onDone: () => void };

export function Opening({ ready, onReveal, onDone }: Props) {
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [minDone, setMinDone] = useState(false);

  useEffect(() => {
    // The native launch screen is plain white; hand over to this at once.
    void import("@capacitor/splash-screen").then((m) => m.SplashScreen.hide({ fadeOutDuration: 0 })).catch(() => {});
    const t = window.setTimeout(() => setMinDone(true), IN_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (phase !== "in" || !minDone || !ready) return;
    setPhase("out");
    onReveal();
    const t = window.setTimeout(onDone, 1250);
    return () => window.clearTimeout(t);
  }, [phase, minDone, ready, onReveal, onDone]);

  const out = phase === "out";
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 100, background: "#FFFFFF", pointerEvents: out ? "none" : "auto", animation: out ? "nFadeOut 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.3s both" : undefined }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: LOCK_W, height: MARK_H, marginLeft: -LOCK_W / 2, marginTop: -MARK_H / 2, animation: out ? "opLockOut 0.42s cubic-bezier(0.4, 0, 1, 1) both" : undefined }}>
        <div style={{ position: "absolute", left: MARK_W + GAP, top: (MARK_H - WORD_H) / 2 + 4, width: WORD_W, height: WORD_H, animation: "opWord 0.7s cubic-bezier(0.2, 0.9, 0.25, 1) 1.4s both" }}>
          <img src={wordUrl} alt="" width={WORD_W} height={WORD_H} style={{ display: "block" }} />
        </div>
        <div style={{ ["--op-shift" as string]: `${(LOCK_W - MARK_W) / 2}px`, position: "absolute", left: -10, top: -6, width: MARK_W + 20, height: MARK_H + 12, borderRadius: 30, background: "#FFFFFF", animation: "opSlide 0.75s cubic-bezier(0.65, 0, 0.2, 1) 0.95s both" } as React.CSSProperties} />
        <div style={{ ["--op-shift" as string]: `${(LOCK_W - MARK_W) / 2}px`, position: "absolute", left: 0, top: 0, width: MARK_W, height: MARK_H, animation: "opSlide 0.75s cubic-bezier(0.65, 0, 0.2, 1) 0.95s both" } as React.CSSProperties}>
          <img src={markUrl} alt="" width={MARK_W} height={MARK_H} style={{ display: "block", animation: "opMarkIn 0.65s cubic-bezier(0.2, 0.9, 0.25, 1) 0.1s both" }} />
        </div>
      </div>
    </div>
  );
}
