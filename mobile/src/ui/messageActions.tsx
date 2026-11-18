import { useEffect, useRef, useState } from "react";
import { Layer } from "./Layer";
import { useToast } from "./Toast";
import { feel } from "../native/haptics";
import { ease, glassStrong, ink } from "../theme/tokens";

// Copy and edit, the way a chat app does it: press and hold a message for its
// menu, or use the small row under the latest messages.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older web views: the old way, from a hidden field.
    try {
      const t = document.createElement("textarea");
      t.value = text;
      t.setAttribute("readonly", "");
      t.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function useCopy(): (text: string) => void {
  const toast = useToast();
  return (text) => {
    void copyText(text).then((ok) => {
      feel(ok ? "select" : "warning");
      toast(ok ? "Copied" : "Couldn't copy that.");
    });
  };
}

/** Press and hold (0.45 s) on something: calls back with where it is. Moving or letting go early cancels. */
export function useLongPress(onLong: (rect: DOMRect) => void) {
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const clear = () => {
    window.clearTimeout(timer.current);
    start.current = null;
    setPressed(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    pressed,
    handlers: {
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        const el = e.currentTarget;
        start.current = { x: e.clientX, y: e.clientY };
        setPressed(true);
        timer.current = window.setTimeout(() => {
          setPressed(false);
          start.current = null;
          feel("select");
          onLong(el.getBoundingClientRect());
        }, 450);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const COPY = "M9 9h10v10H9zM5 15V5h10";
const EDIT = "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4";

/** The small row under the latest messages. */
export function ActionRow({ mine, text, onEdit }: { mine: boolean; text: string; onEdit?: (text: string) => void }) {
  const copy = useCopy();
  const btn: React.CSSProperties = { width: 44, height: 40, display: "flex", alignItems: "center", justifyContent: "center", color: ink.faint, borderRadius: 12 };
  return (
    <div style={{ alignSelf: mine ? "flex-end" : "flex-start", display: "flex", marginTop: 2, marginLeft: mine ? 0 : -10, marginRight: mine ? -10 : 0 }}>
      <button type="button" aria-label="Copy message" onClick={() => copy(text)} style={btn}>
        <Icon d={COPY} />
      </button>
      {mine && onEdit ? (
        <button type="button" aria-label="Edit message" onClick={() => { feel("select"); onEdit(text); }} style={btn}>
          <Icon d={EDIT} />
        </button>
      ) : null}
    </div>
  );
}

export type MenuTarget = { text: string; mine: boolean; rect: DOMRect };

/** The menu a long press opens: floats by the message, over everything. */
export function MessageMenu({ target, onClose, onEdit }: { target: MenuTarget; onClose: () => void; onEdit?: (text: string) => void }) {
  const copy = useCopy();
  const edit = target.mine && !!onEdit;
  const h = edit ? 104 : 56;
  const w = 188;
  const vw = window.innerWidth;
  const above = target.rect.top - h - 10 > 90;
  const top = above ? target.rect.top - h - 10 : Math.min(target.rect.bottom + 10, window.innerHeight - h - 20);
  const left = Math.max(12, Math.min(target.mine ? target.rect.right - w : target.rect.left, vw - w - 12));
  const row: React.CSSProperties = { height: 48, padding: "0 16px", display: "flex", alignItems: "center", gap: 12, fontSize: 17, fontWeight: 600, width: "100%" };
  return (
    <Layer>
      <button type="button" aria-label="Close menu" tabIndex={-1} onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(20,30,52,0.08)", animation: "nFade 0.2s ease both" }} />
      <div role="menu" style={{ ...glassStrong, position: "absolute", top, left, width: w, borderRadius: 22, padding: 4, boxShadow: "0 18px 44px -10px rgba(20,30,52,0.35)", animation: `nGrow 0.22s ${ease} both`, transformOrigin: target.mine ? "100% 0" : "0 0" }}>
        <button type="button" role="menuitem" onClick={() => { copy(target.text); onClose(); }} style={row}>
          <Icon d={COPY} />
          Copy
        </button>
        {edit ? (
          <button type="button" role="menuitem" onClick={() => { onClose(); onEdit!(target.text); }} style={row}>
            <Icon d={EDIT} />
            Edit
          </button>
        ) : null}
      </div>
    </Layer>
  );
}
