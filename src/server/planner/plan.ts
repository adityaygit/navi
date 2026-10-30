import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import type { CalendarEvent, PlanBlock, Routine, Task } from "@/lib/types";
import { learnedEstimateRatio, scheduleDay, type SchedulerOutput } from "./scheduler";
import { logActivity } from "@/server/domain/activity";
import { nowIn } from "@/lib/time";
import { OUTCOMES, withNote } from "@/lib/outcomes";
import { refreshStoredReview } from "@/server/jobs/briefings";

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
export async function generateDayPlan(
  ctx: Ctx,
  date?: string,
  opts: { from?: DateTime; reasonPrefix?: string; /** Tasks moved here from another day: their blocks say so. */ carried?: { taskIds: string[]; from: string } } = {},
): Promise<PlanResult> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const day = date ?? nowIn(zone).toISODate()!;
  const { tasks, events, routines, estimate } = await loadInputs(ctx);

  const { data: existing } = await ctx.db.from("plan_blocks").select("*").eq("user_id", ctx.userId).eq("plan_date", day);
  const existingBlocks = (existing ?? []) as PlanBlock[];
  const kept = existingBlocks.filter((b) => !b.is_flexible || b.created_by === "user" || KEEP_STATUSES.includes(b.status));
  // Blocks whose time has passed without the user saying how they went stay
  // as they were (re-planning must not hide them from the evening review).
  // replace_day_plan clears every planned Navi block, so they're written back.
  const nowMs = Date.now();
  const pastUnmarked = existingBlocks.filter((b) => !kept.includes(b) && Date.parse(b.ends_at) <= nowMs);
  const replaceable = existingBlocks.filter((b) => !kept.includes(b) && !pastUnmarked.includes(b));

  // Work already planned on earlier days (today .. day-1) isn't booked again here.
  const today = nowIn(zone).toISODate()!;
  const alreadyScheduledMinutes: Record<string, number> = {};
  if (day > today) {
    const { data: earlier } = await ctx.db
      .from("plan_blocks")
      .select("task_id,starts_at,ends_at")
      .eq("user_id", ctx.userId)
      .gte("plan_date", today)
      .lt("plan_date", day)
      .in("status", ["planned", "in_progress"])
      .gt("ends_at", new Date().toISOString()) // a block whose time passed unmarked isn't work done
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

  // One locked step in the database: replaces Navi's planned flexible blocks
  // for the day, so simultaneous planning runs can't both add a plan.
  const { error } = await ctx.db.rpc("replace_day_plan", {
    p_user: ctx.userId,
    p_day: day,
    p_blocks: [
      ...pastUnmarked.map((b) => ({ task_id: b.task_id, routine_id: b.routine_id, title: b.title, starts_at: b.starts_at, ends_at: b.ends_at, reason: b.reason })),
      ...out.blocks.map((b) => ({
        task_id: b.task_id,
        routine_id: b.routine_id,
        title: b.title,
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        reason:
          b.task_id && opts.carried?.taskIds.includes(b.task_id)
            ? `Carried over from ${opts.carried.from}: ${b.reason}`
            : opts.reasonPrefix
              ? `${opts.reasonPrefix}: ${b.reason}`
              : b.reason,
      })),
    ],
  });
  if (error) throw new Error(`Could not save plan: ${error.message}`);

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

export async function generateWeekPlan(ctx: Ctx, startDate?: string | null) {
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
  // A stored evening review of that day now reads differently: rebuild it.
  await refreshStoredReview(ctx.db, ctx.userId, block.plan_date);
}

export type RecoveryCategory = "interruption" | "rest" | "missing_info" | "estimate" | "external" | "other";

/** How a disruption reads for accountability: rest and blockers aren't failures, overruns are estimate problems. */
export function recoveryOutcome(category: RecoveryCategory, description: string): { status: PlanBlock["status"]; reason: string } {
  const d = description.trim();
  switch (category) {
    case "rest":
      return { status: "rest", reason: withNote(OUTCOMES.rest.reason, d) };
    case "missing_info":
      return { status: "skipped", reason: withNote(OUTCOMES.missing_info.reason, d) };
    case "estimate":
      return { status: "skipped", reason: withNote(OUTCOMES.estimate.reason, d) };
    default:
      return { status: "interrupted", reason: withNote(OUTCOMES.interrupted.reason, d) };
  }
}

/**
 * "My plan broke": record what happened, mark the blocks the disruption
 * actually covered (from when it started, default now, until the user is free
 * again), keep the underlying tasks open so nothing is lost, re-plan the rest
 * of today from when they're free, and move work that no longer fits today to
 * tomorrow. Earlier blocks the user simply hasn't marked are left alone: they
 * belong in the evening review, not hidden as "interrupted".
 */
export async function recoverPlan(
  ctx: Ctx,
  input: { description: string; category: RecoveryCategory; availableFrom?: string | null; since?: string | null },
) {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);
  const today = now.toISODate()!;
  const parse = (iso?: string | null) => {
    const d = iso ? DateTime.fromISO(iso).setZone(zone) : null;
    return d && d.isValid ? d : null;
  };
  let windowStart = parse(input.since) ?? now;
  let windowEnd = parse(input.availableFrom) ?? now;
  if (windowEnd < windowStart) [windowStart, windowEnd] = [windowEnd, windowStart];
  const from = windowEnd > now ? windowEnd : now; // re-plan from when they're free (never the past)
  const overlapEnd = windowEnd > windowStart ? windowEnd : windowStart.plus({ milliseconds: 1 });

  const { data: blocks } = await ctx.db
    .from("plan_blocks")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("plan_date", today)
    .in("status", ["planned", "in_progress"]);
  const open = (blocks ?? []) as PlanBlock[];
  const affected = open.filter(
    (b) => b.is_flexible && DateTime.fromISO(b.starts_at) < overlapEnd && DateTime.fromISO(b.ends_at) > windowStart,
  );
  const untouchedEarlier = open.filter((b) => !affected.includes(b) && DateTime.fromISO(b.ends_at) <= windowStart);
  const outcome = recoveryOutcome(input.category, input.description);
  for (const b of affected) {
    await ctx.db.from("plan_blocks").update({ status: outcome.status, outcome_reason: outcome.reason }).eq("user_id", ctx.userId).eq("id", b.id);
  }
  const plan = await generateDayPlan(ctx, today, { from, reasonPrefix: "Replanned" });

  // Work that no longer fits today goes into tomorrow's free time (fixed items and availability respected).
  const tomorrow = now.plus({ days: 1 }).toISODate()!;
  const carriedIds = plan.unscheduled.map((u) => u.task_id);
  let next: PlanResult | null = null;
  let moved: { title: string; starts_at: string }[] = [];
  if (carriedIds.length) {
    next = await generateDayPlan(ctx, tomorrow, { carried: { taskIds: carriedIds, from: now.toFormat("ccc LLL d") } });
    moved = next.blocks.filter((b) => b.task_id && carriedIds.includes(b.task_id)).map((b) => ({ title: b.title, starts_at: b.starts_at }));
  }
  const notPlaced = next ? next.unscheduled.filter((u) => carriedIds.includes(u.task_id)) : [];

  const label = { rest: "as rest", interrupted: "interrupted", skipped: input.category === "estimate" ? "as taking longer than estimated" : "as blocked on missing info" }[outcome.status as "rest" | "interrupted" | "skipped"];
  const t = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("h:mm a");
  const parts = [
    affected.length
      ? `${affected.length} block${affected.length === 1 ? "" : "s"} marked ${label} (${affected.map((b) => `“${b.title}”`).join(", ")}).`
      : "No planned blocks fell in that time.",
    `${plan.blocks.length} block${plan.blocks.length === 1 ? "" : "s"} re-planned from ${from.toFormat("h:mm a")} today.`,
  ];
  if (moved.length) parts.push(`Moved to tomorrow: ${moved.map((m) => `“${m.title}” ${t(m.starts_at)}`).join(", ")}${next?.moved ? ` (${next.moved} of tomorrow's blocks shifted to make room)` : ""}.`);
  if (notPlaced.length) parts.push(`Not scheduled yet, still on your task list: ${notPlaced.map((u) => `“${u.title}” (${u.remaining_minutes} min)`).join(", ")}; there's no free time for it tomorrow either.`);
  if (untouchedEarlier.length) parts.push(`${untouchedEarlier.length} earlier block${untouchedEarlier.length === 1 ? " isn't" : "s aren't"} marked yet; say how ${untouchedEarlier.length === 1 ? "it" : "they"} went in the evening review.`);
  const summary = parts.join(" ");

  await ctx.db.from("plan_disruptions").insert({
    user_id: ctx.userId,
    occurred_at: windowStart.toISO(),
    description: input.description,
    category: input.category,
    replan_summary: summary,
  });
  await logActivity(ctx, { action: "plan_recovered", summary: `Plan broke (${input.category}): ${summary}`.slice(0, 1000) });
  await refreshStoredReview(ctx.db, ctx.userId, today);
  return { summary, affected: affected.length, plan, tomorrow: next, movedToTomorrow: moved, notPlaced };
}
