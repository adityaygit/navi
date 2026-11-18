import { useState } from "react";
import type { MNeedsDecision } from "@shared/mobile-api-types";
import { feel } from "../native/haptics";
import { ease, glass, ink } from "../theme/tokens";

// Overdue imported (Canvas) work as ONE card, not a wall of overdue rows:
// Canvas can't tell Navi what was handed in, so the person decides. Same look
// as the "things need a time" card. "All handed in" asks once before marking.

type Props = {
  decision: MNeedsDecision;
  tz: string;
  onHandedIn: (ids: string[]) => Promise<void>;
  onAsk: (prompt: string, send?: boolean) => void;
};

export function DecisionCard({ decision, tz, onHandedIn, onAsk }: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = decision.count;
  if (!n) return null;
  const was = (iso: string | null) => (iso ? `was due ${new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: tz })}` : "past due");
  return (
    <div style={{ background: ink.raised, borderRadius: 22, border: `1px solid ${ink.line}`, overflow: "hidden" }}>
      <button type="button" aria-expanded={open} onClick={() => { feel("select"); setOpen((v) => !v); }} style={{ width: "100%", minHeight: 56, padding: "0 16px", display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700, textAlign: "left" }}>
        <span style={{ flex: 1 }}>{n === 1 ? "1 past-due Canvas item needs a decision" : `${n} past-due Canvas items need a decision`}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: `transform 0.3s ${ease}` }}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open ? (
        <div style={{ borderTop: `1px solid ${ink.line}`, animation: `nRise 0.3s ${ease} both` }}>
          <p style={{ margin: 0, padding: "10px 16px 4px", fontSize: 14, fontWeight: 500, color: ink.faint }}>Canvas doesn't tell Navi what you handed in.</p>
          {decision.items.map((t) => (
            <div key={t.id} style={{ minHeight: 52, padding: "6px 16px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, borderTop: `1px solid ${ink.line}` }}>
              <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: ink.faint }}>{was(t.due_at)}</span>
            </div>
          ))}
          {n > decision.items.length ? <p style={{ margin: 0, padding: "8px 16px", fontSize: 14, color: ink.faint }}>and {n - decision.items.length} more</p> : null}
          <div style={{ padding: "10px 12px 12px", display: "flex", flexWrap: "wrap", gap: 8, borderTop: `1px solid ${ink.line}` }}>
            {!confirm ? (
              <button type="button" onClick={() => { feel("select"); setConfirm(true); }} style={{ ...glass, height: 40, padding: "0 14px", borderRadius: 20, fontSize: 15, fontWeight: 600 }}>
                All handed in
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onHandedIn(decision.items.map((t) => t.id));
                      setConfirm(false);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  style={{ height: 40, padding: "0 16px", borderRadius: 20, background: ink.text, color: ink.onCta, fontSize: 15, fontWeight: 600, opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? "Saving…" : `Mark ${decision.items.length} done`}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm(false)} style={{ height: 40, padding: "0 12px", borderRadius: 20, fontSize: 15, fontWeight: 600, color: ink.muted }}>
                  Cancel
                </button>
              </>
            )}
            <button type="button" onClick={() => onAsk("Help me go through my past-due Canvas items: which are handed in and which still need time.", true)} style={{ ...glass, height: 40, padding: "0 14px", borderRadius: 20, fontSize: 15, fontWeight: 600 }}>
              Go through with Navi
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
