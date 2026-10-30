import { DateTime } from "luxon";
import type { CalendarEvent, PlanBlock, Routine, Task } from "@/lib/types";
import { eventOccurrence } from "./scheduler";
import { atLocalTime, formatTime, weekdayOf } from "@/lib/time";

// What a local day holds: fixed events (weekly ones expanded to that date),
// routines that occur that weekday, planned blocks, and tasks due that day.
// Pure, so the planner UI, Today and the AI's get_plan tool all agree on it.

export type AgendaEntry = {
  kind: "event" | "routine" | "block";
  id: string;
  title: string;
  /** ISO start/end; null for a routine with no set time. */
  start: string | null;
  end: string | null;
  /** True only when the time can't move: an event, a block Navi may not move, or a routine marked is_fixed. */
  fixed: boolean;
  /** Short badge for people: "fixed", "external", "routine", "flexible". */
  label: "fixed" | "external" | "routine" | "flexible";
  status?: PlanBlock["status"];
  recurring?: boolean;
};

export type DayAgenda = {
  date: string;
  entries: AgendaEntry[];
  due: Pick<Task, "id" | "title" | "status" | "priority" | "due_at" | "due_is_hard" | "estimate_minutes">[];
};

export function routineLabel(r: Pick<Routine, "is_fixed">): "fixed" | "routine" {
  return r.is_fixed ? "fixed" : "routine";
}

export function buildDayAgenda(input: {
  date: string;
  zone: string;
  events: CalendarEvent[];
  routines: Routine[];
  blocks: PlanBlock[];
  tasks: Task[];
}): DayAgenda {
  const { date, zone } = input;
  const dow = weekdayOf(date, zone);
  const entries: AgendaEntry[] = [];
  for (const e of input.events) {
    const iv = eventOccurrence(e, date, zone);
    if (!iv) continue;
    entries.push({ kind: "event", id: e.id, title: e.title, start: iv.start!.toISO()!, end: iv.end!.toISO()!, fixed: true, label: e.external_ref ? "external" : "fixed", recurring: Boolean(e.recurrence) });
  }
  const blocks = input.blocks.filter((b) => b.plan_date === date);
  // A routine that already has a block that day is shown as that block.
  const routinesWithBlocks = new Set(blocks.map((b) => b.routine_id).filter(Boolean));
  for (const r of input.routines) {
    if (!r.active || !r.days.includes(dow) || routinesWithBlocks.has(r.id)) continue;
    const s = r.start_time ? atLocalTime(date, r.start_time, zone) : null;
    entries.push({ kind: "routine", id: r.id, title: r.title, start: s?.toISO() ?? null, end: s?.plus({ minutes: r.duration_minutes }).toISO() ?? null, fixed: r.is_fixed, label: routineLabel(r), recurring: true });
  }
  for (const b of blocks) {
    entries.push({ kind: "block", id: b.id, title: b.title, start: b.starts_at, end: b.ends_at, fixed: !b.is_flexible, label: b.is_flexible ? "flexible" : "fixed", status: b.status });
  }
  // By start time (same-zone ISO strings sort correctly); untimed routines last.
  const at = (e: AgendaEntry) => (e.start ? Date.parse(e.start) : Infinity);
  entries.sort((a, b) => at(a) - at(b));
  const due = input.tasks
    .filter((t) => t.due_at && !["done", "cancelled"].includes(t.status) && DateTime.fromISO(t.due_at).setZone(zone).toISODate() === date)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!))
    .map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_at: t.due_at, due_is_hard: t.due_is_hard, estimate_minutes: t.estimate_minutes }));
  return { date, entries, due };
}

/** One readable paragraph per day for the AI (ids in brackets are for tool calls only). */
export function describeDayAgenda(a: DayAgenda, zone: string, today: string): string {
  const dt = DateTime.fromISO(a.date, { zone });
  const rel = a.date === today ? "today" : a.date === DateTime.fromISO(today, { zone }).plus({ days: 1 }).toISODate() ? "tomorrow" : null;
  const head = `${dt.toFormat("cccc, LLL d yyyy")} (${a.date}${rel ? `, ${rel}` : ""})`;
  const time = (e: AgendaEntry) => (e.start ? `${formatTime(e.start, zone)}–${formatTime(e.end!, zone)}` : "any time");
  const what = (e: AgendaEntry) => {
    if (e.kind === "event") return `${e.label === "external" ? "external event" : "fixed event"}${e.recurring ? ", weekly" : ""}`;
    if (e.kind === "routine") return e.fixed ? "routine, fixed time" : e.start ? "routine, preferred time (can move)" : "routine, no set time";
    return `${e.fixed ? "fixed" : "flexible"} plan block, ${e.status}`;
  };
  const lines = a.entries.map((e) => `  - ${time(e)} ${e.title} (${what(e)}) [${e.id}]`);
  const due = a.due.map((t) => `  - ${t.title} (P${t.priority}, ${t.status}, due ${formatTime(t.due_at!, zone)}${t.due_is_hard ? " HARD deadline" : ", soft"}${t.estimate_minutes ? `, ~${t.estimate_minutes}m` : ""}) [${t.id}]`);
  return [
    `${head}:`,
    lines.length ? lines.join("\n") : "  - nothing scheduled (no events, routines or plan blocks)",
    `  Tasks due this day: ${due.length ? `\n${due.join("\n")}` : "none"}`,
  ].join("\n");
}
