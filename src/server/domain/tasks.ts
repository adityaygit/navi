import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import type { Task } from "@/lib/types";
import { createEntity, getEntity, updateEntity } from "./entities";
import { logActivity } from "./activity";
import { TaskCreate, TaskUpdate, compact } from "./schemas";

export async function createTask(ctx: Ctx, input: TaskCreate): Promise<Task> {
  const values = compact(TaskCreate.parse(input));
  return createEntity<Task>(ctx, "tasks", { ...values, source: ctx.actor === "navi" ? "navi" : "user" });
}

export async function updateTask(ctx: Ctx, id: string, input: TaskUpdate) {
  const patch: Record<string, unknown> = compact(TaskUpdate.parse(input));
  if (patch.status === "done") patch.completed_at = new Date().toISOString();
  else if (patch.status) patch.completed_at = null;
  return updateEntity<Task>(ctx, "tasks", id, patch);
}

/** Completing a recurring task spawns its next occurrence. */
export async function completeTask(ctx: Ctx, id: string, actualMinutes?: number | null) {
  if (ctx.actor === "navi") throw new Error("Only you can mark a task done.");
  const task = await getEntity<Task>(ctx, "tasks", id);
  const patch: Record<string, unknown> = { status: "done", completed_at: new Date().toISOString() };
  if (actualMinutes != null) patch.actual_minutes = Math.max(task.actual_minutes, actualMinutes);
  const result = await updateEntity<Task>(ctx, "tasks", id, patch, { summary: `Completed “${task.title}”` });

  if (task.recurrence) {
    const { data: profile } = await ctx.db.from("profiles").select("timezone").eq("id", ctx.userId).single();
    const zone = profile?.timezone ?? "UTC";
    const base = task.due_at ? DateTime.fromISO(task.due_at).setZone(zone) : DateTime.now().setZone(zone).endOf("day");
    let next = base.plus({ days: 1 });
    if (task.recurrence.freq === "weekly" && task.recurrence.days?.length) {
      for (let i = 0; i < 8 && !task.recurrence.days.includes(next.weekday % 7); i++) next = next.plus({ days: 1 });
    } else if (task.recurrence.freq === "weekly") {
      next = base.plus({ weeks: 1 });
    }
    await createEntity(ctx, "tasks", {
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      due_at: next.toISO(),
      due_is_hard: task.due_is_hard,
      estimate_minutes: task.estimate_minutes,
      workspace_id: task.workspace_id,
      project_id: task.project_id,
      goal_id: task.goal_id,
      recurrence: task.recurrence,
      source: "recurrence",
    }, { summary: `Next “${task.title}” scheduled for ${next.toFormat("ccc LLL d")}` });
  }
  return result;
}

export async function startFocus(ctx: Ctx, input: { task_id?: string | null; block_id?: string | null; planned_minutes?: number | null }) {
  const { data: active } = await ctx.db.from("focus_sessions").select("id").is("ended_at", null).maybeSingle();
  if (active) throw new Error("A focus session is already running. End it first.");
  const { data, error } = await ctx.db
    .from("focus_sessions")
    .insert({ user_id: ctx.userId, task_id: input.task_id ?? null, block_id: input.block_id ?? null, planned_minutes: input.planned_minutes ?? null })
    .select()
    .single();
  if (error) throw new Error(error.message);
  if (input.task_id) await ctx.db.from("tasks").update({ status: "in_progress" }).eq("id", input.task_id).eq("status", "todo");
  if (input.block_id) await ctx.db.from("plan_blocks").update({ status: "in_progress" }).eq("id", input.block_id).eq("status", "planned");
  await logActivity(ctx, { action: "focus_started", summary: "Started a focus session" });
  return data;
}

/** End focus: records actual time against the task (real data for estimates and reviews). */
export async function endFocus(
  ctx: Ctx,
  sessionId: string,
  outcome: "completed" | "progress" | "interrupted" | "abandoned",
  note?: string | null,
) {
  const { data: s } = await ctx.db.from("focus_sessions").select("*").eq("id", sessionId).single();
  if (!s) throw new Error("Focus session not found");
  if (s.ended_at) return s;
  const ended = new Date();
  const minutes = Math.max(1, Math.round((ended.getTime() - Date.parse(s.started_at)) / 60000));
  await ctx.db.from("focus_sessions").update({ ended_at: ended.toISOString(), actual_minutes: minutes, outcome, note: note ?? null }).eq("id", sessionId);
  if (s.task_id) {
    const task = await getEntity<Task>(ctx, "tasks", s.task_id);
    await ctx.db.from("tasks").update({ actual_minutes: task.actual_minutes + minutes }).eq("id", s.task_id);
    if (outcome === "completed") await completeTask({ ...ctx, actor: "user" }, s.task_id);
  }
  if (s.block_id) {
    const blockStatus = outcome === "completed" ? "done" : outcome === "progress" ? "partial" : "interrupted";
    await ctx.db.from("plan_blocks").update({ status: blockStatus, outcome_reason: note ?? null }).eq("id", s.block_id);
  }
  await logActivity(ctx, { action: "focus_ended", summary: `Focus session ended after ${minutes} min (${outcome})` });
  return { ...s, actual_minutes: minutes, outcome };
}
