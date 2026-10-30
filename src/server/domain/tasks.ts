import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import type { Task } from "@/lib/types";
import { AlreadyChangedError, createEntity, getEntity, updateEntity, type UpdateResult } from "./entities";
import { logActivity } from "./activity";
import { TaskCreate, TaskUpdate, compact } from "./schemas";
import { OUTCOMES, STOPPED_NO_REASON, withNote } from "@/lib/outcomes";
import { refreshStoredReview } from "@/server/jobs/briefings";

/** Why a focus session was stopped early, if the user said. */
export type StopReason = "rest" | "missing_info" | "estimate";

/**
 * The block outcome a focus session leaves behind. Stopping without a reason
 * is an unexcused skip (it counts), not an interruption: only the user can say
 * it was rest, an interruption, missing information or a bad estimate.
 */
export function focusBlockOutcome(outcome: "completed" | "progress" | "interrupted" | "abandoned", note?: string | null, reason?: StopReason | null): { status: "done" | "partial" | "interrupted" | "rest" | "skipped"; reason: string | null } {
  if (outcome === "completed") return { status: "done", reason: note?.trim() || null };
  if (outcome === "progress") return { status: "partial", reason: note?.trim() || null };
  if (outcome === "interrupted") return { status: "interrupted", reason: withNote(OUTCOMES.interrupted.reason, note) };
  if (reason) return { status: OUTCOMES[reason].status, reason: withNote(OUTCOMES[reason].reason, note) };
  return { status: "skipped", reason: withNote(STOPPED_NO_REASON, note) };
}

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

/**
 * Completing a recurring task spawns its next occurrence: the first one after
 * now (so finishing late doesn't leave a backlog of overdue copies), at the
 * same local time. Finishing an already-done task changes nothing.
 */
export async function completeTask(ctx: Ctx, id: string, actualMinutes?: number | null) {
  if (ctx.actor === "navi") throw new Error("Only you can mark a task done.");
  const task = await getEntity<Task>(ctx, "tasks", id);
  if (task.status === "done") return { kind: "updated", row: task } satisfies UpdateResult<Task>;
  const patch: Record<string, unknown> = { status: "done", completed_at: new Date().toISOString() };
  if (actualMinutes != null) patch.actual_minutes = Math.max(task.actual_minutes, actualMinutes);
  let result: UpdateResult<Task>;
  try {
    // Guarded so two simultaneous completions can't both spawn a next occurrence.
    result = await updateEntity<Task>(ctx, "tasks", id, patch, { summary: `Completed “${task.title}”`, unless: { status: "done" } });
  } catch (err) {
    if (err instanceof AlreadyChangedError) return { kind: "updated", row: { ...task, status: "done" } } satisfies UpdateResult<Task>;
    throw err;
  }

  if (task.recurrence) {
    const { data: profile } = await ctx.db.from("profiles").select("timezone").eq("id", ctx.userId).single();
    const zone = profile?.timezone ?? "UTC";
    const now = DateTime.now().setZone(zone);
    const rule = task.recurrence;
    const advance = (d: DateTime) => {
      if (rule.freq === "weekly" && !rule.days?.length) return d.plus({ weeks: 1 });
      let n = d.plus({ days: 1 });
      if (rule.freq === "weekly") for (let i = 0; i < 7 && !rule.days!.includes(n.weekday % 7); i++) n = n.plus({ days: 1 });
      return n;
    };
    let next = advance(task.due_at ? DateTime.fromISO(task.due_at).setZone(zone) : now.endOf("day"));
    for (let i = 0; i < 1000 && next <= now; i++) next = advance(next);
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
  reason?: StopReason | null,
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
  let block: { status: string; reason: string | null } | null = null;
  if (s.block_id) {
    block = focusBlockOutcome(outcome, note, reason);
    const { data: b } = await ctx.db.from("plan_blocks").update({ status: block.status, outcome_reason: block.reason }).eq("id", s.block_id).select("plan_date").maybeSingle();
    if (b) await refreshStoredReview(ctx.db, ctx.userId, b.plan_date);
  }
  await logActivity(ctx, { action: "focus_ended", summary: `Focus session ended after ${minutes} min (${outcome}${block?.reason ? `: ${block.reason}` : ""})` });
  return { ...s, actual_minutes: minutes, outcome };
}
