import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import type { CalendarEvent, PlanBlock, Routine, Task } from "@/lib/types";
import { learnedEstimateRatio, scheduleDay, type SchedulerOutput } from "./scheduler";
import { logActivity } from "@/server/domain/activity";
import { nowIn } from "@/lib/time";

// Persists the deterministic schedule. Navi may freely rearrange flexible
// blocks it created; it never touches fixed blocks, user-created blocks, or
// anything already started/finished, and never marks work as done.

const KEEP_STATUSES = ["in_progress", "done", "partial", "skipped", "missed", "rest", "interrupted"];

async function loadInputs(ctx: Ctx) {
  const [tasks, events, routines, done] = await Promise.all([
    ctx.db.from("tasks").select("*").eq("user_id", ctx.userId).in("status", ["todo", "in_progress"]),
    ctx.db.from("events").select("*").eq("user_id", ctx.userId).neq("status", "cancelled"),
    ctx.db.from("routines").select("*").eq("user_id", ctx.userId).eq("active", true),
    ctx.db.from("tasks").select("estimate_minutes,actual_minutes").eq("user_id", ctx.userId).eq("status", "done").not("estimate_minutes", "is", null).gt("actual_minutes", 0).order("completed_at", { ascending: false }).limit(40),
  ]);
  return {
    tasks: (tasks.data ?? []) as Task[],
    events: (events.data ?? []) as CalendarEvent[],
    routines: (routines.data ?? []) as Routine[],
    estimate: learnedEstimateRatio((done.data ?? []) as Task[]),
  };
}

export type PlanResult = SchedulerOutput & { date: string; moved: number; estimateSamples: number; estimateRatio: number };

/** (Re)generate the flexible plan for one local date. */
export async function generateDayPlan(ctx: Ctx, date?: string, opts: { from?: DateTime; reasonPrefix?: string } = {}): Promise<PlanResult> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const day = date ?? nowIn(zone).toISODate()!;
  const { tasks, events, routines, estimate } = await loadInputs(ctx);

  const { data: existing } = await ctx.db.from("plan_blocks").select("*").eq("user_id", ctx.userId).eq("plan_date", day);
  const existingBlocks = (existing ?? []) as PlanBlock[];
  const kept = existingBlocks.filter((b) => !b.is_flexible || b.created_by === "user" || KEEP_STATUSES.includes(b.status));
  const replaceable = existingBlocks.filter((b) => !kept.includes(b));

  // Work already planned on earlier days (today .. day-1) isn't booked again here.
  const today = nowIn(zone).toISODate()!;
  const alreadyScheduledMinutes: Record<string, number> = {};
  if (day > today) {
    const { data: earlier } = await ctx.db
      .from("plan_blocks")
      .select("task_id,starts_at,ends_at")
      .gte("plan_date", today)
      .lt("plan_date", day)
      .in("status", ["planned", "in_progress"])
      .not("task_id", "is", null);
    for (const b of earlier ?? []) {
      alreadyScheduledMinutes[b.task_id] =
        (alreadyScheduledMinutes[b.task_id] ?? 0) + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;
    }
  }

  const now = opts.from ?? DateTime.now().setZone(zone);
  const out = scheduleDay({
    date: day,
    zone,
    now,
    availability: profile.availability ?? [],
    events,
    routines,
    tasks,
    keptBlocks: kept,
    alreadyScheduledMinutes,
    estimateRatio: estimate.ratio,
  });

  if (replaceable.length) {
    await ctx.db.from("plan_blocks").delete().eq("user_id", ctx.userId).in("id", replaceable.map((b) => b.id));
  }
  if (out.blocks.length) {
    const { error } = await ctx.db.from("plan_blocks").insert(
      out.blocks.map((b) => ({
        user_id: ctx.userId,
        task_id: b.task_id,
        routine_id: b.routine_id,
        title: b.title,
        plan_date: day,
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        is_flexible: true,
        status: "planned",
        created_by: "navi",
        reason: opts.reasonPrefix ? `${opts.reasonPrefix}: ${b.reason}` : b.reason,
      })),
    );
    if (error) throw new Error(`Could not save plan: ${error.message}`);
  }

  const before = new Map(replaceable.map((b) => [b.task_id ?? b.routine_id ?? b.title, b.starts_at]));
  const moved = out.blocks.filter((b) => {
    const prev = before.get(b.task_id ?? b.routine_id ?? b.title);
    return prev && prev !== b.starts_at;
  }).length;
  await logActivity(ctx, {
    action: "plan_generated",
    summary: `Planned ${day}: ${out.blocks.length} flexible block${out.blocks.length === 1 ? "" : "s"}${moved ? `, ${moved} moved` : ""}${out.unscheduled.length ? `, ${out.unscheduled.length} didn't fit` : ""}`,
  });
  return { ...out, date: day, moved, estimateSamples: estimate.samples, estimateRatio: estimate.ratio };
}

export async function generateWeekPlan(ctx: Ctx, startDate?: string) {
  const profile = await getProfile(ctx);
  const start = startDate ?? nowIn(profile.timezone).toISODate()!;
  const results: PlanResult[] = [];
  for (let i = 0; i < 7; i++) {
    const day = DateTime.fromISO(start, { zone: profile.timezone }).plus({ days: i }).toISODate()!;
    results.push(await generateDayPlan(ctx, day));
  }
  return results;
}

/** Mark a block's outcome. Only the user (or an approval) can mark work done. */
export async function setBlockOutcome(
  ctx: Ctx,
  blockId: string,
  status: PlanBlock["status"],
  reason?: string | null,
) {
  if (status === "done" && ctx.actor === "navi") {
    throw new Error("Navi can't mark scheduled work as completed; only you can.");
  }
  const { data: block } = await ctx.db.from("plan_blocks").select("*").eq("user_id", ctx.userId).eq("id", blockId).single();
  if (!block) throw new Error("Block not found");
  const { error } = await ctx.db.from("plan_blocks").update({ status, outcome_reason: reason ?? null }).eq("user_id", ctx.userId).eq("id", blockId);
  if (error) throw new Error(error.message);
  await logActivity(ctx, {
    action: "block_outcome",
    entityType: "plan_blocks",
    entityId: blockId,
    summary: `“${block.title}” marked ${status}${reason ? ` (${reason})` : ""}`,
    before: { status: block.status, outcome_reason: block.outcome_reason },
    after: { status, outcome_reason: reason ?? null },
    reversible: true,
  });
}

/**
 * "My plan broke": record what happened, mark interrupted blocks (keeping the
 * underlying tasks open, so nothing is lost), and re-plan the rest of today
 * from when the user is available again.
 */
export async function recoverPlan(
  ctx: Ctx,
  input: { description: string; category: "interruption" | "rest" | "missing_info" | "estimate" | "external" | "other"; availableFrom?: string | null },
) {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);
  const today = now.toISODate()!;
  const from = input.availableFrom ? DateTime.fromISO(input.availableFrom).setZone(zone) : now;

  const { data: blocks } = await ctx.db
    .from("plan_blocks")
    .select("*")
    .eq("plan_date", today)
    .in("status", ["planned", "in_progress"]);
  const affected = ((blocks ?? []) as PlanBlock[]).filter((b) => b.is_flexible && DateTime.fromISO(b.starts_at) < from);
  const outcome = input.category === "rest" ? "rest" : "interrupted";
  for (const b of affected) {
    await ctx.db.from("plan_blocks").update({ status: outcome, outcome_reason: input.description.slice(0, 300) }).eq("user_id", ctx.userId).eq("id", b.id);
  }
  const plan = await generateDayPlan(ctx, today, { from, reasonPrefix: "Replanned" });
  const summary = `${affected.length} block${affected.length === 1 ? "" : "s"} marked ${outcome}; ${plan.blocks.length} re-planned from ${from.toFormat("h:mm a")}${plan.unscheduled.length ? `; ${plan.unscheduled.length} task${plan.unscheduled.length === 1 ? "" : "s"} carried to later days` : ""}.`;
  await ctx.db.from("plan_disruptions").insert({
    user_id: ctx.userId,
    description: input.description,
    category: input.category,
    replan_summary: summary,
  });
  await logActivity(ctx, { action: "plan_recovered", summary: `Plan broke (${input.category}): ${summary}` });
  return { summary, affected: affected.length, plan };
}
