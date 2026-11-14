import type { ActionView } from "@shared/actions";
import type { Message } from "@shared/types";
import { visibleSteps, type Live } from "../data/chat";
import { ease, ink, meaning, type Palette } from "../theme/tokens";

// The conversation, drawn as the M4 thread: Navi speaks in plain text, you in
// a bubble, what Navi did shows as a receipt with Undo, and anything that needs
// your OK is a card with an explicit action.

type Item =
  | { k: "stamp"; key: string; text: string }
  | { k: "me"; key: string; text: string; pending?: boolean }
  | { k: "navi"; key: string; text: string; live?: boolean }
  | { k: "receipt"; key: string; text: string; ok: boolean; undo?: string[] }
  | { k: "card"; key: string; action: ActionView }
  | { k: "looking"; key: string; text: string };

const stampFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function stampText(d: Date): string {
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today · ${timeFmt.format(d)}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday · ${timeFmt.format(d)}`;
  return stampFmt.format(d).replace(",", " ·");
}

export function buildItems(messages: Message[], actions: Record<string, ActionView>, live: Live): Item[] {
  const items: Item[] = [];
  let last = 0;
  for (const m of messages) {
    const t = new Date(m.created_at).getTime();
    if (!last || t - last > 60 * 60 * 1000) items.push({ k: "stamp", key: `s-${m.id}`, text: stampText(new Date(t)) });
    last = t;
    if (m.role === "user") {
      items.push({ k: "me", key: m.id, text: m.content, pending: m.id.startsWith("local-") });
      continue;
    }
    if (m.role !== "assistant") continue;
    if (m.content.trim()) items.push({ k: "navi", key: m.id, text: m.content.trim() });
    // History from the server comes with ready-made receipts (plan steps merged, one Undo) and card ids.
    const rich = m as Message & { receipts?: { ok: boolean; display: string; label: string; undo?: string[] }[]; cardIds?: string[] };
    if (rich.receipts) {
      rich.receipts.forEach((r, i) => items.push({ k: "receipt", key: `${m.id}-r${i}`, text: r.display || r.label, ok: r.ok, undo: r.ok ? r.undo : undefined }));
      (rich.cardIds ?? []).forEach((id) => {
        const a = actions[id];
        if (a) items.push({ k: "card", key: `${m.id}-a-${id}`, action: a });
      });
      continue;
    }
    visibleSteps(m.tool_events ?? []).forEach((e, i) => {
      const a = e.action_id ? actions[e.action_id] : undefined;
      if (a) items.push({ k: "card", key: `${m.id}-a${i}`, action: a });
      else items.push({ k: "receipt", key: `${m.id}-r${i}`, text: e.display ?? "", ok: e.ok, undo: e.undo });
    });
  }
  if (live) {
    if (live.text.trim()) items.push({ k: "navi", key: "live-text", text: live.text.trim(), live: true });
    live.steps.forEach((st) => {
      if (!st.done) items.push({ k: "looking", key: `live-${st.id}`, text: st.label });
      else if (st.action) items.push({ k: "card", key: `live-${st.id}`, action: st.action });
      else if (st.display && !st.readOnly) items.push({ k: "receipt", key: `live-${st.id}`, text: st.display, ok: st.ok, undo: st.undo });
    });
    if (!live.text.trim() && live.steps.every((s) => s.done)) items.push({ k: "looking", key: "live-thinking", text: "Thinking" });
  }
  return items;
}

/** M4 rhythm: 8 within a thought, 12 between Navi's lines, 24 between turns, 32 before a stamp. */
function gap(p: Item | undefined, m: Item): number {
  if (!p) return 0;
  if (m.k === "stamp") return 32;
  if (p.k === "stamp") return 16;
  if (m.k === "me") return p.k === "me" ? 8 : 24;
  if (m.k === "receipt" || m.k === "looking") return p.k === "receipt" || p.k === "looking" ? 0 : 8;
  if (m.k === "navi") return p.k === "receipt" || p.k === "card" ? 24 : 12;
  return 12;
}

type Handlers = { P: Palette; undone: Set<string>; onUndo: (ids: string[]) => void; onDecide: (id: string, d: "approve" | "decline") => void; isNew: (key: string) => boolean };

export function Thread({ items, ...h }: { items: Item[] } & Handlers) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((m, i) => (
        <div key={m.key} style={{ marginTop: gap(items[i - 1], m), display: "flex", flexDirection: "column", animation: h.isNew(m.key) ? `nRise 0.36s ${ease} both` : undefined }}>
          <Part m={m} {...h} />
        </div>
      ))}
    </div>
  );
}

function Part({ m, P, undone, onUndo, onDecide }: { m: Item } & Handlers) {
  switch (m.k) {
    case "stamp":
      return <div style={{ alignSelf: "center", fontSize: 13, color: ink.dim, padding: "4px 0" }}>{m.text}</div>;
    case "me":
      return (
        <div style={{ alignSelf: "flex-end", maxWidth: "80%", padding: "10px 16px", borderRadius: "20px 20px 6px 20px", background: "#1B1B1E", fontSize: 17, lineHeight: 1.45, color: "#ECECF0", opacity: m.pending ? 0.7 : 1, userSelect: "text", WebkitUserSelect: "text", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {m.text}
        </div>
      );
    case "navi":
      return <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: "#F0F0F3", letterSpacing: "-0.003em", userSelect: "text", WebkitUserSelect: "text", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.text}</p>;
    case "looking":
      return (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, color: ink.faint, fontSize: 15 }}>
          <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: P.accent, animation: "nPulse 1s ease-in-out infinite" }} />
          </span>
          {m.text}…
        </div>
      );
    case "receipt": {
      const isUndone = !!m.undo?.length && m.undo.every((id) => undone.has(id));
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44 }}>
          <span aria-hidden="true" style={{ flex: "none", width: 22, height: 22, borderRadius: 11, background: m.ok ? "rgba(159,240,216,0.16)" : "rgba(255,154,154,0.16)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={m.ok ? meaning.kept : meaning.slipping} strokeWidth="3" strokeLinecap="round" aria-hidden="true">{m.ok ? <path d="m5 12 4.5 4.5L19 7" /> : <path d="M7 7l10 10M17 7 7 17" />}</svg>
          </span>
          <span style={{ flex: 1, fontSize: 15, lineHeight: 1.4, color: isUndone ? ink.dim : "#B4B4BC", textDecoration: isUndone ? "line-through" : "none" }}>{m.text}</span>
          {m.undo?.length ? (
            isUndone ? <span style={{ fontSize: 15, color: ink.dim }}>Undone</span> : (
              <button type="button" onClick={() => onUndo(m.undo!)} style={{ minHeight: 44, padding: "0 4px", fontSize: 15, color: P.accent, fontWeight: 600 }}>Undo</button>
            )
          ) : null}
        </div>
      );
    }
    case "card":
      return <ActionCard a={m.action} P={P} undone={undone} onUndo={onUndo} onDecide={onDecide} />;
  }
}

function ActionCard({ a, P, undone, onUndo, onDecide }: { a: ActionView; P: Palette; undone: Set<string>; onUndo: (ids: string[]) => void; onDecide: (id: string, d: "approve" | "decline") => void }) {
  const waiting = a.status === "proposed";
  const kindColor = a.external ? meaning.needsOk : P.accent;
  const kind = (a.external ? `Needs your OK · ${a.verb}` : a.verb).toUpperCase();
  if (!waiting) {
    // Answered: collapse to a receipt line.
    const line =
      a.status === "completed" ? a.result || `${a.verb}: ${a.subject}` :
      a.status === "executing" || a.status === "approved" ? `${a.verb}: ${a.subject}…` :
      a.status === "declined" ? `Skipped: ${a.subject}` :
      a.status === "expired" ? `Expired: ${a.subject}` : a.error || `Couldn't ${a.verb.toLowerCase()}: ${a.subject}`;
    const ok = a.status !== "failed";
    const isUndone = a.undone || (a.undo.length > 0 && a.undo.every((id) => undone.has(id)));
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, animation: `nFade 0.25s ease both` }}>
        <span aria-hidden="true" style={{ flex: "none", width: 22, height: 22, borderRadius: 11, background: ok ? "rgba(159,240,216,0.16)" : "rgba(255,154,154,0.16)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ok ? meaning.kept : meaning.slipping} strokeWidth="3" strokeLinecap="round" aria-hidden="true">{a.status === "declined" || a.status === "expired" ? <path d="M6 12h12" /> : ok ? <path d="m5 12 4.5 4.5L19 7" /> : <path d="M7 7l10 10M17 7 7 17" />}</svg>
        </span>
        <span style={{ flex: 1, fontSize: 15, lineHeight: 1.4, color: isUndone ? ink.dim : "#B4B4BC", textDecoration: isUndone ? "line-through" : "none" }}>{line}</span>
        {a.status === "completed" && a.undo.length ? (
          isUndone ? <span style={{ fontSize: 15, color: ink.dim }}>Undone</span> : <button type="button" onClick={() => onUndo(a.undo)} style={{ minHeight: 44, padding: "0 4px", fontSize: 15, color: P.accent, fontWeight: 600 }}>Undo</button>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ borderRadius: 24, background: "#121214", border: `1px solid ${a.external ? "rgba(244,179,122,0.35)" : ink.edge}`, padding: "20px 20px 8px", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", color: kindColor }}>{kind}</div>
      <div style={{ marginTop: 8, fontSize: 20, lineHeight: 1.3, fontWeight: 600, letterSpacing: "-0.01em" }}>{a.subject}</div>
      {a.fields.length ? (
        <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {a.fields.map((f) => (
            <li key={f.label} style={{ display: "flex", alignItems: "baseline", gap: 12, minHeight: 36, padding: "8px 12px", boxSizing: "border-box", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
              <span style={{ width: 84, flex: "none", fontSize: 13, color: ink.faint }}>{f.label}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, color: ink.text }}>
                {f.from ? <span style={{ color: ink.dim, textDecoration: "line-through", marginRight: 8 }}>{f.from}</span> : null}
                {f.value}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {a.reason ? <p style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.45, color: ink.muted }}>{a.reason}</p> : null}
      <button type="button" onClick={() => onDecide(a.id, "approve")} style={{ marginTop: 20, height: 52, borderRadius: 26, background: a.external ? ink.text : P.cta, color: "#0B0B0C", fontSize: 17, fontWeight: 600, textAlign: "center" }}>
        {a.verb}
      </button>
      <button type="button" onClick={() => onDecide(a.id, "decline")} style={{ height: 48, fontSize: 15, color: ink.muted, textAlign: "center" }}>
        Not now
      </button>
    </div>
  );
}
