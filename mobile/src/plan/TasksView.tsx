import { useState } from "react";
import type { MTaskGroups, MTaskItem } from "@shared/mobile-api-types";
import { duration } from "../data/time";
import { feel } from "../native/haptics";
import { ease, ink, meaning } from "../theme/tokens";

// The list (M6): white cards by when, each row a ring to tick, the title,
// and one line of what matters (deadline, steps, how long).

type Props = { groups: MTaskGroups; tz: string; onToggle: (t: MTaskItem, done: boolean) => void; onAsk: (prompt: string) => void };

const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

/** "today 5 PM", "tomorrow", or "Thursday". */
function when(iso: string, tz: string): string {
  const d = new Date(iso);
  const day = ymd(d, tz);
  const today = ymd(new Date(), tz);
  const tomorrow = ymd(new Date(Date.now() + 86400000), tz);
  if (day === today) return `today ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).replace(":00", "")}`;
  if (day === tomorrow) return "tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", timeZone: tz });
}

function meta(t: MTaskItem, tz: string): string {
  const bits: string[] = [];
  if (t.due_at) bits.push(`${t.due_is_hard ? "Due" : "Aim for"} ${when(t.due_at, tz)}`);
  if (t.next) bits.push(`Planned ${new Date(t.next.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz })}`);
  if (t.steps.total) bits.push(`${t.steps.done} of ${t.steps.total} steps`);
  else if (t.estimate_minutes) bits.push(duration(t.estimate_minutes));
  if (!bits.length && t.space) bits.push(t.space.name);
  return bits.join(" · ");
}

export function TasksView({ groups, tz, onToggle, onAsk }: Props) {
  // Ticked rows stay in place (struck through) until the view reloads, so nothing jumps under your finger.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const sections: [string, MTaskItem[]][] = [
    ["Today", [...groups.today, ...groups.doneToday]],
    ["Needs a time", groups.needsTime],
    ["Later", groups.later],
  ];
  const any = sections.some(([, i]) => i.length);
  if (!any)
    return (
      <div style={{ padding: "56px 24px 0", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 18 }}>
        <p style={{ margin: 0, fontSize: 30, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.03em" }}>
          Nothing on your <span className="em">list</span>.
        </p>
        <button type="button" onClick={() => onAsk("Here's what's coming up: ")} style={{ height: 50, padding: "0 22px", borderRadius: 25, background: ink.text, color: ink.onCta, fontSize: 16, fontWeight: 600 }}>
          Tell Navi what's coming
        </button>
      </div>
    );
  return (
    <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      {sections
        .filter(([, items]) => items.length)
        .map(([h, items], si) => (
          <section key={h} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={{ margin: si ? "14px 4px 0" : "0 4px", fontSize: 15, fontWeight: 700, color: ink.muted }}>
              {h} <span style={{ fontWeight: 600, color: ink.dim }}>· {items.length}</span>
            </h2>
            <ul style={{ listStyle: "none", margin: 0, padding: "4px 8px", background: ink.raised, borderRadius: 24, border: `1px solid ${ink.line}`, boxShadow: "0 10px 30px -18px rgba(20,32,64,0.22)" }}>
              {items.map((t, i) => {
                const done = ticked.has(t.id) ? t.status !== "done" : t.status === "done";
                const m = meta(t, tz);
                return (
                  <li key={t.id} style={{ borderBottom: i < items.length - 1 ? `1px solid ${ink.line}` : "none" }}>
                    <button
                      type="button"
                      aria-pressed={done}
                      aria-label={`${t.title}${m ? `, ${m}` : ""}. ${done ? "Done. Tap to undo." : "Tap to mark done."}`}
                      onClick={() => {
                        feel(done ? "undo" : "success");
                        setTicked((prev) => {
                          const n = new Set(prev);
                          if (n.has(t.id)) n.delete(t.id);
                          else n.add(t.id);
                          return n;
                        });
                        onToggle(t, !done);
                      }}
                      style={{ width: "100%", minHeight: 62, padding: "8px 8px", display: "flex", alignItems: "center", gap: 14 }}
                    >
                      <span aria-hidden="true" style={{ flex: "none", width: 28, height: 28, boxSizing: "border-box", borderRadius: 14, border: done ? "none" : "2px solid rgba(17,20,26,0.24)", background: done ? meaning.kept : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: `background-color 0.2s, transform 0.25s ${ease}`, transform: done ? "scale(1.06)" : "none" }}>
                        <svg width="14" height="12" viewBox="0 0 14 12" style={{ opacity: done ? 1 : 0, transition: "opacity 0.2s" }}><path d="M1.5 6.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3, color: done ? ink.dim : ink.text, textDecoration: done ? "line-through" : "none", transition: "color 0.25s", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.title}</span>
                        {m ? <span style={{ fontSize: 15, fontWeight: 500, color: t.due_is_hard && !done ? meaning.deadline : ink.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m}</span> : null}
                      </span>
                      {t.space ? <span aria-hidden="true" style={{ flex: "none", width: 10, height: 10, borderRadius: 5, background: t.space.color }} /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
    </div>
  );
}
