import { useState } from "react";
import type { ActionView } from "@shared/actions";
import type { Message } from "@shared/types";
import { visibleSteps, type Live } from "../data/chat";
import { ease, glass, glassStrong, ink, meaning, type Palette } from "../theme/tokens";
import { HoldButton } from "./HoldButton";
import { useToast } from "./Toast";
import { feel } from "../native/haptics";
import { ActionRow, MessageMenu, useLongPress, type MenuTarget } from "./messageActions";

// The conversation (M6): Navi speaks in glass bubbles, you in black ones, what
// Navi did shows as a receipt (Undo only when it can really be undone), and
// anything that needs your OK is a card. Anything that leaves Navi says so and
// asks you to hold.

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

type Handlers = {
  P: Palette;
  undone: Set<string>;
  onUndo: (ids: string[]) => void;
  onDecide: (id: string, d: "approve" | "decline") => void;
  isNew: (key: string) => boolean;
  /** Put one of your messages back in the bar to change and send again. */
  onEdit?: (text: string) => void;
  /** Navi is answering now: no copy row until it's done. */
  busy?: boolean;
  /** Press and hold a bubble for its menu. */
  onMenu?: (t: MenuTarget) => void;
};

const KEEP = 16; // a long chat shows its last 16 parts; the rest fold to "Earlier · N messages"

/** Long chats fold their start; only one suggestion waiting for an answer shows at a time (M6). */
export function folded(items: Item[], showAll: boolean, showCards: boolean): { list: Item[]; earlier: number; more: { n: number; subject: string } | null } {
  let list = items;
  let earlier = 0;
  if (!showAll && items.length > KEEP + 8) {
    let from = items.length - KEEP;
    while (from > 0 && items[from].k !== "stamp" && items[from].k !== "me") from--; // start at a turn
    earlier = items.slice(0, from).filter((m) => m.k === "me" || m.k === "navi").length;
    list = items.slice(from);
  }
  let more: { n: number; subject: string } | null = null;
  if (!showCards) {
    const open = list.filter((m): m is Extract<Item, { k: "card" }> => m.k === "card" && m.action.status === "proposed");
    if (open.length > 1) {
      const hidden = new Set(open.slice(1).map((m) => m.key));
      more = { n: hidden.size, subject: open[1].action.subject };
      list = list.filter((m) => !hidden.has(m.key));
    }
  }
  return { list, earlier, more };
}

export function Thread({ items, ...h }: { items: Item[] } & Omit<Handlers, "onMenu">) {
  const [showAll, setShowAll] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const { list, earlier, more } = folded(items, showAll, showCards);
  // The small copy / edit row sits under the latest message of each side, once Navi is done.
  const lastMe = [...list].reverse().find((m) => m.k === "me" && !m.pending)?.key;
  const lastNavi = [...list].reverse().find((m) => m.k === "navi" && !m.live)?.key;
  const firstCard = list.find((m) => m.k === "card" && m.action.status === "proposed")?.key;
  const chip: React.CSSProperties = { ...glass, height: 40, padding: "0 16px", borderRadius: 20, fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, maxWidth: "100%" };
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {earlier ? (
        <button type="button" onClick={() => { feel("select"); setShowAll(true); }} style={{ ...chip, alignSelf: "center", marginBottom: 12 }}>
          Earlier · {earlier} message{earlier === 1 ? "" : "s"}
        </button>
      ) : null}
      {list.map((m, i) => (
        <div key={m.key} style={{ marginTop: gap(list[i - 1], m), display: "flex", flexDirection: "column", animation: h.isNew(m.key) ? `nRise 0.36s ${ease} both` : undefined }}>
          <Part m={m} {...h} onMenu={setMenu} />
          {!h.busy && m.k === "me" && m.key === lastMe ? <ActionRow mine text={m.text} onEdit={h.onEdit} /> : null}
          {!h.busy && m.k === "navi" && m.key === lastNavi ? <ActionRow mine={false} text={m.text} /> : null}
          {more && m.key === firstCard ? (
            <button type="button" onClick={() => { feel("select"); setShowCards(true); }} style={{ ...chip, alignSelf: "flex-start", marginTop: 10 }}>
              <span style={{ flex: "none" }}>{more.n} more suggestion{more.n === 1 ? "" : "s"}</span>
              <span style={{ minWidth: 0, color: ink.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>· {more.subject}</span>
            </button>
          ) : null}
        </div>
      ))}
      {menu ? <MessageMenu target={menu} onClose={() => setMenu(null)} onEdit={h.onEdit} /> : null}
    </div>
  );
}

/** A message bubble: press and hold for Copy (and Edit on yours). */
function Bubble({ mine, text, pending, onMenu }: { mine: boolean; text: string; pending?: boolean; onMenu?: (t: MenuTarget) => void }) {
  const lp = useLongPress((rect) => onMenu?.({ text, mine, rect }));
  const base: React.CSSProperties = { margin: 0, padding: "13px 16px", fontSize: 17, lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "none", WebkitUserSelect: "none", transform: lp.pressed ? "scale(0.98)" : "none", transition: `transform 0.25s ${ease}` };
  return mine ? (
    <div {...lp.handlers} style={{ ...base, alignSelf: "flex-end", maxWidth: "80%", borderRadius: "22px 22px 8px 22px", background: ink.text, color: "#FFFFFF", opacity: pending ? 0.7 : 1, transformOrigin: "100% 50%" }}>
      {text}
    </div>
  ) : (
    <p {...lp.handlers} style={{ ...glassStrong, ...base, alignSelf: "flex-start", maxWidth: "86%", borderRadius: "22px 22px 22px 8px", color: ink.text, transformOrigin: "0 50%" }}>
      {text}
    </p>
  );
}

function Part({ m, P, undone, onUndo, onDecide, onMenu }: { m: Item } & Handlers) {
  switch (m.k) {
    case "stamp":
      return <div style={{ alignSelf: "center", fontSize: 14, fontWeight: 600, color: ink.dim, padding: "4px 0" }}>{m.text}</div>;
    case "me":
      return <Bubble mine text={m.text} pending={m.pending} onMenu={onMenu} />;
    case "navi":
      return <Bubble mine={false} text={m.text} onMenu={m.live ? undefined : onMenu} />;
    case "looking":
      return (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, color: ink.faint, fontSize: 15, fontWeight: 500 }}>
          <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: ink.text, animation: "nDots 1.2s ease-in-out infinite" }} />
          </span>
          {m.text}…
        </div>
      );
    case "receipt": {
      const isUndone = !!m.undo?.length && m.undo.every((id) => undone.has(id));
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44 }}>
          <span aria-hidden="true" style={{ flex: "none", width: 22, height: 22, borderRadius: 11, background: m.ok ? "rgba(54,179,134,0.16)" : "rgba(238,122,92,0.16)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={m.ok ? meaning.kept : meaning.slipping} strokeWidth="3" strokeLinecap="round" aria-hidden="true">{m.ok ? <path d="m5 12 4.5 4.5L19 7" /> : <path d="M7 7l10 10M17 7 7 17" />}</svg>
          </span>
          <span style={{ flex: 1, fontSize: 15, lineHeight: 1.4, fontWeight: 500, color: isUndone ? ink.dim : ink.muted, textDecoration: isUndone ? "line-through" : "none" }}>{m.text}</span>
          {m.undo?.length ? (
            isUndone ? <span style={{ fontSize: 15, fontWeight: 600, color: ink.dim }}>Undone</span> : (
              <button type="button" onClick={() => onUndo(m.undo!)} style={{ minHeight: 44, padding: "0 4px", fontSize: 16, color: ink.link, fontWeight: 700 }}>Undo</button>
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
        <span aria-hidden="true" style={{ flex: "none", width: 22, height: 22, borderRadius: 11, background: ok ? "rgba(54,179,134,0.16)" : "rgba(238,122,92,0.16)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ok ? meaning.kept : meaning.slipping} strokeWidth="3" strokeLinecap="round" aria-hidden="true">{a.status === "declined" || a.status === "expired" ? <path d="M6 12h12" /> : ok ? <path d="m5 12 4.5 4.5L19 7" /> : <path d="M7 7l10 10M17 7 7 17" />}</svg>
        </span>
        <span style={{ flex: 1, fontSize: 15, lineHeight: 1.4, fontWeight: 500, color: isUndone ? ink.dim : ink.muted, textDecoration: isUndone ? "line-through" : "none" }}>{line}</span>
        {a.status === "completed" && a.undo.length ? (
          isUndone ? <span style={{ fontSize: 15, fontWeight: 600, color: ink.dim }}>Undone</span> : <button type="button" onClick={() => onUndo(a.undo)} style={{ minHeight: 44, padding: "0 4px", fontSize: 16, color: ink.link, fontWeight: 700 }}>Undo</button>
        ) : null}
      </div>
    );
  }
  return <ProposalCard a={a} P={P} onDecide={onDecide} />;
}

function ProposalCard({ a, onDecide }: { a: ActionView; P: Palette; onDecide: (id: string, d: "approve" | "decline") => void }) {
  const toast = useToast();
  const external = a.external;
  // Undo only when it can really be undone: anything that leaves Navi can't be.
  const lasting = external;
  return (
    <div style={{ ...glassStrong, borderRadius: 24, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {external ? (
        <span style={{ alignSelf: "flex-start", height: 28, padding: "0 10px", borderRadius: 14, background: meaning.needsOkBg, color: meaning.needsOk, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2L2 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Leaves Navi · {a.verb.toLowerCase()}
        </span>
      ) : null}
      <div style={{ fontSize: 17, lineHeight: 1.35, fontWeight: 700, letterSpacing: "-0.01em" }}>{a.subject}</div>
      {a.fields.length ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {a.fields.map((f) => (
            <li key={f.label} style={{ display: "flex", alignItems: "baseline", gap: 12, minHeight: 36, padding: "8px 12px", boxSizing: "border-box", borderRadius: 14, background: "rgba(17,20,26,0.04)" }}>
              <span style={{ width: 84, flex: "none", fontSize: 14, fontWeight: 600, color: ink.faint }}>{f.label}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, color: ink.text }}>
                {f.from ? <span style={{ color: ink.dim, textDecoration: "line-through", marginRight: 8 }}>{f.from}</span> : null}
                {f.value}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {a.reason ? <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, fontWeight: 500, color: ink.muted }}>{a.reason}</p> : null}
      {lasting ? <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: ink.faint }}>Can't be undone once it's sent.</p> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        {external ? (
          <HoldButton ms={800} doneFeel="commit" label={`Hold to ${a.verb.toLowerCase()}`} onDone={() => onDecide(a.id, "approve")} onHint={(t) => toast(t)} style={{ height: 46, padding: "0 20px", borderRadius: 23, background: ink.text, color: "#fff", fontSize: 16, fontWeight: 600 }} />
        ) : (
          <button type="button" onClick={() => { feel("success"); onDecide(a.id, "approve"); }} style={{ height: 46, padding: "0 20px", borderRadius: 23, background: ink.text, color: "#fff", fontSize: 16, fontWeight: 600 }}>{a.verb}</button>
        )}
        <button type="button" onClick={() => onDecide(a.id, "decline")} style={{ ...glass, height: 46, padding: "0 18px", borderRadius: 23, fontSize: 16, fontWeight: 600 }}>Not now</button>
      </div>
    </div>
  );
}
