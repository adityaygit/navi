import { useState } from "react";
import type { MDay, MDayItem } from "@shared/mobile-api-types";
import { clock, duration, range } from "../data/time";
import { feel } from "../native/haptics";
import { ease, ink, meaning, type Palette } from "../theme/tokens";

// The day as a timeline to scale (M4): 48 px an hour, nothing shorter than
// 52 px, long free stretches folded. Time column 40 + 12, so every block
// starts on the same line as "This morning" and the footer.

const PX = 0.8;
const bh = (min: number) => Math.max(52, Math.round(min * PX));
const gh = (min: number) => (min < 15 ? 8 : min <= 120 ? Math.max(12, Math.round(min * PX)) : 56);
const LEFT = 52;

export type DayHandlers = {
  onPlace: (taskId: string, startIso: string, minutes: number, title: string) => void;
  onOutcome: (item: MDayItem, status: "done" | "skipped") => void;
  onAsk: (prompt: string) => void;
  onFocus: (item: MDayItem) => void;
};

type Row =
  | { k: "now"; key: string; at: string; label: string }
  | { k: "gap"; key: string; minutes: number; start: string; fits: MDay["free"][number]["fits"] }
  | { k: "item"; key: string; item: MDayItem }
  | { k: "pair"; key: string; a: MDayItem; b: MDayItem; note: string };

function hex(c: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return `rgba(200,200,210,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function buildRows(day: MDay, showEarlier: boolean): Row[] {
  const earlier = new Set(day.earlier?.keys ?? []);
  const items = day.items.filter((i) => showEarlier || !earlier.has(i.key)).sort((a, b) => a.start.localeCompare(b.start));
  const byKey = new Map(day.items.map((i) => [i.key, i]));
  const paired = new Set<string>();
  const rows: Row[] = [];
  let cursor = null as string | null;
  let nowPlaced = !day.isToday;
  const nowIso = day.now;

  const placeNow = () => {
    if (nowPlaced) return;
    nowPlaced = true;
    const next = items.find((i) => i.start > nowIso && !i.now);
    const free = day.free.find((f) => f.start <= nowIso && f.end > nowIso) ?? day.free.find((f) => f.start >= nowIso);
    const label = items.some((i) => i.now) ? "Now" : next && free && free.start <= nowIso ? `Now · free until ${clock(next.start, day.timezone)}` : next ? `Now · next thing at ${clock(next.start, day.timezone)}` : "Now · nothing else today";
    rows.push({ k: "now", key: "now", at: nowIso, label });
    cursor = nowIso;
  };

  for (const it of items) {
    if (paired.has(it.key)) continue;
    if (!nowPlaced && it.start > nowIso) placeNow();
    if (cursor && it.start > cursor) {
      const minutes = Math.round((Date.parse(it.start) - Date.parse(cursor)) / 60000);
      if (minutes >= 15) {
        const f = day.free.find((x) => x.start >= cursor! && x.start < it.start);
        rows.push({ k: "gap", key: `gap-${it.key}`, minutes, start: f?.start ?? cursor, fits: f?.fits ?? null });
      }
    }
    const other = it.overlaps.map((k) => byKey.get(k)).find((o) => o && !paired.has(o.key));
    if (other) {
      paired.add(it.key);
      paired.add(other.key);
      const [a, b] = it.minutes >= other.minutes ? [it, other] : [other, it];
      rows.push({ k: "pair", key: `pair-${a.key}`, a, b, note: `${b.title} overlaps ${a.title.toLowerCase().startsWith("your") ? a.title : `your ${a.title.charAt(0).toLowerCase()}${a.title.slice(1)}`}` });
      const end = a.end > b.end ? a.end : b.end;
      cursor = cursor && cursor > end ? cursor : end;
    } else {
      rows.push({ k: "item", key: it.key, item: it });
      cursor = cursor && cursor > it.end ? cursor : it.end;
    }
    if (!nowPlaced && it.now) {
      nowPlaced = true; // "now" sits inside a running block: the block itself is marked
    }
  }
  placeNow();
  return rows;
}

export function DayView({ day, P, h }: { day: MDay; P: Palette; h: DayHandlers }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [needsOpen, setNeedsOpen] = useState(false);
  const tz = day.timezone;
  const rows = buildRows(day, showEarlier);
  const nextKey = day.items.find((i) => i.start > day.now && i.open && i.look === "flex")?.key;

  const block = (it: MDayItem, compact = false) => {
    const c = it.color || "#8E8E96";
    const isSel = sel === it.key;
    const bg = it.look === "fixed" ? hex(c, 0.16) : it.look === "flex" ? hex(c, 0.07) : "transparent";
    const border = it.look === "routine" ? `1.5px dashed ${hex(c, 0.45)}` : it.look === "flex" ? `1.5px solid ${hex(c, it.key === nextKey ? 0.75 : 0.5)}` : `1px solid ${hex(c, 0.35)}`;
    const due = it.overlaps.length ? "#F8D2B0" : "rgba(255,255,255,0.62)";
    return (
      <div style={{ position: "relative", flex: 1, minWidth: 0, borderRadius: 16, background: bg, border, boxSizing: "border-box", display: "flex", flexDirection: "column", opacity: it.done ? 0.55 : 1, transition: "background-color 0.25s, opacity 0.25s", height: compact ? "100%" : undefined }}>
        <button
          type="button"
          aria-expanded={isSel}
          onClick={() => {
            feel("select");
            setSel(isSel ? null : it.key);
          }}
          style={{ minHeight: compact ? undefined : bh(it.minutes) - 3, padding: compact ? "12px 14px" : "12px 16px", display: "flex", flexDirection: "column", gap: 2, flex: compact ? 1 : undefined }}
        >
          <span style={{ fontSize: compact ? 15 : 17, fontWeight: 600, textDecoration: it.done ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{it.title}</span>
          <span style={{ fontSize: 13, color: compact ? due : "rgba(255,255,255,0.62)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
            {range(it.start, it.end, tz)}
            {it.space && !compact ? ` · ${it.space.name}` : ""}
          </span>
        </button>
        {!compact && !isSel && it.key === nextKey && it.taskId && day.isToday ? (
          <button type="button" onClick={() => { feel("select"); h.onFocus(it); }} style={{ position: "absolute", right: 11, top: 11, height: 40, padding: "0 18px", borderRadius: 20, background: P.cta, color: "#0B0B0C", fontSize: 15, fontWeight: 600 }}>Start</button>
        ) : null}
        {isSel && !compact ? (
          <div style={{ display: "flex", gap: 8, padding: "4px 12px 12px", animation: `nRise 0.28s ${ease} both` }}>
            {it.taskId && !it.done && day.isToday ? (
              <button type="button" onClick={() => { setSel(null); h.onFocus(it); }} style={{ flex: 1, height: 44, borderRadius: 22, background: P.cta, color: "#0B0B0C", fontSize: 15, fontWeight: 600, textAlign: "center" }}>
                Start focus
              </button>
            ) : null}
            {it.kind === "block" && !it.done ? (
              <button type="button" onClick={() => { setSel(null); h.onOutcome(it, "done"); }} style={{ flex: 1, height: 44, borderRadius: 22, background: it.taskId && day.isToday ? "rgba(255,255,255,0.10)" : P.cta, color: it.taskId && day.isToday ? "#F5F5F7" : "#0B0B0C", fontSize: 15, fontWeight: it.taskId && day.isToday ? 400 : 600, textAlign: "center" }}>
                Mark done
              </button>
            ) : null}
            {it.taskId && !it.done && day.isToday && it.kind === "block" ? null : <button type="button" onClick={() => { setSel(null); h.onAsk(`About “${it.title}” at ${clock(it.start, tz)}: `); }} style={{ flex: 1, height: 44, borderRadius: 22, background: "rgba(255,255,255,0.10)", fontSize: 15, textAlign: "center" }}>
              Ask Navi
            </button>}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div style={{ padding: "0 20px" }}>
      {day.earlier && day.earlier.keys.length ? (
        <button type="button" onClick={() => { feel("select"); setShowEarlier((v) => !v); }} style={{ marginLeft: LEFT, minHeight: 44, display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: ink.faint }}>
          {showEarlier ? "Hide this morning" : `This morning · ${day.earlier.done} done`}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d={showEarlier ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
        </button>
      ) : null}
      <ol aria-label="Timeline" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((r) => {
          if (r.k === "now")
            return (
              <li key={r.key} style={{ display: "flex", gap: 12, minHeight: 54 }}>
                <span style={{ width: 40, flex: "none", paddingTop: 2, fontSize: 13, fontWeight: 600 }}>{clock(r.at, tz)}</span>
                <div style={{ flex: 1, paddingTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: ink.text, boxShadow: "0 0 0 4px rgba(255,255,255,0.12)" }} />
                    <span aria-hidden="true" style={{ flex: 1, height: 1.5, background: "rgba(255,255,255,0.55)" }} />
                  </div>
                  <div style={{ margin: "8px 0 0 18px", fontSize: 15, color: ink.muted }}>{r.label}</div>
                </div>
              </li>
            );
          if (r.k === "gap") {
            const folded = r.minutes > 120;
            return (
              <li key={r.key} style={{ display: "flex", gap: 12, minHeight: r.fits ? 44 : gh(r.minutes) }}>
                <span style={{ width: 40, flex: "none" }} />
                {r.minutes >= 30 ? (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, paddingLeft: 16 }}>
                    {folded ? <span aria-hidden="true" style={{ width: 18, height: 34, borderLeft: "2px dotted rgba(255,255,255,0.25)" }} /> : null}
                    <span style={{ flex: 1, fontSize: 13, color: ink.faint }}>{duration(r.minutes)} free</span>
                    {r.fits ? (
                      <button type="button" onClick={() => h.onPlace(r.fits!.taskId, r.start, r.fits!.estimate, r.fits!.title)} style={{ minHeight: 44, padding: "0 6px", color: P.accent, fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "62%" }}>
                        Add {r.fits.title.charAt(0).toLowerCase() + r.fits.title.slice(1)}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          }
          if (r.k === "pair") {
            const ha = bh(r.a.minutes);
            const off = Math.max(0, Math.round(((Date.parse(r.b.start) - Date.parse(r.a.start)) / 60000) * PX));
            return (
              <li key={r.key} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", gap: 12, minHeight: Math.max(ha, off + 62) }}>
                  <span style={{ width: 40, flex: "none", paddingTop: 14, fontSize: 13, color: ink.faint }}>{clock(r.a.start, tz)}</span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 8, height: Math.max(ha, off + 62) }}>
                    <div style={{ flex: 1, minWidth: 0, height: ha }}>{block(r.a, true)}</div>
                    <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                      <div style={{ position: "absolute", left: 0, right: 0, top: off, height: 62 }}>{block(r.b, true)}</div>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <span style={{ width: 40, flex: "none" }} />
                  <button type="button" onClick={() => h.onAsk(`${r.b.title} overlaps ${r.a.title}. Help me sort it out.`)} style={{ flex: 1, minWidth: 0, minHeight: 44, display: "flex", alignItems: "center", gap: 8, paddingLeft: 6, fontSize: 13, color: meaning.needsOk }}>
                    <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, borderRadius: 4, background: meaning.needsOk }} />
                    <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.note}</span>
                    <span style={{ flex: "none", fontSize: 15, fontWeight: 600 }}>Sort it out</span>
                  </button>
                </div>
              </li>
            );
          }
          const it = r.item;
          return (
            <li key={r.key} style={{ display: "flex", gap: 12, minHeight: bh(it.minutes), marginBottom: 12, animation: `nFade 0.3s ease both` }}>
              <span style={{ width: 40, flex: "none", paddingTop: 14, fontSize: 13, fontWeight: it.now ? 600 : 400, color: it.now ? ink.text : ink.faint }}>{clock(it.start, tz)}</span>
              {block(it)}
            </li>
          );
        })}
      </ol>
      <div style={{ margin: `16px 0 0 ${LEFT}px`, display: "flex", flexDirection: "column" }}>
        {day.untimed.length ? <span style={{ fontSize: 13, color: ink.faint }}>{day.untimed.map((u) => u.title).join(" · ")}</span> : null}
        {day.needsTimeTotal ? (
          <button type="button" onClick={() => { feel("select"); setNeedsOpen((v) => !v); }} style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 6, fontSize: 15, color: ink.soft }}>
            {day.needsTimeTotal === 1 ? "1 thing still needs a time" : `${day.needsTimeTotal} things still need a time`}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d={needsOpen ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
          </button>
        ) : null}
        {needsOpen
          ? day.needsTime.map((n) => (
              <div key={n.id} style={{ minHeight: 56, display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${ink.line}`, animation: `nRise 0.3s ${ease} both` }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 17, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</span>
                  <span style={{ fontSize: 13, color: ink.faint }}>{[n.estimate_minutes ? duration(n.estimate_minutes) : null, n.steps ? `${n.steps} steps` : null, n.due_at ? `due ${new Date(n.due_at).toLocaleDateString(undefined, { weekday: "short" })}` : null].filter(Boolean).join(" · ") || "No estimate"}</span>
                </span>
                <button type="button" onClick={() => h.onAsk(`Find a time for “${n.title}”.`)} style={{ minHeight: 44, padding: "0 4px", color: P.accent, fontWeight: 600, fontSize: 15 }}>Find a time</button>
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
