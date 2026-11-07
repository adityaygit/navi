import Link from "next/link";
import { DateTime } from "luxon";
import { hourLabel, layoutColumn } from "@/lib/day-layout";
import type { TimelineEntry } from "./timeline";

export type CalendarDay = {
  date: string;
  entries: TimelineEntry[];
  /** All-day row: occasions (long events) and tasks due that day. */
  allDay: { key: string; label: string; kind: "event" | "due"; color: string; href: string }[];
};

const PX = 44;

/**
 * The week (or one day) on an hour grid: fixed things tinted, time you set
 * aside outlined, routines dashed. Each block links to that day's timeline.
 * Phones get a plain list of days instead of the grid.
 */
export function CalendarGrid({ days, zone, today, nowMs, hours }: { days: CalendarDay[]; zone: string; today: string; nowMs: number; hours: { from: number; to: number } }) {
  const cols = days.length;
  const height = (hours.to - hours.from) * PX;
  const gridStartOf = (d: string) => DateTime.fromISO(d, { zone }).set({ hour: hours.from }).toMillis();
  const gridEndOf = (d: string) => DateTime.fromISO(d, { zone }).startOf("day").plus({ hours: hours.to }).toMillis();
  const fmt = (ms: number) => DateTime.fromMillis(ms, { zone }).toFormat("h:mm");
  const fmtA = (ms: number) => DateTime.fromMillis(ms, { zone }).toFormat("h:mm a");
  const colTemplate = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };
  const hourMarks = Array.from({ length: hours.to - hours.from - 1 }, (_, i) => hours.from + i + 1);

  return (
    <>
      {/* Desktop and tablet: the grid. */}
      <div className="hidden md:block" role="region" aria-label={cols === 1 ? "Day calendar" : "Week calendar"}>
        <div className="flex">
          <span className="w-14 shrink-0" />
          <div className="grid flex-1 gap-1.5" style={colTemplate}>
            {days.map((d) => {
              const dt = DateTime.fromISO(d.date, { zone });
              const isToday = d.date === today;
              return (
                <Link key={d.date} href={`/planner?date=${d.date}`} className="relative flex h-10 items-center gap-2 rounded-[12px] px-2 hover:bg-white/[0.04]">
                  <span className="sr-only">{`Open ${dt.toFormat("cccc, LLLL d")} as a timeline`}</span>
                  <span aria-hidden="true" className={`text-[13px] ${isToday ? "text-text" : "text-[#8E8E96]"}`}>{dt.toFormat("ccc")}</span>
                  <span aria-hidden="true" className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[14px] font-semibold ${isToday ? "bg-text text-black" : "text-text"}`}>{dt.toFormat("d")}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-0.5 flex">
          <span className="flex w-14 shrink-0 items-center text-[11.5px] text-dim">all day</span>
          <div className="grid flex-1 gap-1.5" style={colTemplate}>
            {days.map((d) => (
              <ul key={d.date} className="flex min-h-[30px] flex-col justify-center gap-1 py-0.5" aria-label={`All day, ${DateTime.fromISO(d.date, { zone }).toFormat("cccc")}`}>
                {d.allDay.map((a) => (
                  <li key={a.key}>
                    <Link
                      href={a.href}
                      aria-label={a.kind === "due" ? `${a.label}, due this day` : a.label}
                      title={a.kind === "due" ? `${a.label} (due)` : a.label}
                      className="flex h-6 w-full items-center overflow-hidden whitespace-nowrap rounded-[8px] px-2 text-[12px] font-semibold"
                      style={
                        a.kind === "due"
                          ? { border: "1px solid color-mix(in srgb, var(--due) 60%, transparent)", color: "var(--due)" }
                          : { background: `color-mix(in srgb, ${a.color} 22%, transparent)`, color: `color-mix(in srgb, ${a.color} 55%, white)` }
                      }
                    >
                      <span className="truncate">{a.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <div className="mt-2 flex">
          <div className="relative w-14 shrink-0" style={{ height }} aria-hidden="true">
            {hourMarks.map((h) => (
              <span key={h} className="absolute left-0 text-[11.5px] text-dim" style={{ top: (h - hours.from) * PX - 7 }}>{hourLabel(h)}</span>
            ))}
          </div>
          <div
            className="grid flex-1 gap-1.5"
            style={{ ...colTemplate, height, backgroundImage: `repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0, rgba(255,255,255,0.06) 1px, transparent 1px, transparent ${PX}px)` }}
          >
            {days.map((d) => {
              const isToday = d.date === today;
              const gs = gridStartOf(d.date);
              const ge = gridEndOf(d.date);
              const placed = layoutColumn(d.entries, gs, ge, PX, 17);
              const nowTop = isToday && nowMs >= gs && nowMs <= ge ? ((nowMs - gs) / 3600000) * PX : null;
              const dayName = DateTime.fromISO(d.date, { zone }).toFormat("cccc");
              return (
                <ul key={d.date} className={`relative rounded-[10px] ${isToday ? "bg-white/[0.025]" : ""}`} style={{ height }} aria-label={dayName}>
                  {placed.map(({ item: e, top, height: h, lane, lanes }) => {
                    const long = h >= 30;
                    const done = e.block?.status === "done";
                    const skipped = e.block && !["planned", "in_progress", "done"].includes(e.block.status);
                    const style =
                      e.look === "fixed"
                        ? { background: `color-mix(in srgb, ${e.color} 22%, transparent)`, color: `color-mix(in srgb, ${e.color} 55%, white)` }
                        : e.look === "routine"
                          ? { border: `1px dashed color-mix(in srgb, ${e.color} 80%, transparent)`, background: "rgba(255,255,255,0.035)", color: "#8E8E96" }
                          : { border: `1.5px solid color-mix(in srgb, ${e.color} 75%, transparent)`, background: "rgba(255,255,255,0.035)", color: "#F5F5F7" };
                    return (
                      <li key={`${e.kind}${e.id}${e.startMs}`} className="absolute" style={{ top: top + 1, height: h - 3, left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` }}>
                        <Link
                          href={`/planner?date=${d.date}`}
                          className={`flex h-full flex-col gap-px overflow-hidden rounded-[9px] ${long ? "px-2 py-1.5" : "px-2 py-px"} ${done || skipped ? "opacity-45" : ""}`}
                          style={style}
                        >
                          <span className={`truncate text-[12.5px] font-semibold leading-tight ${done ? "line-through" : ""}`}>{e.title}</span>
                          <span className="sr-only">{`, ${dayName} ${fmtA(e.startMs)} to ${fmtA(e.endMs)}${e.look === "fixed" ? ", fixed" : e.look === "routine" ? ", routine" : ", flexible"}${done ? ", done" : ""}`}</span>
                          {long && <span className="whitespace-nowrap text-[11.5px] opacity-80" aria-hidden="true">{fmt(e.startMs)} – {fmt(e.endMs)}</span>}
                        </Link>
                      </li>
                    );
                  })}
                  {nowTop !== null && (
                    <li aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[2]" style={{ top: nowTop }}>
                      <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-text" />
                      <span className="absolute inset-x-0 top-0 h-0.5 bg-text" />
                    </li>
                  )}
                </ul>
              );
            })}
          </div>
        </div>
      </div>

      {/* Phones: one list per day. */}
      <div className="flex flex-col gap-4 md:hidden">
        {days.map((d) => {
          const dt = DateTime.fromISO(d.date, { zone });
          const isToday = d.date === today;
          return (
            <section key={d.date} aria-label={dt.toFormat("cccc, LLLL d")} className={`rounded-[20px] border px-4 py-3 ${isToday ? "border-white/20 bg-white/[0.04]" : "border-white/[0.07]"}`}>
              <h2 className="flex items-baseline gap-2">
                <Link href={`/planner?date=${d.date}`} className="text-[16px] font-semibold">{dt.toFormat("cccc")}</Link>
                <span className="text-[13px] text-dim">{dt.toFormat("LLL d")}{isToday ? " · today" : ""}</span>
              </h2>
              {d.allDay.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {d.allDay.map((a) => (
                    <li key={a.key} className="rounded-[8px] px-2 py-0.5 text-[12px] font-semibold" style={a.kind === "due" ? { border: "1px solid color-mix(in srgb, var(--due) 60%, transparent)", color: "var(--due)" } : { background: `color-mix(in srgb, ${a.color} 22%, transparent)` }}>{a.label}</li>
                  ))}
                </ul>
              )}
              {d.entries.length === 0 ? (
                <p className="mt-1 text-[14px] text-dim">Nothing planned.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {d.entries.map((e) => (
                    <li key={`${e.kind}${e.id}${e.startMs}`} className="flex items-center gap-3 text-[14px]">
                      <span className="w-12 shrink-0 tabular-nums text-dim">{fmt(e.startMs)}</span>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={e.look === "fixed" ? { background: e.color } : { border: `1.5px ${e.look === "routine" ? "dashed" : "solid"} ${e.color}` }} aria-hidden="true" />
                      <span className={`flex-1 truncate ${e.block?.status === "done" ? "text-dim line-through" : ""}`}>{e.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
