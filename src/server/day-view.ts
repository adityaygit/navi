import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "./context";
import type { PlanBlock, Task } from "@/lib/types";
import { freeGaps, mergeSpans, type Span } from "@/lib/sentences";
import { spaceColor } from "@/lib/space-color";
import type { DayData, DayItem, loadSources } from "./day";

// How My day reads the day's rows, shared by the web page (/planner) and the
// phone app (/api/m/day, /api/m/week): what looks fixed, flexible or like a
// routine, what colour it is, what counts as planned time, and the free
// stretches still ahead.

export type Look = "fixed" | "flex" | "routine";
export type LookedItem = DayItem & { look: Look; color: string; spaceName: string | null; space: { id: string; name: string; color: string } | null; block: PlanBlock | null };

const NAVI = "#A7EBC0";
const ROUTINE = "#6E6E77";
const FIXED = "#C8C8CE";

type Sources = Awaited<ReturnType<typeof loadSources>>;

/** A function that dresses a day item for display: its look, colour, space and plan block. */
export function itemLooks(src: Sources): (i: DayItem) => LookedItem {
  const blockById = new Map(src.blocks.map((b) => [b.id, b]));
  const routineFixed = new Map(src.routines.map((r) => [r.id, r.is_fixed]));
  return (i) => {
    const block: PlanBlock | null = i.kind === "block" ? (blockById.get(i.id) ?? null) : null;
    const look: Look =
      i.kind === "event" ? "fixed"
      : i.kind === "routine" ? (routineFixed.get(i.id) ? "fixed" : "routine")
      : block?.routine_id ? (routineFixed.get(block.routine_id) ? "fixed" : "routine")
      : block && !block.is_flexible ? "fixed"
      : "flex";
    const s = i.spaceId ? src.spaces.get(i.spaceId) : undefined;
    const space = s ? { id: s.id, name: s.name, color: spaceColor(s) } : null;
    return { ...i, look, block, color: space ? space.color : look === "routine" ? ROUTINE : look === "flex" ? NAVI : FIXED, spaceName: space?.name ?? null, space };
  };
}

/** What counts as "planned" in the headlines: events and plan blocks (V4 sources contract). */
export function plannedSpans(items: DayItem[]): Span[] {
  return items.filter((i) => i.kind !== "routine").map((i) => ({ start: i.startMs, end: i.endMs }));
}

/**
 * Free stretches still ahead on a date (the whole day for a future day,
 * nothing for a past one), between everything on the line. With planner v2,
 * only in the free time the planner itself uses; otherwise within the awake
 * window (7 AM–11 PM when wake/bed aren't known).
 */
export function freeStretches(opts: {
  date: string;
  zone: string;
  nowMs: number;
  isToday: boolean;
  isPast: boolean;
  awake: Span | null;
  busy: Span[];
  capacity: Span[] | null;
}): Span[] {
  if (opts.isPast) return [];
  const windowStart = opts.awake?.start ?? DateTime.fromISO(`${opts.date}T07:00`, { zone: opts.zone }).toMillis();
  const windowEnd = opts.awake?.end ?? DateTime.fromISO(`${opts.date}T23:00`, { zone: opts.zone }).toMillis();
  const from = opts.isToday ? Math.max(windowStart, roundUp5(opts.nowMs)) : windowStart;
  return opts.capacity ? opts.capacity.flatMap((c) => freeGaps(opts.busy, Math.max(c.start, from), c.end)) : freeGaps(opts.busy, from, windowEnd);
}

/** Now, rounded up to the next 5 minutes (where free time starts today). */
export function roundUp5(ms: number): number {
  return Math.ceil(ms / (5 * 60000)) * 5 * 60000;
}

/** An all-day-ish event (20 hours or more): shown above the grid, not counted as planned time. */
export function isLongEvent(i: DayItem): boolean {
  return i.kind === "event" && i.endMs - i.startMs >= 20 * 3600000;
}

/** Each day of a week as the week headline counts it: planned minutes (overlaps once), titles, routines. */
export function weekSummary(days: DayData[], zone: string): { date: string; name: string; minutes: number; titles: string[]; routines: number }[] {
  return days.map((dd) => {
    const items = dd.items.filter((i) => i.kind !== "routine" && !isLongEvent(i));
    const minutes = mergeSpans(plannedSpans(items)).reduce((t, s) => t + (s.end - s.start) / 60000, 0);
    return { date: dd.date, name: DateTime.fromISO(dd.date, { zone }).toFormat("cccc"), minutes, titles: items.map((i) => i.title), routines: dd.items.filter((i) => i.kind === "routine").length };
  });
}

export type OpenTask = Pick<Task, "id" | "title" | "status" | "due_at" | "due_is_hard" | "estimate_minutes" | "workspace_id" | "created_at">;

/**
 * Open top-level tasks (soonest due first), which of them already have a
 * planned time from `today` on, and how many open steps each has.
 */
export async function loadOpenWork(ctx: Ctx, today: string): Promise<{ openTasks: OpenTask[]; scheduled: Set<string>; steps: Map<string, number> }> {
  const [openTasksRes, scheduledRes, stepsRes] = await Promise.all([
    ctx.db
      .from("tasks")
      .select("id,title,status,due_at,due_is_hard,estimate_minutes,workspace_id,created_at")
      .is("parent_task_id", null)
      .in("status", ["todo", "in_progress", "blocked"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
    ctx.db.from("plan_blocks").select("task_id").gte("plan_date", today).in("status", ["planned", "in_progress"]).not("task_id", "is", null),
    ctx.db.from("tasks").select("parent_task_id").not("parent_task_id", "is", null).in("status", ["todo", "in_progress", "blocked"]),
  ]);
  const openTasks = (openTasksRes.data ?? []) as OpenTask[];
  const scheduled = new Set(((scheduledRes.data ?? []) as { task_id: string }[]).map((b) => b.task_id));
  const steps = new Map<string, number>();
  for (const s of (stepsRes.data ?? []) as { parent_task_id: string }[]) steps.set(s.parent_task_id, (steps.get(s.parent_task_id) ?? 0) + 1);
  return { openTasks, scheduled, steps };
}
