import "server-only";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanBlock, Task } from "@/lib/types";

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
  avoided: number;
  missed: number;
  unmarked: number;
  focusMinutes: number;
  tasksCompleted: number;
  /** done + ½·partial over blocks that counted (rest/interruptions/missing-info excluded). null if nothing counted. */
  completionRate: number | null;
  explanation: string;
  findings: string[];
  carryOver: { id: string; title: string }[];
};

function blockCategory(b: PlanBlock): "done" | "partial" | "rest" | "interrupted" | "missing_info" | "avoided" | "missed" | "unmarked" {
  if (b.status === "done") return "done";
  if (b.status === "partial") return "partial";
  if (b.status === "rest") return "rest";
  if (b.status === "interrupted") return "interrupted";
  if (b.status === "skipped") return /missing|blocked/i.test(b.outcome_reason ?? "") ? "missing_info" : "avoided";
  if (b.status === "missed") return "missed";
  return "unmarked";
}

export async function dayReview(db: SupabaseClient, userId: string, zone: string, date: string): Promise<DayReview> {
  const start = DateTime.fromISO(date, { zone }).startOf("day");
  const end = start.endOf("day");
  const [blocksRes, focusRes, doneRes, openRes] = await Promise.all([
    db.from("plan_blocks").select("*").eq("user_id", userId).eq("plan_date", date),
    db.from("focus_sessions").select("actual_minutes").eq("user_id", userId).gte("started_at", start.toISO()!).lte("started_at", end.toISO()!),
    db.from("tasks").select("id,title").eq("user_id", userId).eq("status", "done").gte("completed_at", start.toISO()!).lte("completed_at", end.toISO()!),
    db.from("tasks").select("id,title,due_at,due_is_hard").eq("user_id", userId).in("status", ["todo", "in_progress", "blocked"]).lte("due_at", end.toISO()!),
  ]);
  const blocks = (blocksRes.data ?? []) as PlanBlock[];
  const counts = { done: 0, partial: 0, rest: 0, interrupted: 0, missing_info: 0, avoided: 0, missed: 0, unmarked: 0 };
  for (const b of blocks) counts[blockCategory(b)]++;
  const counted = counts.done + counts.partial + counts.avoided + counts.missed + counts.unmarked;
  const completionRate = counted > 0 ? (counts.done + counts.partial * 0.5) / counted : null;
  const focusMinutes = (focusRes.data ?? []).reduce((s, f) => s + (f.actual_minutes ?? 0), 0);

  const excluded = counts.rest + counts.interrupted + counts.missing_info;
  const explanation =
    blocks.length === 0
      ? "Nothing was planned, so there's no completion rating today."
      : completionRate === null
        ? `All ${blocks.length} planned blocks were rest, interruptions or blocked on missing information, so they aren't counted against you.`
        : `${counts.done} done and ${counts.partial} partly done out of ${counted} counted blocks (partial = half credit) = ${Math.round(completionRate * 100)}%.` +
          (excluded ? ` ${excluded} block${excluded === 1 ? "" : "s"} excluded (rest, interruptions, missing info).` : "") +
          (counts.unmarked ? ` ${counts.unmarked} ${counts.unmarked === 1 ? "wasn't marked; mark it" : "weren't marked; mark them"} to make this accurate.` : "");

  const findings: string[] = [];
  if (counts.avoided > 0) findings.push(`You skipped ${counts.avoided} block${counts.avoided === 1 ? "" : "s"} without an outside reason. Was the plan unrealistic, or is something about that work hard to start?`);
  const overdue = (openRes.data ?? []).filter((t) => t.due_at && t.due_at < DateTime.now().toISO()!);
  if (overdue.length) findings.push(`${overdue.length} task${overdue.length === 1 ? " is" : "s are"} past due: ${overdue.slice(0, 3).map((t) => `“${t.title}”`).join(", ")}${overdue.some((t) => t.due_is_hard) ? " (including a hard deadline)" : ""}.`);
  if (counts.interrupted >= 2) findings.push(`${counts.interrupted} interruptions today. If that's a pattern, Navi can leave more buffer.`);
  if (counts.missing_info > 0) findings.push(`${counts.missing_info} block${counts.missing_info === 1 ? " was" : "s were"} blocked on missing information. Who can you ask, and when?`);

  return {
    date,
    planned: blocks.length,
    done: counts.done,
    partial: counts.partial,
    rest: counts.rest,
    interrupted: counts.interrupted,
    skippedMissingInfo: counts.missing_info,
    avoided: counts.avoided,
    missed: counts.missed,
    unmarked: counts.unmarked,
    focusMinutes,
    tasksCompleted: (doneRes.data ?? []).length,
    completionRate,
    explanation,
    findings,
    carryOver: blocks.filter((b) => b.task_id && !["done"].includes(b.status)).map((b) => ({ id: b.task_id!, title: b.title })),
  };
}

export type WeekInsights = {
  start: string;
  end: string;
  days: DayReview[];
  avgCompletion: number | null;
  focusMinutes: number;
  tasksCompleted: number;
  estimate: { samples: number; medianRatio: number | null };
  repeatedlyAvoided: { title: string; times: number }[];
  lateCompletions: number;
  findings: string[];
  enoughData: boolean;
};

/** Week trends. Patterns are reported only with enough evidence. */
export async function weekInsights(db: SupabaseClient, userId: string, zone: string, endDate: string): Promise<WeekInsights> {
  const end = DateTime.fromISO(endDate, { zone });
  const start = end.minus({ days: 6 });
  const days: DayReview[] = [];
  for (let i = 0; i < 7; i++) days.push(await dayReview(db, userId, zone, start.plus({ days: i }).toISODate()!));
  const rated = days.filter((d) => d.completionRate !== null);
  const avgCompletion = rated.length ? rated.reduce((s, d) => s + d.completionRate!, 0) / rated.length : null;

  const [blocksRes, doneRes] = await Promise.all([
    db.from("plan_blocks").select("task_id,title,status,outcome_reason").eq("user_id", userId).gte("plan_date", start.minus({ days: 14 }).toISODate()!).lte("plan_date", end.toISODate()!),
    db.from("tasks").select("estimate_minutes,actual_minutes,due_at,completed_at").eq("user_id", userId).eq("status", "done").gte("completed_at", start.startOf("day").toISO()!),
  ]);
  const avoidCount = new Map<string, { title: string; times: number }>();
  for (const b of (blocksRes.data ?? []) as PlanBlock[]) {
    if (!b.task_id || blockCategory(b) !== "avoided") continue;
    const e = avoidCount.get(b.task_id) ?? { title: b.title, times: 0 };
    e.times++;
    avoidCount.set(b.task_id, e);
  }
  const repeatedlyAvoided = [...avoidCount.values()].filter((e) => e.times >= 3).sort((a, b) => b.times - a.times);
  const done = (doneRes.data ?? []) as Pick<Task, "estimate_minutes" | "actual_minutes" | "due_at" | "completed_at">[];
  const ratios = done.filter((t) => t.estimate_minutes && t.actual_minutes > 0).map((t) => t.actual_minutes / t.estimate_minutes!).sort((a, b) => a - b);
  const medianRatio = ratios.length >= 5 ? ratios[Math.floor(ratios.length / 2)] : null;
  const lateCompletions = done.filter((t) => t.due_at && t.completed_at && t.completed_at > t.due_at).length;
  const plannedTotal = days.reduce((s, d) => s + d.planned, 0);
  const enoughData = rated.length >= 3 && plannedTotal >= 6;

  const findings: string[] = [];
  if (!enoughData) findings.push("Not enough recorded days yet for trends. Keep marking blocks done/skipped and Navi will show patterns once there's real evidence.");
  else {
    if (avgCompletion !== null) findings.push(`Average completion of counted blocks: ${Math.round(avgCompletion * 100)}% across ${rated.length} days.`);
    const best = [...rated].sort((a, b) => b.completionRate! - a.completionRate!)[0];
    const worst = [...rated].sort((a, b) => a.completionRate! - b.completionRate!)[0];
    if (best && worst && best.date !== worst.date) findings.push(`Strongest day: ${DateTime.fromISO(best.date).toFormat("cccc")} (${Math.round(best.completionRate! * 100)}%). Weakest: ${DateTime.fromISO(worst.date).toFormat("cccc")} (${Math.round(worst.completionRate! * 100)}%).`);
  }
  for (const r of repeatedlyAvoided.slice(0, 3)) findings.push(`“${r.title}” has been skipped ${r.times} times without an outside reason. Break it into a smaller first step, change when it's scheduled, or decide to drop it.`);
  if (medianRatio !== null && medianRatio > 1.25) findings.push(`Tasks take about ${medianRatio.toFixed(1)}× your estimates (${ratios.length} tasks). Navi pads future plans to match.`);
  if (medianRatio !== null && medianRatio < 0.8) findings.push(`You finish tasks faster than estimated (about ${medianRatio.toFixed(1)}×, ${ratios.length} tasks).`);
  if (lateCompletions > 0) findings.push(`${lateCompletions} task${lateCompletions === 1 ? " was" : "s were"} finished after the deadline this week.`);

  return {
    start: start.toISODate()!,
    end: end.toISODate()!,
    days,
    avgCompletion,
    focusMinutes: days.reduce((s, d) => s + d.focusMinutes, 0),
    tasksCompleted: days.reduce((s, d) => s + d.tasksCompleted, 0),
    estimate: { samples: ratios.length, medianRatio },
    repeatedlyAvoided,
    lateCompletions,
    findings,
    enoughData,
  };
}
