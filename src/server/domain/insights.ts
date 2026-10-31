import "server-only";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, PlanBlock, Routine, Task } from "@/lib/types";
import { blockCategory, describeDisruptions } from "@/lib/outcomes";
import { scheduleDay } from "@/server/planner/scheduler";

// Strict-but-fair accountability computed only from recorded events.
// Every function takes an explicit userId and filters by it, because the
// scheduled job calls these with the service-role client (no RLS).

export type DayReview = {
  date: string;
  planned: number;
  done: number;
  partial: number;
  rest: number;
  interrupted: number;
  skippedMissingInfo: number;
  /** Blocks not finished because the work took longer than estimated (a planning problem, not avoidance). */
  overran: number;
  avoided: number;
  missed: number;
  unmarked: number;
  focusMinutes: number;
  tasksCompleted: number;
  /** done + ½·partial over blocks that counted (rest, interruptions, missing info, overruns excluded). null if nothing counted. */
  completionRate: number | null;
  explanation: string;
  findings: string[];
  carryOver: { id: string; title: string }[];
  /** "My plan broke" reports that day, by category. */
  disruptions: Record<string, number>;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function countDisruptions(rows: { category: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.category ?? "other"] = (out[r.category ?? "other"] ?? 0) + 1;
  return out;
}

const minutesOf = (b: Pick<PlanBlock, "starts_at" | "ends_at">) => Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000);

export async function dayReview(db: SupabaseClient, userId: string, zone: string, date: string): Promise<DayReview> {
  const start = DateTime.fromISO(date, { zone }).startOf("day");
  const end = start.endOf("day");
  const [blocksRes, focusRes, doneRes, openRes, disRes] = await Promise.all([
    db.from("plan_blocks").select("*").eq("user_id", userId).eq("plan_date", date),
    db.from("focus_sessions").select("actual_minutes").eq("user_id", userId).gte("started_at", start.toISO()!).lte("started_at", end.toISO()!),
    db.from("tasks").select("id,title").eq("user_id", userId).eq("status", "done").gte("completed_at", start.toISO()!).lte("completed_at", end.toISO()!),
    db.from("tasks").select("id,title,due_at,due_is_hard").eq("user_id", userId).in("status", ["todo", "in_progress", "blocked"]).lte("due_at", end.toISO()!),
    db.from("plan_disruptions").select("category").eq("user_id", userId).gte("occurred_at", start.toISO()!).lte("occurred_at", end.toISO()!),
  ]);
  const blocks = (blocksRes.data ?? []) as PlanBlock[];
  const counts = { done: 0, partial: 0, rest: 0, interrupted: 0, missing_info: 0, estimate: 0, avoided: 0, missed: 0, unmarked: 0 };
  for (const b of blocks) counts[blockCategory(b)]++;
  const counted = counts.done + counts.partial + counts.avoided + counts.missed + counts.unmarked;
  const completionRate = counted > 0 ? (counts.done + counts.partial * 0.5) / counted : null;
  const focusMinutes = (focusRes.data ?? []).reduce((s, f) => s + (f.actual_minutes ?? 0), 0);
  const disruptions = countDisruptions(disRes.data ?? []);

  const excluded = counts.rest + counts.interrupted + counts.missing_info + counts.estimate;
  const explanation =
    blocks.length === 0
      ? "Nothing was planned, so there's no completion rating today."
      : completionRate === null
        ? `All ${blocks.length} planned blocks were rest, interruptions, blocked on missing information or ran over their estimate, so they aren't counted against you.`
        : `${counts.done} done and ${counts.partial} partly done out of ${counted} counted blocks (partial = half credit) = ${Math.round(completionRate * 100)}%.` +
          (excluded ? ` ${plural(excluded, "block")} excluded (rest, interruptions, missing info, took longer than estimated).` : "") +
          (counts.unmarked ? ` ${counts.unmarked} ${counts.unmarked === 1 ? "wasn't marked; mark it" : "weren't marked; mark them"} to make this accurate.` : "");

  const findings: string[] = [];
  if (counts.avoided > 0) findings.push(`You skipped ${plural(counts.avoided, "block")} without an outside reason. Was the plan unrealistic, or is something about that work hard to start?`);
  const overdue = (openRes.data ?? []).filter((t) => t.due_at && t.due_at < DateTime.now().toISO()!);
  if (overdue.length) findings.push(`${overdue.length} task${overdue.length === 1 ? " is" : "s are"} past due: ${overdue.slice(0, 3).map((t) => `“${t.title}”`).join(", ")}${overdue.some((t) => t.due_is_hard) ? " (including a hard deadline)" : ""}.`);
  if (counts.interrupted >= 2) findings.push(`${counts.interrupted} interruptions today. If that's a pattern, Navi can leave more buffer.`);
  if (counts.missing_info > 0) findings.push(`${counts.missing_info} block${counts.missing_info === 1 ? " was" : "s were"} blocked on missing information. Who can you ask, and when?`);
  if (counts.estimate > 0) findings.push(`${counts.estimate} block${counts.estimate === 1 ? "" : "s"} didn't get done because work took longer than estimated. That's a planning problem, not a failure: give that work more time next time.`);
  const disruptionCount = Object.values(disruptions).reduce((s, n) => s + n, 0);
  if (disruptionCount) findings.push(`Your plan broke ${disruptionCount === 1 ? "once" : `${disruptionCount} times`} today (${describeDisruptions(disruptions)}).`);

  return {
    date,
    planned: blocks.length,
    done: counts.done,
    partial: counts.partial,
    rest: counts.rest,
    interrupted: counts.interrupted,
    skippedMissingInfo: counts.missing_info,
    overran: counts.estimate,
    avoided: counts.avoided,
    missed: counts.missed,
    unmarked: counts.unmarked,
    focusMinutes,
    tasksCompleted: (doneRes.data ?? []).length,
    completionRate,
    explanation,
    findings,
    carryOver: blocks.filter((b) => b.task_id && b.status !== "done").map((b) => ({ id: b.task_id!, title: b.title })),
    disruptions,
  };
}

export type PartOfDay = "morning" | "afternoon" | "evening" | "night";
export const PART_OF_DAY_HOURS: Record<PartOfDay, string> = { morning: "5 AM–noon", afternoon: "noon–5 PM", evening: "5–10 PM", night: "10 PM–5 AM" };
export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export type WeekInsights = {
  start: string;
  end: string;
  days: DayReview[];
  avgCompletion: number | null;
  focusMinutes: number;
  tasksCompleted: number;
  estimate: { samples: number; medianRatio: number | null };
  /** Tasks skipped 3+ times without an outside reason in the last 3 weeks. */
  repeatedlyAvoided: { task_id: string; title: string; times: number }[];
  /** Interrupted blocks in the last 3 weeks by local part of day (only parts with any). */
  interruptionsByPart: { part: PartOfDay; count: number }[];
  lateCompletions: number;
  /** Blocks this week that ran over their estimate. */
  overran: number;
  /** "My plan broke" reports this week, by category. */
  disruptions: Record<string, number>;
  /** Minutes in plan blocks this week: all planned, marked done, marked partly done; plus measured focus time. */
  minutes: { planned: number; done: number; partial: number; focus: number };
  /** Tasks finished this week per project and goal, with what's still open. */
  progress: { kind: "project" | "goal"; id: string; name: string; completed: number; open: number }[];
  /** The 7 days after `end`: deadlines, work due vs free time. */
  nextWeek: {
    from: string;
    to: string;
    deadlines: { id: string; title: string; due_at: string; due_is_hard: boolean }[];
    /** Remaining estimated minutes of open work due by the end of next week (overdue included). */
    loadMinutes: number;
    /** Tasks in that load without an estimate (30 min assumed each). */
    unestimated: number;
    /** Free minutes in declared availability after fixed commitments. */
    freeMinutes: number;
    overloaded: boolean;
  };
  findings: string[];
  enoughData: boolean;
};

export const MIN_ESTIMATE_SAMPLES = 5;
export const AVOIDED_TIMES = 3;
export const INTERRUPTIONS_AT_TIME = 3;
export const ENOUGH_DAYS = 3;
export const ENOUGH_BLOCKS = 6;

function median(sorted: number[]) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const hours = (m: number) => (m >= 120 ? `${Math.round(m / 6) / 10} h` : `${m} min`);

/** Week trends. Patterns are reported only with enough evidence. */
export async function weekInsights(db: SupabaseClient, userId: string, zone: string, endDate: string, now = DateTime.now()): Promise<WeekInsights> {
  const end = DateTime.fromISO(endDate, { zone });
  const start = end.minus({ days: 6 });
  const days: DayReview[] = [];
  for (let i = 0; i < 7; i++) days.push(await dayReview(db, userId, zone, start.plus({ days: i }).toISODate()!));
  const rated = days.filter((d) => d.completionRate !== null);
  const avgCompletion = rated.length ? rated.reduce((s, d) => s + d.completionRate!, 0) / rated.length : null;

  const weekStart = start.startOf("day").toISO()!;
  const weekEnd = end.endOf("day").toISO()!;
  const nextFrom = end.plus({ days: 1 }).startOf("day");
  const nextTo = end.plus({ days: 7 }).endOf("day");
  const [blocksRes, doneRes, disRes, openRes, projRes, goalRes, profRes, evRes, roRes, nextFixedRes] = await Promise.all([
    db.from("plan_blocks").select("task_id,title,status,outcome_reason,starts_at,ends_at,plan_date").eq("user_id", userId).gte("plan_date", start.minus({ days: 14 }).toISODate()!).lte("plan_date", end.toISODate()!),
    db.from("tasks").select("id,estimate_minutes,actual_minutes,due_at,completed_at,project_id,goal_id").eq("user_id", userId).eq("status", "done").gte("completed_at", weekStart).lte("completed_at", weekEnd),
    db.from("plan_disruptions").select("category").eq("user_id", userId).gte("occurred_at", weekStart).lte("occurred_at", weekEnd),
    db.from("tasks").select("id,title,due_at,due_is_hard,estimate_minutes,actual_minutes,project_id,goal_id,status").eq("user_id", userId).in("status", ["todo", "in_progress", "blocked"]),
    db.from("projects").select("id,name,status").eq("user_id", userId),
    db.from("goals").select("id,title,status").eq("user_id", userId),
    db.from("profiles").select("availability").eq("id", userId).maybeSingle(),
    db.from("events").select("*").eq("user_id", userId).neq("status", "cancelled"),
    db.from("routines").select("*").eq("user_id", userId).eq("active", true),
    db.from("plan_blocks").select("starts_at,ends_at,task_id,routine_id,status,title,plan_date").eq("user_id", userId).eq("is_flexible", false).gte("plan_date", nextFrom.toISODate()!).lte("plan_date", nextTo.toISODate()!),
  ]);

  // Patterns over the last 3 weeks of blocks.
  type B = Pick<PlanBlock, "task_id" | "title" | "status" | "outcome_reason" | "starts_at" | "ends_at" | "plan_date">;
  const window = (blocksRes.data ?? []) as B[];
  const avoidCount = new Map<string, { task_id: string; title: string; times: number }>();
  const byPart = new Map<PartOfDay, number>();
  for (const b of window) {
    const cat = blockCategory(b);
    if (cat === "interrupted") {
      const p = partOfDay(DateTime.fromISO(b.starts_at).setZone(zone).hour);
      byPart.set(p, (byPart.get(p) ?? 0) + 1);
    }
    if (!b.task_id || cat !== "avoided") continue;
    const e = avoidCount.get(b.task_id) ?? { task_id: b.task_id, title: b.title, times: 0 };
    e.times++;
    avoidCount.set(b.task_id, e);
  }
  const repeatedlyAvoided = [...avoidCount.values()].filter((e) => e.times >= AVOIDED_TIMES).sort((a, b) => b.times - a.times);
  const interruptionsByPart = [...byPart.entries()].map(([part, count]) => ({ part, count })).sort((a, b) => b.count - a.count);

  const done = (doneRes.data ?? []) as Pick<Task, "id" | "estimate_minutes" | "actual_minutes" | "due_at" | "completed_at" | "project_id" | "goal_id">[];
  const ratios = done.filter((t) => t.estimate_minutes && t.actual_minutes > 0).map((t) => t.actual_minutes / t.estimate_minutes!).sort((a, b) => a - b);
  const medianRatio = ratios.length >= MIN_ESTIMATE_SAMPLES ? median(ratios) : null;
  const lateCompletions = done.filter((t) => t.due_at && t.completed_at && t.completed_at > t.due_at).length;
  const plannedTotal = days.reduce((s, d) => s + d.planned, 0);
  const enoughData = rated.length >= ENOUGH_DAYS && plannedTotal >= ENOUGH_BLOCKS;

  // This week's blocks: planned vs what was marked done.
  const thisWeek = window.filter((b) => b.plan_date >= start.toISODate()! && b.plan_date <= end.toISODate()!);
  const minutes = {
    planned: thisWeek.reduce((s, b) => s + minutesOf(b), 0),
    done: thisWeek.filter((b) => b.status === "done").reduce((s, b) => s + minutesOf(b), 0),
    partial: thisWeek.filter((b) => b.status === "partial").reduce((s, b) => s + minutesOf(b), 0),
    focus: days.reduce((s, d) => s + d.focusMinutes, 0),
  };
  const overran = days.reduce((s, d) => s + d.overran, 0);
  const disruptions = countDisruptions(disRes.data ?? []);

  // Progress per project / goal.
  const open = (openRes.data ?? []) as Pick<Task, "id" | "title" | "due_at" | "due_is_hard" | "estimate_minutes" | "actual_minutes" | "project_id" | "goal_id" | "status">[];
  const progress: WeekInsights["progress"] = [];
  for (const p of (projRes.data ?? []) as { id: string; name: string; status: string }[]) {
    const completed = done.filter((t) => t.project_id === p.id).length;
    const openN = open.filter((t) => t.project_id === p.id).length;
    if (completed || (openN && p.status === "active")) progress.push({ kind: "project", id: p.id, name: p.name, completed, open: openN });
  }
  for (const g of (goalRes.data ?? []) as { id: string; title: string; status: string }[]) {
    const completed = done.filter((t) => t.goal_id === g.id).length;
    const openN = open.filter((t) => t.goal_id === g.id).length;
    if (completed || (openN && g.status === "active")) progress.push({ kind: "goal", id: g.id, name: g.title, completed, open: openN });
  }
  progress.sort((a, b) => b.completed - a.completed || b.open - a.open);

  // Next week: deadlines, and work due vs free time (deterministic, same rules as the planner).
  const deadlines = open
    .filter((t) => t.due_at && t.due_at >= nextFrom.toISO()! && t.due_at <= nextTo.toISO()!)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!))
    .map((t) => ({ id: t.id, title: t.title, due_at: t.due_at!, due_is_hard: t.due_is_hard }));
  const dueByEnd = open.filter((t) => t.status !== "blocked" && t.due_at && t.due_at <= nextTo.toISO()!);
  const loadMinutes = dueByEnd.reduce((s, t) => s + Math.max(0, (t.estimate_minutes ?? 30) - (t.actual_minutes ?? 0)), 0);
  const unestimated = dueByEnd.filter((t) => !t.estimate_minutes).length;
  const availability = (profRes.data?.availability ?? []) as Parameters<typeof scheduleDay>[0]["availability"];
  const nextFixed = (nextFixedRes.data ?? []) as (Pick<PlanBlock, "starts_at" | "ends_at" | "task_id" | "routine_id" | "status" | "title"> & { plan_date: string })[];
  let freeMinutes = 0;
  for (let i = 0; i < 7; i++) {
    const d = nextFrom.plus({ days: i }).toISODate()!;
    freeMinutes += scheduleDay({
      date: d,
      zone,
      now,
      availability,
      events: (evRes.data ?? []) as CalendarEvent[],
      routines: (roRes.data ?? []) as Routine[],
      tasks: [],
      keptBlocks: nextFixed.filter((b) => b.plan_date === d),
    }).freeMinutes;
  }
  const nextWeek = { from: nextFrom.toISODate()!, to: nextTo.toISODate()!, deadlines, loadMinutes, unestimated, freeMinutes, overloaded: loadMinutes > freeMinutes };

  const findings: string[] = [];
  if (!enoughData) findings.push("Not enough recorded days yet for trends. Keep marking blocks done/skipped and Navi will show patterns once there's real evidence.");
  else {
    if (avgCompletion !== null) findings.push(`Average completion of counted blocks: ${Math.round(avgCompletion * 100)}% across ${rated.length} days.`);
    const best = [...rated].sort((a, b) => b.completionRate! - a.completionRate!)[0];
    const worst = [...rated].sort((a, b) => a.completionRate! - b.completionRate!)[0];
    if (best && worst && best.date !== worst.date) findings.push(`Strongest day: ${DateTime.fromISO(best.date).toFormat("cccc")} (${Math.round(best.completionRate! * 100)}%). Weakest: ${DateTime.fromISO(worst.date).toFormat("cccc")} (${Math.round(worst.completionRate! * 100)}%).`);
    for (const ip of interruptionsByPart.filter((x) => x.count >= INTERRUPTIONS_AT_TIME).slice(0, 1)) {
      findings.push(`Interruptions cluster in the ${ip.part} (${PART_OF_DAY_HOURS[ip.part]}): ${ip.count} interrupted blocks in 3 weeks. Plan lighter or more buffer then.`);
    }
  }
  for (const r of repeatedlyAvoided.slice(0, 3)) findings.push(`“${r.title}” has been skipped ${r.times} times without an outside reason. Break it into a smaller first step, change when it's scheduled, or decide to drop it.`);
  if (medianRatio !== null && medianRatio > 1.25) findings.push(`Tasks take about ${medianRatio.toFixed(1)}× your estimates (${ratios.length} tasks). Navi pads future plans to match.`);
  if (medianRatio !== null && medianRatio < 0.8) findings.push(`You finish tasks faster than estimated (about ${medianRatio.toFixed(1)}×, ${ratios.length} tasks).`);
  if (lateCompletions > 0) findings.push(`${lateCompletions} task${lateCompletions === 1 ? " was" : "s were"} finished after the deadline this week.`);
  if (overran >= 3) findings.push(`${overran} blocks this week didn't get done because the work took longer than estimated. The plan was unrealistic: give that work bigger estimates or plan fewer blocks a day.`);
  const disruptionCount = Object.values(disruptions).reduce((s, n) => s + n, 0);
  if (disruptionCount) findings.push(`Your plan broke ${disruptionCount === 1 ? "once" : `${disruptionCount} times`} this week (${describeDisruptions(disruptions)}).`);
  if (minutes.planned) findings.push(`Planned ${hours(minutes.planned)} of work blocks; blocks marked done cover ${hours(minutes.done)}${minutes.partial ? ` (+${hours(minutes.partial)} partly done)` : ""}; ${hours(minutes.focus)} measured in focus sessions.`);
  const stalled = progress.filter((p) => p.completed === 0 && p.open > 0);
  if (stalled.length) findings.push(`No tasks finished this week for ${stalled.slice(0, 3).map((p) => `“${p.name}”`).join(", ")} (${stalled.slice(0, 3).map((p) => `${p.open} open`).join(", ")}).`);
  if (deadlines.length || loadMinutes) {
    const hard = deadlines.filter((d) => d.due_is_hard).length;
    findings.push(
      `Next 7 days: ${plural(deadlines.length, "deadline")}${hard ? ` (${hard} hard)` : ""}; work due needs about ${hours(loadMinutes)}${unestimated ? ` (${unestimated} without an estimate, 30 min assumed)` : ""} and you have about ${hours(freeMinutes)} free after fixed commitments.` +
        (nextWeek.overloaded ? " That's more than your free time: drop, defer or renegotiate something now rather than at the deadline." : ""),
    );
  }

  return {
    start: start.toISODate()!,
    end: end.toISODate()!,
    days,
    avgCompletion,
    focusMinutes: minutes.focus,
    tasksCompleted: days.reduce((s, d) => s + d.tasksCompleted, 0),
    estimate: { samples: ratios.length, medianRatio },
    repeatedlyAvoided,
    interruptionsByPart,
    lateCompletions,
    overran,
    disruptions,
    minutes,
    progress,
    nextWeek,
    findings,
    enoughData,
  };
}
