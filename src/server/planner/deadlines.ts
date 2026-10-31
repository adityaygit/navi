import "server-only";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanBlock, Task } from "@/lib/types";
import { learnedEstimateRatio } from "@/server/planner/scheduler";

// Deterministic deadline check for briefings: open work due in the next few
// days whose remaining estimate is more than the time planned for it before
// the deadline. Estimates are scaled by the person's own track record, the
// same way the planner does (learnedEstimateRatio). Takes an explicit userId (the scheduled job uses the service
// role client).

export type DeadlineRisk = {
  task_id: string;
  title: string;
  due_at: string;
  due_is_hard: boolean;
  /** Estimated minutes still needed (30 assumed without an estimate), scaled by estimateRatio. */
  needMinutes: number;
  /** Learned actual/estimate ratio applied (1 until 5 finished tasks have both). */
  estimateRatio: number;
  /** Minutes in planned blocks between now and the deadline. */
  plannedMinutes: number;
  /** needMinutes − plannedMinutes. */
  shortMinutes: number;
};

const DEFAULT_ESTIMATE = 30;

export async function deadlineRisks(db: SupabaseClient, userId: string, zone: string, now: DateTime, days = 3): Promise<DeadlineRisk[]> {
  const horizon = now.setZone(zone).plus({ days }).endOf("day");
  const { data: tasks } = await db
    .from("tasks")
    .select("id,title,due_at,due_is_hard,estimate_minutes,actual_minutes")
    .eq("user_id", userId)
    .in("status", ["todo", "in_progress"])
    .gt("due_at", now.toISO()!)
    .lte("due_at", horizon.toISO()!)
    .order("due_at");
  const list = (tasks ?? []) as Pick<Task, "id" | "title" | "due_at" | "due_is_hard" | "estimate_minutes" | "actual_minutes">[];
  if (!list.length) return [];
  const [{ data: blocks }, { data: done }] = await Promise.all([
    db.from("plan_blocks").select("task_id,starts_at,ends_at,status").eq("user_id", userId).in("task_id", list.map((t) => t.id)),
    db.from("tasks").select("estimate_minutes,actual_minutes").eq("user_id", userId).eq("status", "done").not("estimate_minutes", "is", null).gt("actual_minutes", 0).order("completed_at", { ascending: false }).limit(40),
  ]);
  const { ratio } = learnedEstimateRatio((done ?? []) as Pick<Task, "estimate_minutes" | "actual_minutes">[]);
  const rows = (blocks ?? []) as Pick<PlanBlock, "task_id" | "starts_at" | "ends_at" | "status">[];
  const nowMs = now.toMillis();
  const out: DeadlineRisk[] = [];
  for (const t of list) {
    const due = Date.parse(t.due_at!);
    const mine = rows.filter((b) => b.task_id === t.id);
    // Blocks marked done without a timed focus session still count as work done.
    const worked = t.actual_minutes > 0 ? 0 : mine.filter((b) => b.status === "done" || b.status === "partial").reduce((s, b) => s + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000 / (b.status === "partial" ? 2 : 1), 0);
    const needMinutes = Math.max(0, Math.round((t.estimate_minutes ?? DEFAULT_ESTIMATE) * ratio - t.actual_minutes - worked));
    const plannedMinutes = Math.round(
      mine
        .filter((b) => b.status === "planned" || b.status === "in_progress")
        .reduce((s, b) => s + Math.max(0, Math.min(Date.parse(b.ends_at), due) - Math.max(Date.parse(b.starts_at), nowMs)) / 60000, 0),
    );
    const short = needMinutes - plannedMinutes;
    if (short >= 5) out.push({ task_id: t.id, title: t.title, due_at: t.due_at!, due_is_hard: t.due_is_hard, needMinutes, estimateRatio: ratio, plannedMinutes, shortMinutes: short });
  }
  return out;
}
