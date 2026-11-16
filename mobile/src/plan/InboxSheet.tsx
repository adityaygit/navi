import { useEffect, useState } from "react";
import type { MAcceptManyResult, MActionView, MDecideResult, MInbox, MProposal } from "@shared/mobile-api-types";
import { api } from "../api/client";
import { feel } from "../native/haptics";
import { HoldButton } from "../ui/HoldButton";
import { Sheet } from "../ui/Sheet";
import { useHideToast, useToast } from "../ui/Toast";
import { glass, ink, meaning } from "../theme/tokens";

// The Inbox (M6): three piles. Needs OK: things Navi won't do without you,
// anything that leaves Navi held to send. To add: what Navi picked up, marked
// "You said this" or "Navi's guess". Done: what you decided, with Undo only
// where it can really be undone.

export type DoneRow = { key: string; title: string; sub: string; dot: string; undo?: () => Promise<void>; undone?: boolean };
type Pile = "ok" | "add" | "done";

type Props = {
  inbox: MInbox | null;
  done: DoneRow[];
  onDone: (rows: DoneRow[] | ((prev: DoneRow[]) => DoneRow[])) => void;
  onClose: () => void;
  onChanged: () => void;
};

const card: React.CSSProperties = { background: ink.raised, borderRadius: 24, boxShadow: "0 8px 20px -12px rgba(20,32,64,0.2)", border: `1px solid ${ink.line}` };

export function InboxSheet({ inbox, done, onDone, onClose, onChanged }: Props) {
  const hideToast = useHideToast();
  const toast = useToast();
  useEffect(() => hideToast(), [hideToast]);
  // What's been answered in this sheet leaves its pile at once.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const approvals = (inbox?.approvals ?? []).filter((a) => !gone.has(a.id) && a.status === "proposed");
  const proposals = (inbox?.groups ?? []).flatMap((g) => g.proposals.map((p) => ({ p, from: g.label }))).filter(({ p }) => !gone.has(p.id));
  const said = proposals.filter(({ p }) => p.origin === "stated");
  const [pile, setPile] = useState<Pile>(() => (approvals.length ? "ok" : proposals.length ? "add" : done.length ? "done" : "ok"));

  const leave = (id: string) => setGone((g) => new Set(g).add(id));
  const back = (id: string) =>
    setGone((g) => {
      const n = new Set(g);
      n.delete(id);
      return n;
    });
  const mark = (id: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const log = (row: DoneRow) => onDone((prev) => [row, ...prev.filter((r) => r.key !== row.key)]);
  const markUndone = (key: string) => onDone((prev) => prev.map((r) => (r.key === key ? { ...r, undone: true, undo: undefined } : r)));

  async function decide(a: MActionView, decision: "approve" | "decline") {
    mark(a.id, true);
    try {
      const r = await api<MDecideResult>(`/api/m/approvals/${a.id}/decide`, { body: { decision, revision: a.revision } });
      const v = r.action;
      leave(a.id);
      const yes = decision === "approve";
      const failed = v.status === "failed";
      const ids = v.undo ?? [];
      log({
        key: `a-${a.id}`,
        title: failed ? `Didn't go through: ${a.subject}` : v.result || (yes ? a.subject : `Not now: ${a.subject}`),
        sub: failed ? v.error || "Nothing changed" : yes ? (a.external ? "You approved · already sent" : "You approved · in your plan") : "You said no",
        dot: failed ? meaning.slipping : yes ? meaning.kept : "#A3A8BF",
        undo:
          yes && !failed && ids.length && !a.external
            ? async () => {
                feel("undo");
                await api("/api/m/undo", { body: { activityIds: ids } });
                markUndone(`a-${a.id}`);
              }
            : undefined,
      });
      if (failed) feel("warning");
    } catch (e) {
      feel("warning");
      toast(`Couldn't answer that: ${(e as Error).message}`);
    } finally {
      mark(a.id, false);
    }
  }

  async function add(p: MProposal) {
    feel("success");
    leave(p.id);
    try {
      await api(`/api/m/proposals/${p.id}/accept`, { body: {} });
      // Added things become real tasks and events; take them out from Plan if you change your mind.
      log({ key: `p-${p.id}`, title: `Added: ${p.title}`, sub: p.area ? `To ${p.area.name}` : "To your plan", dot: p.area?.color || meaning.kept });
    } catch (e) {
      back(p.id);
      feel("warning");
      toast(`Couldn't add it: ${(e as Error).message}`);
    }
  }

  async function drop(p: MProposal) {
    feel("select");
    leave(p.id);
    try {
      await api(`/api/m/proposals/${p.id}/status`, { body: { status: "rejected" } });
      log({
        key: `p-${p.id}`,
        title: `Skipped: ${p.title}`,
        sub: "Not added",
        dot: "#A3A8BF",
        undo: async () => {
          feel("undo");
          await api(`/api/m/proposals/${p.id}/status`, { body: { status: "pending" } });
          onDone((prev) => prev.filter((r) => r.key !== `p-${p.id}`));
          back(p.id);
        },
      });
    } catch (e) {
      back(p.id);
      feel("warning");
      toast(`Couldn't skip it: ${(e as Error).message}`);
    }
  }

  async function addSaid() {
    const list = said.map(({ p }) => p);
    if (!list.length) return;
    feel("success");
    list.forEach((p) => leave(p.id));
    try {
      const r = await api<MAcceptManyResult>("/api/m/proposals/accept", { body: { ids: list.map((p) => p.id) } });
      const ok = new Set(r.results.filter((x) => x.ok).map((x) => x.id));
      list.filter((p) => !ok.has(p.id)).forEach((p) => back(p.id));
      onDone((prev) => [...list.filter((p) => ok.has(p.id)).map((p) => ({ key: `p-${p.id}`, title: `Added: ${p.title}`, sub: p.area ? `To ${p.area.name}` : "To your plan", dot: p.area?.color || meaning.kept })), ...prev]);
      if (ok.size < list.length) {
        feel("warning");
        toast(r.message);
      }
    } catch (e) {
      list.forEach((p) => back(p.id));
      feel("warning");
      toast(`Couldn't add them: ${(e as Error).message}`);
    }
  }

  const tabs: [Pile, string, number][] = [
    ["ok", "Needs OK", approvals.length],
    ["add", "To add", proposals.length],
    ["done", "Done", done.length],
  ];

  const empty = (a: string, b: string) => (
    <p style={{ margin: "70px 0 0", textAlign: "center", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
      {a} <span className="em">{b}</span>.
    </p>
  );

  return (
    <Sheet
      label="Inbox"
      height="calc(100% - var(--sat) - 76px)"
      onClose={() => {
        onClose();
        onChanged();
      }}
    >
      {(close) => (
        <>
          <div style={{ flex: "none", padding: "6px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-0.035em" }}>Inbox</h2>
            <button type="button" onClick={close} style={{ ...glass, height: 44, padding: "0 18px", borderRadius: 22, fontSize: 16, fontWeight: 600 }}>Close</button>
          </div>
          <div role="tablist" aria-label="Inbox piles" style={{ flex: "none", margin: "0 16px 8px", height: 48, padding: 4, borderRadius: 24, background: "rgba(17,20,26,0.06)", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4, boxSizing: "border-box" }}>
            {tabs.map(([id, t, n]) => {
              const sel = pile === id;
              return (
                <button key={id} type="button" role="tab" aria-selected={sel} onClick={() => { if (!sel) { feel("select"); setPile(id); } }} style={{ height: 40, borderRadius: 20, fontSize: 15, fontWeight: 700, background: sel ? "#FFFFFF" : "transparent", boxShadow: sel ? "0 2px 8px rgba(36,62,110,0.14)" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "background-color 0.2s, box-shadow 0.2s" }}>
                  {t}
                  <span style={{ minWidth: 22, height: 22, padding: "0 6px", boxSizing: "border-box", borderRadius: 11, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", background: sel ? ink.text : "rgba(17,20,26,0.08)", color: sel ? "#FFFFFF" : ink.text }}>{n}</span>
                </button>
              );
            })}
          </div>

          <div key={pile} className="scroll" style={{ flex: 1, minHeight: 0, padding: "8px 16px 32px", display: "flex", flexDirection: "column", gap: 10, animation: "nFade 0.25s ease both" }}>
            {inbox === null ? <p style={{ margin: "40px 0 0", textAlign: "center", fontSize: 17, fontWeight: 500, color: ink.faint }}>Loading…</p> : null}

            {inbox && pile === "ok" ? (
              approvals.length ? (
                approvals.map((a) => (
                  <div key={a.id} style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 10, opacity: busy.has(a.id) ? 0.6 : 1, transition: "opacity 0.2s", animation: "nRise 0.3s ease both" }}>
                    <span style={{ alignSelf: "flex-start", height: 28, padding: "0 10px", borderRadius: 14, background: a.external ? meaning.needsOkBg : "rgba(17,20,26,0.06)", color: a.external ? meaning.needsOk : ink.muted, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                      {a.external ? <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2L2 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
                      {a.external ? `Leaves Navi · ${a.verb.toLowerCase()}` : "In your plan"}
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>{a.subject}</span>
                    {a.fields.length ? (
                      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {a.fields.slice(0, 4).map((f) => (
                          <span key={f.label} style={{ display: "flex", gap: 10, fontSize: 15, fontWeight: 500 }}>
                            <span style={{ flex: "none", width: 72, fontWeight: 600, color: ink.dim }}>{f.label}</span>
                            <span style={{ flex: 1, minWidth: 0, color: ink.soft }}>
                              {f.from ? <span style={{ color: ink.dim, textDecoration: "line-through", marginRight: 6 }}>{f.from}</span> : null}
                              {f.value}
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span style={{ fontSize: 15, fontWeight: 500, color: ink.muted }}>{a.external ? "Sent from your account. Can't be undone." : a.reason || "Your plan changes. Nobody else is told."}</span>
                    <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                      {a.external ? (
                        <HoldButton ms={800} doneFeel="commit" disabled={busy.has(a.id)} label={`Hold to ${a.verb.toLowerCase()}`} onDone={() => void decide(a, "approve")} onHint={(t) => toast(t)} style={{ height: 46, padding: "0 20px", borderRadius: 23, background: ink.text, color: ink.onCta, fontSize: 16, fontWeight: 600 }} />
                      ) : (
                        <button type="button" disabled={busy.has(a.id)} onClick={() => { feel("success"); void decide(a, "approve"); }} style={{ height: 46, padding: "0 20px", borderRadius: 23, background: ink.text, color: ink.onCta, fontSize: 16, fontWeight: 600 }}>{a.verb}</button>
                      )}
                      <button type="button" disabled={busy.has(a.id)} onClick={() => { feel("select"); void decide(a, "decline"); }} style={{ ...glass, height: 46, padding: "0 20px", borderRadius: 23, fontSize: 16, fontWeight: 600 }}>Not now</button>
                    </div>
                  </div>
                ))
              ) : (
                empty("Nothing needs", "your OK")
              )
            ) : null}

            {inbox && pile === "add" ? (
              proposals.length ? (
                <>
                  {said.length >= 2 ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "4px 4px 2px" }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: ink.muted }}>{said.length} things you said</span>
                      <button type="button" onClick={() => void addSaid()} style={{ height: 40, padding: "0 14px", borderRadius: 20, background: ink.text, color: ink.onCta, fontSize: 15, fontWeight: 600 }}>Add the {said.length} you said</button>
                    </div>
                  ) : null}
                  {proposals.map(({ p }) => {
                    const guess = p.origin === "inferred";
                    return (
                      <div key={p.id} style={{ ...card, borderRadius: 22, padding: "10px 10px 10px 18px", display: "flex", alignItems: "center", gap: 10, border: guess ? "1.5px dashed rgba(233,169,58,0.55)" : card.border, animation: "nRise 0.3s ease both" }}>
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.title}</span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: guess ? meaning.needsOk : ink.faint }}>{guess ? "Navi's guess · check it" : "You said this"}</span>
                        </span>
                        <button type="button" onClick={() => void add(p)} style={{ flex: "none", height: 44, padding: "0 18px", borderRadius: 22, background: ink.text, color: ink.onCta, fontSize: 16, fontWeight: 600 }}>Add</button>
                        <button type="button" aria-label={`Skip ${p.title}`} onClick={() => void drop(p)} style={{ ...glass, flex: "none", width: 44, height: 44, borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke={ink.text} strokeWidth="1.8" strokeLinecap="round" /></svg>
                        </button>
                      </div>
                    );
                  })}
                </>
              ) : (
                empty("Nothing", "to add")
              )
            ) : null}

            {inbox && pile === "done" ? (
              done.length ? (
                <div style={{ ...card, borderRadius: 22, overflow: "hidden" }}>
                  {done.map((r, i) => (
                    <div key={r.key} style={{ minHeight: 60, padding: "8px 10px 8px 16px", display: "flex", alignItems: "center", gap: 12, borderBottom: i < done.length - 1 ? `1px solid ${ink.line}` : "none", animation: "nFade 0.3s ease both" }}>
                      <span aria-hidden="true" style={{ flex: "none", width: 10, height: 10, borderRadius: 5, background: r.dot }} />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3, textDecoration: r.undone ? "line-through" : "none", color: r.undone ? ink.dim : ink.text }}>{r.title}</span>
                        <span style={{ fontSize: 14, fontWeight: 500, color: ink.faint }}>{r.undone ? "Undone" : r.sub}</span>
                      </span>
                      {r.undo ? (
                        <button
                          type="button"
                          onClick={() => {
                            const u = r.undo!;
                            void u().catch((e: Error) => {
                              feel("warning");
                              toast(`Couldn't undo: ${e.message}`);
                            });
                          }}
                          style={{ flex: "none", height: 44, padding: "0 10px", fontSize: 16, fontWeight: 700, color: ink.link }}
                        >
                          Undo
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                empty("Nothing", "done yet")
              )
            ) : null}
          </div>
        </>
      )}
    </Sheet>
  );
}
