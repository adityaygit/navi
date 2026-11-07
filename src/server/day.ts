import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "./context";
import type { CalendarEvent, PlanBlock, Profile, Routine, Task } from "@/lib/types";
import { buildDayAgenda, type AgendaEntry } from "./planner/agenda";
import { atLocalTime } from "@/lib/time";
import type { Span } from "@/lib/sentences";

/**
 * What one or more local days hold, for the Navi 1.5 pages (Home's day bar,
 * My day, the week calendar, setup's first plan). One loader so every page
 * counts the same things: events (weekly ones expanded), timed routines, and
 * plan blocks, each with its space.
 */
export type DayItem = AgendaEntry & { spaceId: string | null; taskId: string | null; startMs: number; endMs: number };

export type DayData = {
  date: string;
  items: DayItem[];
  /** Untimed routines (no start time). */
  untimed: AgendaEntry[];
};

export type Spaces = Map<string, { id: string; name: string; color: string | null }>;

/** Wake-up and bedtime from setup (profiles.preferences), as "HH:MM", if set. */
export function wakeBed(profile: Pick<Profile, "preferences">): { wake: string; bed: string } | null {
  const p = (profile.preferences ?? {}) as Record<string, unknown>;
  const ok = (v: unknown): v is string => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
  return ok(p.wake_time) && ok(p.bed_time) ? { wake: p.wake_time, bed: p.bed_time } : null;
}

/** The awake window for a date, if wake/bed are known (bedtime after midnight rolls over). */
export function awakeSpan(profile: Pick<Profile, "preferences">, date: string, zone: string): Span | null {
  const wb = wakeBed(profile);
  if (!wb) return null;
  const start = atLocalTime(date, wb.wake, zone);
  let end = atLocalTime(date, wb.bed, zone);
  if (end <= start) end = end.plus({ days: 1 });
  return { start: start.toMillis(), end: end.toMillis() };
}

export async function loadSources(ctx: Ctx, from: string, to: string) {
  const zone = ctx.timezone;
  const [events, routines, blocks, spaces] = await Promise.all([
    ctx.db.from("events").select("*").neq("status", "cancelled"),
    ctx.db.from("routines").select("*").eq("active", true),
    ctx.db.from("plan_blocks").select("*").gte("plan_date", from).lte("plan_date", to).order("starts_at"),
    ctx.db.from("workspaces").select("id,name,color"),
  ]);
  for (const r of [events, routines, blocks, spaces]) if (r.error) throw new Error(r.error.message);
  const blockRows = (blocks.data ?? []) as PlanBlock[];
  const taskIds = [...new Set(blockRows.map((b) => b.task_id).filter(Boolean))] as string[];
  const taskSpace = new Map<string, string | null>();
  if (taskIds.length) {
    const { data } = await ctx.db.from("tasks").select("id,workspace_id").in("id", taskIds);
    for (const t of (data ?? []) as Pick<Task, "id" | "workspace_id">[]) taskSpace.set(t.id, t.workspace_id);
  }
  return {
    zone,
    events: (events.data ?? []) as CalendarEvent[],
    routines: (routines.data ?? []) as Routine[],
    blocks: blockRows,
    taskSpace,
    spaces: new Map(((spaces.data ?? []) as { id: string; name: string; color: string | null }[]).map((s) => [s.id, s])) as Spaces,
  };
}

export function dayFrom(src: Awaited<ReturnType<typeof loadSources>>, date: string): DayData {
  const agenda = buildDayAgenda({ date, zone: src.zone, events: src.events, routines: src.routines, blocks: src.blocks, tasks: [] });
  const eventSpace = new Map(src.events.map((e) => [e.id, e.workspace_id]));
  const routineSpace = new Map(src.routines.map((r) => [r.id, r.workspace_id]));
  const blockById = new Map(src.blocks.map((b) => [b.id, b]));
  const items: DayItem[] = [];
  const untimed: AgendaEntry[] = [];
  for (const e of agenda.entries) {
    if (!e.start || !e.end) {
      untimed.push(e);
      continue;
    }
    // Skipped/missed blocks don't take up the day any more.
    if (e.kind === "block" && ["skipped", "missed"].includes(e.status ?? "")) continue;
    const block = e.kind === "block" ? blockById.get(e.id) : undefined;
    const spaceId =
      e.kind === "event" ? (eventSpace.get(e.id) ?? null)
      : e.kind === "routine" ? (routineSpace.get(e.id) ?? null)
      : block?.task_id ? (src.taskSpace.get(block.task_id) ?? null)
      : block?.routine_id ? (routineSpace.get(block.routine_id) ?? null)
      : null;
    items.push({ ...e, spaceId, taskId: block?.task_id ?? null, startMs: Date.parse(e.start), endMs: Date.parse(e.end) });
  }
  items.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return { date, items, untimed };
}

export async function loadDay(ctx: Ctx, date: string): Promise<DayData & { spaces: Spaces }> {
  const src = await loadSources(ctx, date, date);
  return { ...dayFrom(src, date), spaces: src.spaces };
}

/** Local helpers in a zone, for the sentence builders. */
export function zoneHelpers(zone: string) {
  return {
    fmtHour: (ms: number) => {
      const d = DateTime.fromMillis(ms, { zone });
      const h = d.hour % 12 || 12;
      return d.minute ? `${h}:${String(d.minute).padStart(2, "0")}` : `${h}`;
    },
    minuteOfDay: (ms: number) => {
      const d = DateTime.fromMillis(ms, { zone });
      return d.hour * 60 + d.minute;
    },
    hourOf: (ms: number) => DateTime.fromMillis(ms, { zone }).hour,
    sameDay: (a: number, b: number) => DateTime.fromMillis(a, { zone }).hasSame(DateTime.fromMillis(b, { zone }), "day"),
    yesterday: (a: number, b: number) => DateTime.fromMillis(a, { zone }).hasSame(DateTime.fromMillis(b, { zone }).minus({ days: 1 }), "day"),
  };
}
