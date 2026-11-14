import { useEffect, useState } from "react";
import type { MDecideResult, MInbox, MProposal } from "@shared/mobile-api-types";
import type { ActionView } from "@shared/actions";
import { api } from "../api/client";
import { feel } from "../native/haptics";
import { Thread } from "../ui/Thread";
import { useExit } from "../ui/useExit";
import { useHideToast } from "../ui/Toast";
import { ease, ink, meaning, type Palette } from "../theme/tokens";

// The review inbox (M4): things that need your OK first, then what Navi
// picked up from your notes and chats. Every answer shows its result in place.

type Props = { palette: Palette; inbox: MInbox | null; onClose: () => void; onChanged: () => void };
type Decided = Record<string, "added" | "skipped" | "busy" | "failed">;

export function InboxSheet({ palette: P, inbox, onClose, onChanged }: Props) {
  const hideToast = useHideToast();
  useEffect(() => hideToast(), [hideToast]);
  const { closing, close } = useExit(280);
  const [decided, setDecided] = useState<Decided>({});
  const [actions, setActions] = useState<Record<string, ActionView>>(() => Object.fromEntries((inbox?.approvals ?? []).map((a) => [a.id, a as ActionView])));
  const shut = () => close(() => { onClose(); onChanged(); });

  async function answer(p: MProposal, add: boolean) {
    feel(add ? "success" : "select");
    setDecided((d) => ({ ...d, [p.id]: "busy" }));
    try {
      if (add) await api(`/api/m/proposals/${p.id}/accept`, { body: {} });
      else await api(`/api/m/proposals/${p.id}/status`, { body: { status: "rejected" } });
      setDecided((d) => ({ ...d, [p.id]: add ? "added" : "skipped" }));
    } catch {
      setDecided((d) => ({ ...d, [p.id]: "failed" }));
      feel("warning");
    }
  }
  async function decide(id: string, decision: "approve" | "decline") {
    feel(decision === "approve" ? "success" : "select");
    setActions((a) => ({ ...a, [id]: { ...a[id], status: decision === "approve" ? "executing" : "declined" } }));
    try {
      const r = await api<MDecideResult>(`/api/m/approvals/${id}/decide`, { body: { decision, revision: actions[id]?.revision } });
      setActions((a) => ({ ...a, [id]: r.action as ActionView }));
    } catch {
      setActions((a) => ({ ...a, [id]: { ...a[id], status: "proposed" } }));
      feel("warning");
    }
  }
  async function undoIds(ids: string[]) {
    feel("undo");
    await api("/api/m/undo", { body: { activityIds: ids } }).catch(() => feel("warning"));
  }

  const approvals = Object.values(actions);
  const groups = inbox?.groups.filter((g) => g.proposals.length) ?? [];
  const nothing = inbox && !approvals.length && !groups.length;

  return (
    <>
      <button type="button" aria-label="Close inbox" onClick={shut} style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(0,0,0,0.6)", animation: closing ? "nFadeOut 0.28s ease both" : "nFade 0.3s ease both" }} />
      <section aria-label="Inbox" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "calc(100% - var(--sat) - 34px)", zIndex: 11, background: ink.raised, borderRadius: "32px 32px 0 0", boxSizing: "border-box", padding: "8px 0 var(--sab)", display: "flex", flexDirection: "column", animation: closing ? `nDown 0.28s ${ease} both` : `nUp 0.38s ${ease} both` }}>
        <span aria-hidden="true" style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.25)" }} />
        <div style={{ marginTop: 12, padding: "0 12px 0 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.015em" }}>Inbox</h2>
          <button type="button" onClick={shut} style={{ minHeight: 44, padding: "0 8px", fontSize: 17, fontWeight: 600, color: P.accent }}>Done</button>
        </div>
        <div className="scroll" style={{ flex: 1, padding: "0 20px 24px" }}>
          {inbox === null ? <p style={{ margin: "24px 0 0", fontSize: 17, color: ink.faint }}>Loading…</p> : null}
          {approvals.length ? (
            <>
              <h3 style={{ margin: "24px 0 12px", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: meaning.needsOk }}>Needs your OK</h3>
              <Thread
                items={approvals.map((a) => ({ k: "card" as const, key: a.id, action: a }))}
                P={P}
                undone={new Set()}
                onUndo={undoIds}
                onDecide={decide}
                isNew={() => false}
              />
            </>
          ) : null}
          {groups.map((g) => (
            <section key={g.key}>
              <h3 style={{ margin: "24px 0 8px", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: ink.faint }}>{g.label}</h3>
              {g.proposals.map((p) => {
                const d = decided[p.id];
                return (
                  <div key={p.id} style={{ padding: "16px 0", borderTop: `1px solid ${ink.line}`, display: "flex", alignItems: "center", gap: 12, minHeight: 52 }}>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 17, fontWeight: 500, color: d === "skipped" ? ink.dim : ink.text, textDecoration: d === "skipped" ? "line-through" : "none", transition: "color 0.25s" }}>{p.title}</span>
                      <span style={{ fontSize: 13, lineHeight: 1.4, color: ink.faint }}>
                        {p.source_excerpt ? `“${p.source_excerpt}”` : p.rationale ?? ""}
                        {p.origin === "inferred" ? <span style={{ color: meaning.needsOk }}>{p.source_excerpt || p.rationale ? " · " : ""}Navi's guess</span> : null}
                      </span>
                    </span>
                    {d === "added" ? <span style={{ fontSize: 15, color: meaning.kept, animation: "nFade 0.25s ease both" }}>Added</span> : null}
                    {d === "failed" ? <span style={{ fontSize: 15, color: meaning.slipping }}>Didn't save</span> : null}
                    {!d || d === "busy" ? (
                      <span style={{ display: "flex", gap: 4, flex: "none", opacity: d === "busy" ? 0.5 : 1 }}>
                        <button type="button" disabled={d === "busy"} onClick={() => void answer(p, false)} style={{ height: 44, padding: "0 10px", fontSize: 15, color: ink.muted }}>Not now</button>
                        <button type="button" disabled={d === "busy"} onClick={() => void answer(p, true)} style={{ height: 44, padding: "0 18px", borderRadius: 22, background: "rgba(167,235,192,0.12)", color: P.accent, fontSize: 15, fontWeight: 600 }}>Add</button>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}
          {nothing ? <p style={{ margin: "24px 0 0", fontSize: 17, color: ink.faint }}>You're all caught up.</p> : null}
        </div>
      </section>
    </>
  );
}
