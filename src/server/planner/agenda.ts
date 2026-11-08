import { DateTime } from "luxon";
import type { CalendarEvent, OccurrenceOverride, PlanBlock, Routine, Task } from "@/lib/types";
import { eventOccurrence } from "./scheduler";
import { occurrencesOn } from "./day-model";
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
  /** Routines only: how the v2 planner treats it. */
  routine?: Pick<Routine, "protection" | "kind" | "window_start" | "window_end" | "is_fixed" | "start_time">;
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
  /** One-session changes to weekly events (planner v2); none for the old planner. */
  overrides?: OccurrenceOverride[];
}): DayAgenda {
  const { date, zone } = input;
  const dow = weekdayOf(date, zone);
  const entries: AgendaEntry[] = [];
  for (const e of input.events) {
    const ivs = input.overrides?.length ? occurrencesOn(e, date, zone, input.overrides) : [eventOccurrence(e, date, zone)].filter((x): x is NonNullable<typeof x> => !!x);
    for (const iv of ivs) {
      entries.push({ kind: "event", id: e.id, title: e.title, start: iv.start!.toISO()!, end: iv.end!.toISO()!, fixed: true, label: e.external_ref ? "external" : "fixed", recurring: Boolean(e.recurrence) });
    }
  }
  const blocks = input.blocks.filter((b) => b.plan_date === date);
  // A routine that already has a block that day is shown as that block.
  const routinesWithBlocks = new Set(blocks.map((b) => b.routine_id).filter(Boolean));
  for (const r of input.routines) {
    if (!r.active || !r.days.includes(dow) || routinesWithBlocks.has(r.id)) continue;
    const s = r.start_time ? atLocalTime(date, r.start_time, zone) : null;
    entries.push({ kind: "routine", id: r.id, title: r.title, start: s?.toISO() ?? null, end: s?.plus({ minutes: r.duration_minutes }).toISO() ?? null, fixed: r.is_fixed, label: routineLabel(r), recurring: true, routine: { protection: r.protection ?? null, kind: r.kind ?? null, window_start: r.window_start ?? null, window_end: r.window_end ?? null, is_fixed: r.is_fixed, start_time: r.start_time } });
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
/**
 * How the v2 planner treats a routine, in words for the AI (B3: the text says
 * exactly what the planner does, nothing more).
 */
export function routineRule(r: NonNullable<AgendaEntry["routine"]>): string {
  const p = r.protection ?? (r.is_fixed ? "fixed" : r.start_time ? "protected" : "flexible");
  if (p === "fixed") return "fixed routine, never moved";
  if (p === "flexible") return r.start_time ? "flexible routine, preferred time, can move" : "flexible routine, fits where there's room";
  if (r.window_start && r.window_end) return `protected routine, may shift between ${r.window_start.slice(0, 5)} and ${r.window_end.slice(0, 5)}`;
  if (!r.start_time) return "protected routine, kept every day it's on, any time";
  if (r.kind === "meal") return "protected meal, may shift up to 30 min";
  if (r.kind === "exercise" || r.kind === "recovery") return "protected routine, may move within the day, never dropped without asking";
  if (r.kind === "sleep") return "sleep, never moved";
  return "protected routine, stays at its time";
}

export function describeDayAgenda(a: DayAgenda, zone: string, today: string, opts: { v2?: boolean } = {}): string {
  const dt = DateTime.fromISO(a.date, { zone });
  const rel = a.date === today ? "today" : a.date === DateTime.fromISO(today, { zone }).plus({ days: 1 }).toISODate() ? "tomorrow" : null;
  const head = `${dt.toFormat("cccc, LLL d yyyy")} (${a.date}${rel ? `, ${rel}` : ""})`;
  const time = (e: AgendaEntry) => (e.start ? `${formatTime(e.start, zone)}–${formatTime(e.end!, zone)}` : "any time");
  const what = (e: AgendaEntry) => {
    if (e.kind === "event") return `${e.label === "external" ? "external event" : "fixed event"}${e.recurring ? ", weekly" : ""}`;
    if (e.kind === "routine" && opts.v2 && e.routine) return routineRule(e.routine);
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
