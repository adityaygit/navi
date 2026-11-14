import type { MWeek } from "@shared/mobile-api-types";
import { dayNum, duration, hourOf, weekdayShort } from "../data/time";
import { feel } from "../native/haptics";
import { ink, meaning } from "../theme/tokens";

// One row per day: the day's blocks as a bar from 7 AM to 11 PM, planned hours on the right.
const FROM = 7;
const TO = 23;

export function WeekView({ week, onOpenDay }: { week: MWeek; onOpenDay: (date: string) => void }) {
  const tz = week.timezone;
  return (
    <>
      <ul aria-label="This week" style={{ listStyle: "none", margin: 0, padding: "0 20px", display: "flex", flexDirection: "column", gap: 4 }}>
        {week.days.map((d) => (
          <li key={d.date}>
            <button
              type="button"
              onClick={() => {
                feel("select");
                onOpenDay(d.date);
              }}
              style={{ width: "calc(100% + 24px)", minHeight: 60, display: "flex", alignItems: "center", gap: 12, borderRadius: 16, background: d.isToday ? "rgba(255,255,255,0.06)" : "transparent", padding: "0 12px", marginLeft: -12, boxSizing: "border-box" }}
            >
              <span style={{ width: 40, flex: "none", display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 13, color: ink.faint }}>{weekdayShort(d.date)}</span>
                <span style={{ fontSize: 20, fontWeight: 600, color: d.isToday ? ink.text : ink.soft }}>{dayNum(d.date)}</span>
              </span>
              <span aria-hidden="true" style={{ flex: 1, height: 26, position: "relative", borderRadius: 8, background: "rgba(255,255,255,0.04)" }}>
                {d.items.map((it) => {
                  const a = Math.max(FROM, Math.min(TO, hourOf(it.start, tz)));
                  const b = Math.max(a + 0.25, Math.min(TO, hourOf(it.end, tz) || TO));
                  const l = ((a - FROM) / (TO - FROM)) * 100;
                  const w = Math.max(1.5, ((b - a) / (TO - FROM)) * 100);
                  return <span key={it.key} style={{ position: "absolute", top: 4, height: 18, left: `${l}%`, width: `${w}%`, borderRadius: 4, background: it.color || "#8E8E96", opacity: it.done ? 0.45 : 0.9, boxShadow: it.overlaps.length ? `0 0 0 2px ${meaning.needsOk}` : "none" }} />;
                })}
              </span>
              <span style={{ width: 48, textAlign: "right", fontSize: 13, color: ink.muted }}>{d.plannedMinutes ? duration(d.plannedMinutes) : "—"}</span>
            </button>
          </li>
        ))}
      </ul>
      <p style={{ margin: "12px 20px 0", fontSize: 13, color: ink.faint }}>Each bar is 7 AM to 11 PM. Amber marks an overlap.</p>
    </>
  );
}
