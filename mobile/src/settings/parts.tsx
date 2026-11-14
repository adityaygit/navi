import { useRef, useState, type ReactNode } from "react";
import { feel } from "../native/haptics";
import { ease, ink } from "../theme/tokens";

// Building blocks of the Settings screen: grouped cards of 52pt rows, the
// label on the left and its value on the right (iOS inset-grouped pattern).

export const card = "#121214";

export function Group({ label, foot, children }: { label: string; foot?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ marginTop: 28 }} aria-label={label}>
      <h2 style={{ margin: "0 0 8px 16px", fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: ink.faint }}>{label}</h2>
      <div className="ngroup" style={{ borderRadius: 16, background: card, overflow: "hidden" }}>{children}</div>
      {foot ? <p style={{ margin: "8px 16px 0", fontSize: 13, lineHeight: 1.45, color: ink.dim }}>{foot}</p> : null}
    </section>
  );
}

const rowBase: React.CSSProperties = { position: "relative", minHeight: 52, boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", textAlign: "left", fontSize: 17, color: ink.text };

export function Chevron() {
  return (
    <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke={ink.dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M1 1l6 6-6 6" />
    </svg>
  );
}

function Label({ label, sub }: { label: ReactNode; sub?: ReactNode }) {
  return (
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <span>{label}</span>
      {sub ? <span style={{ fontSize: 13, lineHeight: 1.4, color: ink.faint }}>{sub}</span> : null}
    </span>
  );
}

/** A plain row; a button when it does something. */
export function Row({ label, sub, value, onClick, danger, chevron, icon }: { label: ReactNode; sub?: ReactNode; value?: ReactNode; onClick?: () => void; danger?: boolean; chevron?: boolean; icon?: ReactNode }) {
  const inner = (
    <>
      {icon}
      <Label label={<span style={{ color: danger ? "#FF9A9A" : undefined }}>{label}</span>} sub={sub} />
      {value !== undefined ? <span style={{ flex: "none", maxWidth: "55%", color: ink.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span> : null}
      {chevron ? <Chevron /> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="npress" onClick={onClick} style={rowBase}>{inner}</button>
  ) : (
    <div style={rowBase}>{inner}</div>
  );
}

export function Switch({ on, accent }: { on: boolean; accent: string }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: 51, height: 31, borderRadius: 16, background: on ? accent : "rgba(255,255,255,0.16)", position: "relative", transition: "background-color 0.22s" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 22 : 2, width: 27, height: 27, borderRadius: 14, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.3)", transition: `left 0.24s ${ease}` }} />
    </span>
  );
}

export function SwitchRow({ label, sub, on, onChange, accent, disabled }: { label: ReactNode; sub?: ReactNode; on: boolean; onChange: (v: boolean) => void; accent: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} className="npress" onClick={() => onChange(!on)} style={{ ...rowBase, opacity: disabled ? 0.45 : 1 }}>
      <Label label={label} sub={sub} />
      <Switch on={on} accent={accent} />
    </button>
  );
}

/** "21:00" → "9:00 PM" in the phone's own style. */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
}

/** A time row: tapping anywhere opens the phone's own time wheel. */
export function TimeRow({ label, sub, value, onChange, disabled }: { label: string; sub?: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft && draft !== value && /^\d{2}:\d{2}$/.test(draft)) onChange(draft);
    setDraft(null);
  };
  return (
    <label className="npress" style={{ ...rowBase, opacity: disabled ? 0.45 : 1 }} onPointerDown={() => feel("select")}>
      <Label label={label} sub={sub} />
      <span style={{ flex: "none", padding: "6px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", fontVariantNumeric: "tabular-nums", color: ink.text }}>{clockLabel(shown)}</span>
      <input
        ref={ref}
        type="time"
        aria-label={label}
        disabled={disabled}
        value={shown}
        onChange={(e) => setDraft(e.target.value.slice(0, 5))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && ref.current?.blur()}
        style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", fontSize: 16, border: 0, cursor: "pointer" }}
      />
    </label>
  );
}

/** A list choice using the phone's native picker. */
export function SelectRow({ label, value, display, options, onChange }: { label: string; value: string; display?: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="npress" style={rowBase} onPointerDown={() => feel("select")}>
      <Label label={label} />
      <span style={{ flex: "none", maxWidth: "58%", color: ink.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{display ?? value}</span>
      <Chevron />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", fontSize: 16 }}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/** A choice between a few options, each with a line of explanation. */
export function RadioRow({ label, sub, on, onPick, accent }: { label: string; sub: string; on: boolean; onPick: () => void; accent: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} className="npress" onClick={onPick} style={rowBase}>
      <Label label={label} sub={sub} />
      <span aria-hidden="true" style={{ flex: "none", width: 24, height: 24, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", border: on ? "none" : `1.5px solid rgba(255,255,255,0.25)`, background: on ? accent : "transparent", transition: "background-color 0.2s" }}>
        {on ? (
          <svg width="13" height="10" viewBox="0 0 13 10" fill="none" stroke="#0B0B0C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 5.2 4.8 8.5 11.5 1.5" /></svg>
        ) : null}
      </span>
    </button>
  );
}
