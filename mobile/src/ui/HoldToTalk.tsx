import { useEffect, useRef, useState } from "react";
import { feel } from "../native/haptics";
import { ease } from "../theme/tokens";
import { useMoment } from "../theme/colour";
import { skyFor } from "../theme/tokens";
import { Orb } from "./Orb";

// Talk (M6): Navi's orb. Press and hold: a tick, rising ticks, and the orb
// swells; at 0.45 s voice opens with a medium bump. A quick tap only gives a
// double tick and "Press and hold to talk", so voice never starts by accident.
const HOLD_MS = 450;

type Props = { disabled?: boolean; onVoice: () => void; onDisabledTap?: () => void; compact?: boolean; size?: number; bg?: string; color?: string };

export function HoldToTalk({ disabled, onVoice, onDisabledTap, compact, size }: Props) {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const timers = useRef<number[]>([]);
  const started = useRef(0);
  const fired = useRef(false);
  const sky = skyFor(useMoment());
  const d = size ?? (compact ? 40 : 56);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const down = (e: React.PointerEvent) => {
    e.stopPropagation(); // never start a page swipe from Talk
    if (disabled) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    started.current = performance.now();
    fired.current = false;
    setHolding(true);
    setHint(false);
    feel("holdStart");
    timers.current.push(window.setTimeout(() => feel("holdRamp"), HOLD_MS * 0.34), window.setTimeout(() => feel("holdRamp"), HOLD_MS * 0.67));
    timers.current.push(
      window.setTimeout(() => {
        fired.current = true;
        setHolding(false);
        feel("voiceOn");
        onVoice();
      }, HOLD_MS),
    );
  };
  const up = () => {
    if (disabled) {
      onDisabledTap?.();
      return;
    }
    clear();
    setHolding(false);
    if (!fired.current && performance.now() - started.current < HOLD_MS) {
      feel("tapHint");
      setHint(true);
      timers.current.push(window.setTimeout(() => setHint(false), 1800));
    }
  };

  return (
    <span style={{ position: "relative", flex: "none" }}>
      {hint ? (
        <span role="status" style={{ position: "absolute", right: 0, bottom: "calc(100% + 12px)", whiteSpace: "nowrap", height: 34, padding: "0 14px", borderRadius: 17, background: "rgba(17,20,26,0.86)", color: "#fff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", animation: `nRise 0.26s ${ease} both` }}>
          Press and hold to talk
        </span>
      ) : null}
      <button
        type="button"
        className="hold"
        aria-label="Hold to talk to Navi"
        aria-disabled={disabled || undefined}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={() => {
          clear();
          setHolding(false);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            feel("voiceOn");
            onVoice();
          }
        }}
        style={{ width: d, height: d, borderRadius: d / 2, display: "block", opacity: disabled ? 0.5 : 1, filter: disabled ? "grayscale(1)" : undefined, transform: holding ? "scale(1.16)" : "none", transition: holding ? `transform ${HOLD_MS}ms cubic-bezier(0.3, 0, 0.2, 1)` : `transform 0.3s ${ease}`, boxShadow: compact ? undefined : "0 10px 24px -10px rgba(60,100,170,0.55)" }}
      >
        <Orb size={d} sky={sky} mode={holding ? "talk" : "idle"} />
      </button>
    </span>
  );
}
