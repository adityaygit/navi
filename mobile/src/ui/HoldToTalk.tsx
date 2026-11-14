import { useEffect, useRef, useState } from "react";
import { feel } from "../native/haptics";
import { ease } from "../theme/tokens";

// Press and hold to start voice. A soft tick on touch, rising ticks while
// held, a firm bump when voice opens (~0.45 s). A quick tap only shows a hint,
// so voice never starts by accident.
const HOLD_MS = 450;

type Props = { bg: string; color: string; disabled?: boolean; onVoice: () => void; onDisabledTap?: () => void; compact?: boolean };

export function HoldToTalk({ bg, color, disabled, onVoice, onDisabledTap, compact }: Props) {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const timers = useRef<number[]>([]);
  const started = useRef(0);
  const fired = useRef(false);

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
    timers.current.push(window.setTimeout(() => feel("holdRamp"), 150), window.setTimeout(() => feel("holdRamp"), 300));
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
        <span role="status" style={{ position: "absolute", right: 0, bottom: "calc(100% + 12px)", whiteSpace: "nowrap", height: 32, padding: "0 12px", borderRadius: 16, background: "#2A2A2E", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", animation: `nRise 0.26s ${ease} both` }}>
          Hold to talk
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Hold to talk"
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
            onVoice();
          }
        }}
        style={{ position: "relative", overflow: "hidden", height: 44, width: compact ? 44 : undefined, padding: compact ? 0 : "0 16px", borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: bg, color, fontWeight: 600, fontSize: 15, transform: holding ? "scale(1.06)" : "none", transition: `transform 0.2s ${ease}`, touchAction: "none" }}
      >
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.45)", transformOrigin: "0 50%", transform: holding ? "scaleX(1)" : "scaleX(0)", transition: holding ? `transform ${HOLD_MS}ms linear` : "transform 0.15s" }} />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ position: "relative" }}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
        {compact ? null : <span style={{ position: "relative" }}>Talk</span>}
      </button>
    </span>
  );
}
