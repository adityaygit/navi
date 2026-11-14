import "server-only";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { createEntity, getEntity } from "@/server/domain/entities";
import type { PlanBlock, Task } from "@/lib/types";
import { plannerV2 } from "@/lib/planner-flag";
import { fixedClash } from "./clash";

export const PlaceInput = z.object({
  taskId: z.string().uuid(),
  startsAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO date-time"),
  minutes: z.number().int().min(5).max(480),
});

/**
 * "Put it there" on My day: the person places an unscheduled task into a free
 * stretch. A flexible plan block, created by the user (so it's theirs, not a
 * guess), refused if it would overlap something already on that day.
 * Throws a ZodError for bad input, an Error written for the person otherwise.
 * The web (placeTaskAction) and the phone app (/api/m) both call this.
 */
export async function placeTask(ctx: Ctx, input: unknown): Promise<PlanBlock> {
  const v = PlaceInput.parse(input);
  const task = await getEntity<Task>(ctx, "tasks", v.taskId);
  if (["done", "cancelled"].includes(task.status)) throw new Error("That task is already finished.");
  const start = DateTime.fromISO(v.startsAt).setZone(ctx.timezone);
  const end = start.plus({ minutes: v.minutes });
  const planDate = start.toISODate()!;
  const { data: clash, error } = await ctx.db
    .from("plan_blocks")
    .select("id,title")
    .eq("plan_date", planDate)
    .in("status", ["planned", "in_progress"])
    .lt("starts_at", end.toUTC().toISO()!)
    .gt("ends_at", start.toUTC().toISO()!)
    .limit(1);
  if (error) throw new Error(error.message);
  if (clash?.length) throw new Error(`That time overlaps “${(clash[0] as Pick<PlanBlock, "title">).title}”.`);
  // Planner v2 (B5): fixed things (events, with one-session changes, and fixed routines) are never overlapped either.
  const { data: prof } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).single();
  if (plannerV2(prof?.preferences)) {
    const fixed = await fixedClash(ctx, planDate, start, end);
    if (fixed) throw new Error(`That time overlaps “${fixed}”.`);
  }
  return createEntity<PlanBlock>(
    ctx,
    "plan_blocks",
    {
      task_id: task.id,
      title: task.title,
      plan_date: planDate,
      starts_at: start.toUTC().toISO(),
      ends_at: end.toUTC().toISO(),
      is_flexible: true,
      created_by: "user",
      reason: "You put it here.",
    },
    { summary: `Put “${task.title}” at ${start.toFormat("h:mm a")}` },
  );
}
