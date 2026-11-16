import { useState, type ReactNode } from "react";
import { feel } from "../native/haptics";
import { Sheet } from "../ui/Sheet";
import { glass, ink, meaning } from "../theme/tokens";
import { notOnServer } from "../data/you";

// Pieces the You screens share: white cards, a heading, an honest empty or
// error line, and one edit sheet (fields + Save, optionally Delete).

export const youCard: React.CSSProperties = { background: ink.raised, borderRadius: 22, overflow: "hidden" };

export function Heading({ children, tone }: { children: ReactNode; tone?: "guess" }) {
  return <h2 style={{ margin: "18px 6px 8px", fontSize: 15, fontWeight: 700, color: tone === "guess" ? meaning.needsOk : ink.muted }}>{children}</h2>;
}

export function Empty({ a, b, line }: { a: string; b: string; line?: string }) {
  return (
    <div style={{ padding: "48px 6px 0", display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 26, lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.025em" }}>
        {a} <span className="em">{b}</span>.
      </p>
      {line ? <p style={{ margin: 0, fontSize: 17, lineHeight: 1.4, fontWeight: 500, color: ink.muted }}>{line}</p> : null}
    </div>
  );
}

export function LoadState({ loading, error }: { loading: boolean; error: string | null }) {
  if (error)
    return <Empty a="Couldn't" b="load this" line={notOnServer(error) ? "This needs the newest version of Navi's server. It'll show here once that's live." : "It'll come back when you're online."} />;
  if (loading) return <p style={{ margin: "40px 6px 0", fontSize: 17, fontWeight: 500, color: ink.faint }}>Loading…</p>;
  return null;
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={() => { feel("select"); onClick(); }} style={{ ...glass, height: 44, padding: "0 16px", borderRadius: 22, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1v12M1 7h12" stroke={ink.text} strokeWidth="2" strokeLinecap="round" /></svg>
      {label}
    </button>
  );
}

type Field = { key: string; label: string; value: string; multiline?: boolean; placeholder?: string; required?: boolean };

/** Edit a few fields; Save answers with an error line when it fails. */
export function EditSheet({ title, fields, saveLabel = "Save", onSave, onDelete, deleteLabel, onClose, extra }: { title: string; fields: Field[]; saveLabel?: string; onSave: (v: Record<string, string>) => Promise<void>; onDelete?: () => Promise<void>; deleteLabel?: string; onClose: () => void; extra?: ReactNode }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const missing = fields.some((f) => f.required && !v[f.key]?.trim());
  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", borderRadius: 18, border: `1px solid ${ink.edge}`, background: "#fff", padding: "14px 16px", fontSize: 17, fontWeight: 500, outline: "none", color: ink.text, resize: "none" };
  const run = async (fn: () => Promise<void>, close: () => void) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      close();
    } catch (e) {
      feel("warning");
      setErr((e as Error).message || "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet label={title} z={40} onClose={onClose} style={{ padding: "0 20px" }}>
      {(close) => (
        <div style={{ padding: "4px 0 12px", display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em" }}>{title}</h2>
          {fields.map((f) => (
            <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 15, fontWeight: 700, color: ink.muted }}>
              {f.label}
              {f.multiline ? (
                <textarea rows={5} value={v[f.key]} placeholder={f.placeholder} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} style={{ ...input, minHeight: 130 }} />
              ) : (
                <input value={v[f.key]} placeholder={f.placeholder} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} style={{ ...input, height: 54 }} />
              )}
            </label>
          ))}
          {extra}
          {err ? <p role="alert" style={{ margin: 0, fontSize: 15, fontWeight: 500, color: meaning.slipping }}>{err}</p> : null}
          <button type="button" disabled={busy || missing} onClick={() => void run(() => onSave(v), close)} style={{ height: 56, borderRadius: 28, background: ink.text, color: "#fff", fontSize: 17, fontWeight: 600, textAlign: "center", opacity: busy || missing ? 0.5 : 1 }}>
            {busy ? "Saving…" : saveLabel}
          </button>
          {onDelete ? (
            sure ? (
              <button type="button" disabled={busy} onClick={() => { feel("warning"); void run(onDelete, close); }} style={{ height: 50, borderRadius: 25, background: "rgba(178,58,23,0.1)", color: meaning.slipping, fontSize: 16, fontWeight: 700, textAlign: "center" }}>
                Tap again to {deleteLabel ?? "delete"}
              </button>
            ) : (
              <button type="button" onClick={() => { feel("select"); setSure(true); }} style={{ height: 50, fontSize: 16, fontWeight: 600, color: meaning.slipping, textAlign: "center" }}>
                {deleteLabel ? deleteLabel.charAt(0).toUpperCase() + deleteLabel.slice(1) : "Delete"}
              </button>
            )
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
