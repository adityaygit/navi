import type { MWeek } from "@shared/mobile-api-types";
import { duration, weekdayShort, dayNum } from "../data/time";
import { feel } from "../native/haptics";
import { ink, meaning } from "../theme/tokens";

// The week (M6): one white card, a row a day. Each row: the day, a bar of its
// planned time in the colours of its spaces, one line about it, the hours.

const DAY_MIN = 16 * 60; // a waking day, 7 AM to 11 PM

type WDay = MWeek["days"][number];

function note(d: WDay): { t: string; c: string } {
  if (d.overlaps) return { t: d.overlaps === 1 ? "1 clash" : `${d.overlaps} clashes`, c: meaning.needsOk };
  const hard = d.due.find((x) => x.due_is_hard);
  if (hard) return { t: `Due · ${hard.title}`, c: meaning.deadline };
  if (!d.items.length) return { t: d.due.length ? `Aim for · ${d.due[0].title}` : "Nothing planned", c: ink.faint };
  const names = d.items.slice(0, 2).map((i) => i.title);
  const more = d.items.length - names.length;
  return { t: names.join(", ") + (more > 0 ? ` +${more}` : ""), c: ink.faint };
}

export function WeekView({ week, onOpenDay }: { week: MWeek; onOpenDay: (date: string) => void }) {
  return (
    <div style={{ padding: "0 16px" }}>
      <ul aria-label="This week" style={{ listStyle: "none", margin: 0, padding: "6px 16px", background: ink.raised, borderRadius: 24, border: `1px solid ${ink.line}`, boxShadow: "0 10px 30px -18px rgba(20,32,64,0.22)" }}>
        {week.days.map((d, i) => {
          const n = note(d);
          // Segments by space colour, in time order; the rest of the waking day is grey.
          const segs = d.items.map((it) => ({ k: it.key, c: it.space?.color || it.color || "#A3A8BF", f: Math.max(20, it.minutes), o: it.done ? 0.45 : 1 }));
          const free = Math.max(0, DAY_MIN - d.plannedMinutes);
          return (
            <li key={d.date} style={{ borderBottom: i < week.days.length - 1 ? `1px solid ${ink.line}` : "none" }}>
              <button
                type="button"
                aria-label={`${weekdayShort(d.date)} ${dayNum(d.date)}: ${n.t}, ${d.plannedMinutes ? duration(d.plannedMinutes) : "nothing"} planned`}
                onClick={() => {
                  feel("select");
                  onOpenDay(d.date);
                }}
                style={{ width: "100%", minHeight: 64, display: "flex", alignItems: "center", gap: 14 }}
              >
                <span style={{ flex: "none", width: 44, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 16, fontWeight: d.isToday ? 800 : 600, color: d.isToday ? ink.text : ink.soft }}>{weekdayShort(d.date)}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: ink.dim }}>{d.isToday ? "Today" : dayNum(d.date)}</span>
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6, padding: "10px 0" }}>
                  <span aria-hidden="true" style={{ display: "flex", gap: 3, height: 14 }}>
                    {segs.map((s) => (
                      <span key={s.k} style={{ flex: `${s.f} 1 0`, borderRadius: 7, background: s.c, opacity: s.o }} />
                    ))}
                    {free ? <span style={{ flex: `${free} 1 0`, borderRadius: 7, background: "rgba(17,20,26,0.08)" }} /> : null}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 500, color: n.c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.t}</span>
                </span>
                <span style={{ flex: "none", minWidth: 44, textAlign: "right", fontSize: 15, fontWeight: 700 }}>{d.plannedMinutes ? duration(d.plannedMinutes) : "—"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
