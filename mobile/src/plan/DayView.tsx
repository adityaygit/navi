import { useState } from "react";
import type { MDay, MDayItem } from "@shared/mobile-api-types";
import { clock, clockAmPm, duration, range } from "../data/time";
import { feel } from "../native/haptics";
import { ease, glass, ink, meaning } from "../theme/tokens";

// The day (M6): two-line blocks to scale, fixed ones white with a lock,
// time you set aside pale blue, hard deadlines with a coral "Due" tag,
// clashes side by side in amber, free time as a dashed slot you can fill.

const PX = 0.8;
const bh = (min: number) => Math.max(64, Math.round(min * PX));
const TIME_W = 48;
const LEFT = TIME_W + 10;

/** Open tasks due this day, by task id (from the week view). */
export type DueMap = Map<string, { at: string; hard: boolean }>;

export type DayHandlers = {
  onPlace: (taskId: string, startIso: string, minutes: number, title: string) => void;
  onOpen: (item: MDayItem) => void;
  onAsk: (prompt: string, send?: boolean) => void;
  onFocus: (item: MDayItem) => void;
};

type Row =
  | { k: "now"; key: string; at: string; label: string }
  | { k: "gap"; key: string; minutes: number; start: string; fits: MDay["free"][number]["fits"] }
  | { k: "item"; key: string; item: MDayItem }
  | { k: "pair"; key: string; a: MDayItem; b: MDayItem };

function buildRows(day: MDay, showEarlier: boolean): Row[] {
  const earlier = new Set(day.earlier?.keys ?? []);
  const items = day.items.filter((i) => showEarlier || !earlier.has(i.key)).sort((a, b) => a.start.localeCompare(b.start));
  const byKey = new Map(day.items.map((i) => [i.key, i]));
  const paired = new Set<string>();
  const rows: Row[] = [];
  let cursor = null as string | null;
  let nowPlaced = !day.isToday;
  const nowIso = day.now;
  const tz = day.timezone;

  const placeNow = () => {
    if (nowPlaced) return;
    nowPlaced = true;
    const next = items.find((i) => i.start > nowIso && !i.now);
    const label = next ? `Free till ${clockAmPm(next.start, tz)}` : "Nothing else today";
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
      const [a, b] = it.start <= other.start ? [it, other] : [other, it];
      rows.push({ k: "pair", key: `pair-${a.key}`, a, b });
      const end = a.end > b.end ? a.end : b.end;
      cursor = cursor && cursor > end ? cursor : end;
    } else {
      rows.push({ k: "item", key: it.key, item: it });
      cursor = cursor && cursor > it.end ? cursor : it.end;
    }
    if (!nowPlaced && it.now) nowPlaced = true; // "now" is inside a running block: the block itself is marked
  }
  placeNow();
  return rows;
}

/** "Due 5" or "Due 5:30" — short enough to sit beside a title. */
export function dueLabel(iso: string, tz: string): string {
  return `Due ${clock(iso, tz).replace(/:00$/, "")}`;
}

/** The second line: when, then where or why. */
function subLine(it: MDayItem, tz: string): string {
  const why = it.assumed ? "Navi assumed you're free" : it.reason?.replace(/\.$/, "") || it.space?.name || null;
  return why && why.length <= 34 ? `${range(it.start, it.end, tz)} · ${why}` : range(it.start, it.end, tz);
}

export function LockIcon({ c = ink.dim, size = 12 }: { c?: string; size?: number }) {
  return (
    <svg width={size} height={size * 1.17} viewBox="0 0 10 12" aria-hidden="true" style={{ flex: "none" }}>
      <rect x="1" y="5" width="8" height="6" rx="1.5" fill={c} />
      <path d="M3 5V3.5a2 2 0 014 0V5" fill="none" stroke={c} strokeWidth="1.3" />
    </svg>
  );
}

export function blockLook(it: MDayItem): React.CSSProperties {
  if (it.look === "fixed") return { background: ink.raised, border: `1px solid ${ink.line}`, boxShadow: "0 1px 2px rgba(20,32,64,0.05), 0 10px 30px -16px rgba(20,32,64,0.2)" };
  if (it.look === "flex") return { background: ink.flexible, border: `1px solid ${ink.flexibleEdge}` };
  return { background: "transparent", border: "1.5px dashed rgba(17,20,26,0.18)" };
}

export function DayView({ day, h, due }: { day: MDay; h: DayHandlers; due: DueMap }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [needsOpen, setNeedsOpen] = useState(false);
  const tz = day.timezone;
  const rows = buildRows(day, showEarlier);
  const empty = !day.items.length;

  const time = (iso: string, strong: boolean) => (
    <span style={{ flex: "none", width: TIME_W, paddingTop: 17, textAlign: "right", fontSize: 15, fontWeight: 600, color: strong ? ink.text : ink.dim }}>{clock(iso, tz)}</span>
  );

  const tag = (it: MDayItem) => {
    const d = it.taskId ? due.get(it.taskId) : undefined;
    if (!d?.hard || it.done) return null;
    return <span style={{ flex: "none", height: 28, padding: "0 10px", borderRadius: 14, background: meaning.deadlineBg, color: meaning.deadline, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>{dueLabel(d.at, tz)}</span>;
  };

  const block = (it: MDayItem) => (
    <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex" }}>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          feel("select");
          h.onOpen(it);
        }}
        className="npress"
        style={{ ...blockLook(it), flex: 1, minWidth: 0, minHeight: bh(it.minutes), boxSizing: "border-box", borderRadius: 20, padding: "10px 16px", display: "flex", gap: 12, alignItems: "center", opacity: it.done ? 0.55 : 1, transition: "opacity 0.3s ease" }}
      >
        <span aria-hidden="true" style={{ flex: "none", alignSelf: "flex-start", marginTop: 7, width: 10, height: 10, borderRadius: 5, background: it.space?.color || it.color || "#A3A8BF" }} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3, textDecoration: it.done ? "line-through" : "none", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.title}</span>
          <span style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.3, color: it.now ? ink.text : ink.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.now ? `Now · until ${clockAmPm(it.end, tz)}` : subLine(it, tz)}</span>
        </span>
        {tag(it)}
        {it.look === "fixed" ? <LockIcon /> : null}
      </button>
    </div>
  );

  if (empty)
    return (
      <div style={{ padding: "56px 24px 0", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 18, animation: "nFade 0.3s ease both" }}>
        <p style={{ margin: 0, fontSize: 30, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.03em" }}>
          Your day is <span className="em">open</span>.
        </p>
        <button type="button" onClick={() => h.onAsk(`Help me plan ${day.isToday ? "today" : "this day"}.`, true)} style={{ height: 50, padding: "0 22px", borderRadius: 25, background: ink.text, color: ink.onCta, fontSize: 16, fontWeight: 600 }}>
          Plan it with Navi
        </button>
      </div>
    );

  return (
    <div style={{ padding: "0 16px" }}>
      {day.earlier && day.earlier.keys.length ? (
        <button type="button" onClick={() => { feel("select"); setShowEarlier((v) => !v); }} style={{ ...glass, marginLeft: LEFT, marginBottom: 10, height: 40, padding: "0 14px", borderRadius: 20, display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600 }}>
          {showEarlier ? "Hide earlier" : `Earlier · ${day.earlier.done} done`}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d={showEarlier ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
        </button>
      ) : null}
      <ol aria-label="Timeline" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => {
          if (r.k === "now")
            return (
              <li key={r.key} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 30 }}>
                <span style={{ flex: "none", width: TIME_W, textAlign: "right", fontSize: 15, fontWeight: 700, color: "#2B6FFF" }}>{clock(r.at, tz)}</span>
                <span aria-hidden="true" style={{ flex: "none", width: 10, height: 10, borderRadius: 5, background: "#2B6FFF", boxShadow: "0 0 0 4px rgba(43,111,255,0.14)" }} />
                <span style={{ flex: "none", fontSize: 15, fontWeight: 600, color: ink.soft }}>{r.label}</span>
                <span aria-hidden="true" style={{ flex: 1, height: 2, borderRadius: 1, background: "linear-gradient(90deg, rgba(43,111,255,0.7), rgba(43,111,255,0))" }} />
              </li>
            );
          if (r.k === "gap") {
            const future = !day.isToday || r.start >= day.now;
            const slot = r.minutes >= 45 && future;
            if (!slot) return <li key={r.key} aria-hidden="true" style={{ height: r.minutes > 120 ? 18 : 4 }} />;
            return (
              <li key={r.key} style={{ display: "flex", gap: 10 }}>
                {time(r.start, false)}
                <div style={{ flex: 1, minWidth: 0, minHeight: 64, boxSizing: "border-box", borderRadius: 20, border: "2px dashed rgba(17,20,26,0.14)", padding: "8px 8px 8px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{duration(r.minutes)} free</span>
                    <span style={{ fontSize: 15, fontWeight: 500, color: ink.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.fits ? `Fits ${r.fits.title}` : "Nothing planned"}</span>
                  </span>
                  {r.fits ? (
                    <button type="button" aria-label={`Add ${r.fits.title} here`} onClick={() => h.onPlace(r.fits!.taskId, r.start, r.fits!.estimate, r.fits!.title)} style={{ ...glass, flex: "none", height: 44, padding: "0 16px", borderRadius: 22, fontSize: 15, fontWeight: 600 }}>
                      Add
                    </button>
                  ) : (
                    <button type="button" onClick={() => h.onAsk(`I have ${duration(r.minutes)} free from ${clockAmPm(r.start, tz)}. What should go there?`, true)} style={{ ...glass, flex: "none", height: 44, padding: "0 16px", borderRadius: 22, fontSize: 15, fontWeight: 600 }}>
                      Fill it
                    </button>
                  )}
                </div>
              </li>
            );
          }
          if (r.k === "pair") {
            const card = (it: MDayItem) => (
              <button key={it.key} type="button" onClick={() => { feel("select"); h.onOpen(it); }} style={{ flex: 1, minWidth: 0, minHeight: 64, boxSizing: "border-box", borderRadius: 18, padding: "10px 12px", background: "#FFF7EC", border: "1.5px solid rgba(233,169,58,0.55)", display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.title}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: meaning.needsOk, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{range(it.start, it.end, tz)}</span>
              </button>
            );
            return (
              <li key={r.key} style={{ display: "flex", gap: 10 }}>
                {time(r.a.start, false)}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {card(r.a)}
                    {card(r.b)}
                  </div>
                  <button type="button" onClick={() => h.onAsk(`“${r.b.title}” clashes with “${r.a.title}”. Help me sort it out.`, true)} style={{ alignSelf: "flex-start", height: 40, padding: "0 14px", borderRadius: 20, background: ink.text, color: ink.onCta, fontSize: 15, fontWeight: 600 }}>
                    These clash · sort it out
                  </button>
                </div>
              </li>
            );
          }
          const it = r.item;
          return (
            <li key={r.key} style={{ display: "flex", gap: 10, animation: "nFade 0.3s ease both" }}>
              {time(it.start, it.now)}
              {block(it)}
            </li>
          );
        })}
      </ol>

      {day.untimed.length || day.needsTimeTotal ? (
        <div style={{ margin: `18px 0 0 ${LEFT}px`, display: "flex", flexDirection: "column", gap: 8 }}>
          {day.untimed.length ? <span style={{ fontSize: 15, fontWeight: 500, color: ink.faint }}>Also today · {day.untimed.map((u) => u.title).join(" · ")}</span> : null}
          {day.needsTimeTotal ? (
            <div style={{ background: ink.raised, borderRadius: 22, border: `1px solid ${ink.line}`, overflow: "hidden" }}>
              <button type="button" aria-expanded={needsOpen} onClick={() => { feel("select"); setNeedsOpen((v) => !v); }} style={{ width: "100%", minHeight: 56, padding: "0 16px", display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700 }}>
                <span style={{ flex: 1 }}>{day.needsTimeTotal === 1 ? "1 thing needs a time" : `${day.needsTimeTotal} things need a time`}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ transform: needsOpen ? "rotate(180deg)" : "none", transition: `transform 0.3s ${ease}` }}><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {needsOpen
                ? day.needsTime.map((n) => (
                    <div key={n.id} style={{ minHeight: 60, padding: "6px 8px 6px 16px", display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${ink.line}`, animation: `nRise 0.3s ${ease} both` }}>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.title}</span>
                        <span style={{ fontSize: 14, fontWeight: 500, color: n.due_is_hard ? meaning.deadline : ink.faint }}>{[n.estimate_minutes ? duration(n.estimate_minutes) : null, n.due_at ? `${n.due_is_hard ? "Due" : "Aim for"} ${new Date(n.due_at).toLocaleDateString(undefined, { weekday: "short", timeZone: tz })}` : null].filter(Boolean).join(" · ") || "No estimate yet"}</span>
                      </span>
                      <button type="button" onClick={() => h.onAsk(`Find a time for “${n.title}”.`, true)} style={{ ...glass, flex: "none", height: 40, padding: "0 14px", borderRadius: 20, fontSize: 15, fontWeight: 600 }}>Find a time</button>
                    </div>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
