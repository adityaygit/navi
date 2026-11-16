import { useEffect, useRef, useState } from "react";
import { feel, type Feel } from "../native/haptics";
import { ease } from "../theme/tokens";

// Hold to confirm (M6, Opal-style), only where a slip costs time, money,
// other people or your account. Press: the button sinks to 0.97, a lighter
// fill sweeps across, ticks at ⅓ and ⅔; at the end it pops back and `done`
// fires with its feel. Letting go early drains the fill silently. A plain tap
// gives a double tick and a hint. Keyboard: hold Enter or Space. Screen
// readers activate with a single "click", which goes straight to a confirm
// step instead of a hold (`onConfirmStep`), or to `onDone` if none is given.

type Props = {
  ms: number;
  onDone: () => void;
  /** Feel when the hold completes: "holdDone" inside Navi, "commit" when something leaves Navi, "warning" for sign out. */
  doneFeel?: Feel;
  label: string;
  holdingLabel?: string;
  /** Shown briefly after a plain tap. */
  onHint?: (text: string) => void;
  style?: React.CSSProperties;
  fill?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

export function HoldButton({ ms, onDone, doneFeel = "holdDone", label, holdingLabel = "Keep holding", onHint, style, fill = "rgba(255,255,255,0.24)", disabled, ariaLabel }: Props) {
  const [holding, setHolding] = useState(false);
  const [popped, setPopped] = useState(false);
  const timers = useRef<number[]>([]);
  const doneAt = useRef(0);
  const viaPointer = useRef(false);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const start = () => {
    if (disabled || holding) return;
    clear();
    setHolding(true);
    feel("holdStart");
    timers.current.push(
      window.setTimeout(() => feel("holdRamp"), ms * 0.34),
      window.setTimeout(() => feel("holdRamp"), ms * 0.67),
      window.setTimeout(() => {
        doneAt.current = performance.now();
        setHolding(false);
        setPopped(true);
        feel(doneFeel);
        onDone();
        timers.current.push(window.setTimeout(() => setPopped(false), 320));
      }, ms),
    );
  };
  const stop = () => {
    if (!holding) return;
    clear();
    setHolding(false);
  };

  return (
    <button
      type="button"
      className="hold"
      aria-label={ariaLabel ?? label}
      aria-disabled={disabled || undefined}
      onPointerDown={(e) => {
        if (e.button > 0) return;
        e.stopPropagation(); // never start a page swipe from a hold
        viaPointer.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* fine */
        }
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          viaPointer.current = true;
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") stop();
      }}
      onClick={() => {
        // A click that follows a finished hold, or any pointer/keyboard tap, is not a confirmation.
        if (performance.now() - doneAt.current < 700) {
          viaPointer.current = false;
          return;
        }
        if (viaPointer.current) {
          viaPointer.current = false;
          if (!disabled) {
            feel("tapHint");
            onHint?.(label.replace(/^Hold to/, "Press and hold to"));
          }
          return;
        }
        // Assistive tech "click" with no pointer down: confirm directly.
        if (!disabled) {
          feel(doneFeel);
          onDone();
        }
      }}
      style={{ position: "relative", overflow: "hidden", transform: holding ? "scale(0.97)" : popped ? "scale(1.03)" : "none", transition: `transform 0.18s ${ease}`, opacity: disabled ? 0.5 : 1, ...style }}
    >
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: holding ? "100%" : "0%", background: fill, transition: holding ? `width ${ms}ms linear` : `width 0.3s ${ease}` }} />
      <span style={{ position: "relative" }}>{holding ? holdingLabel : label}</span>
    </button>
  );
}
