import "server-only";
import { DateTime } from "luxon";
import { z } from "zod";
import type { Ctx } from "@/server/context";
import type { Task } from "@/lib/types";
import { AlreadyChangedError, createEntity, getEntity, updateEntity, type UpdateResult } from "./entities";
import { logActivity } from "./activity";
import { TaskCreate, TaskUpdate, compact } from "./schemas";
import { OUTCOMES, STOPPED_NO_REASON, withNote } from "@/lib/outcomes";
import { refreshStoredReview } from "@/server/jobs/briefings";
import { UserFacingError } from "@/server/http";
import type { FocusSession } from "@/lib/focus";

export type { FocusSession };

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

/**
 * Create a task. `opts.id` (optional uuid, chosen by the client once per
 * submit) makes it idempotent: a retry with the same id returns the task the
 * first attempt made instead of adding a duplicate.
 */
export async function createTask(ctx: Ctx, input: TaskCreate, opts: { id?: string } = {}): Promise<Task> {
  const values: Record<string, unknown> = compact(TaskCreate.parse(input));
  // "Not given" for columns that have defaults (the schema allows null, the table doesn't).
  for (const k of ["due_is_hard", "priority"]) if (values[k] === null) delete values[k];
  return createEntity<Task>(ctx, "tasks", { ...values, source: ctx.actor === "navi" ? "navi" : "user" }, { id: opts.id });
}

/**
 * A change the person makes to a task (web task card, phone app). Marking it
 * done goes through completeTask so a recurring task spawns its next one.
 */
export async function changeTask(ctx: Ctx, id: string, input: unknown) {
  const { status, ...rest } = TaskUpdate.parse(input);
  const r = await updateTask(ctx, id, status === "done" ? rest : { ...rest, ...(status ? { status } : {}) });
  if (status === "done") return completeTask(ctx, id);
  return r;
}

/** How the person ended a focus session (web and phone app). */
export const FocusEndInput = z.object({
  outcome: z.enum(["completed", "progress", "interrupted", "abandoned"]),
  note: z.string().max(300).nullish(),
  reason: z.enum(["rest", "missing_info", "estimate"]).nullish(),
  moreMinutes: z.number().int().min(5).max(480).nullish(),
});

export async function updateTask(ctx: Ctx, id: string, input: TaskUpdate) {
  const patch: Record<string, unknown> = compact(TaskUpdate.parse(input));
  if (patch.status === "done") patch.completed_at = new Date().toISOString();
  else if (patch.status) patch.completed_at = null;
  // A new (or cleared) reminder time is a fresh reminder: it hasn't been sent yet.
  if ("remind_at" in patch) patch.reminded_at = null;
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

const RUNNING_ELSEWHERE = "A focus session is already running. End it first.";

/**
 * Scenario 5 (planner v2 only): the work took longer than estimated. If the
 * person said how much more it needs, the estimate becomes time spent + that
 * (undoable); then the rest of today is re-fitted around it as one undoable
 * change set. The task stays open: nothing is marked done.
 */
async function refitAfterOverrun(ctx: Ctx, s: FocusSession, outcome: string, moreMinutes: number | null) {
  if (!s.task_id || outcome === "completed") return;
  const { data: prof } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).single();
  const { plannerV2 } = await import("@/lib/planner-flag");
  if (!plannerV2(prof?.preferences)) return;
  const task = await getEntity<Task>(ctx, "tasks", s.task_id);
  if (["done", "cancelled"].includes(task.status)) return;
  if (moreMinutes) await updateTask({ ...ctx, actor: "user" }, task.id, { estimate_minutes: Math.min(1440, task.actual_minutes + moreMinutes) });
  if (!moreMinutes && outcome !== "progress" && outcome !== "interrupted") return;
  const { planDays } = await import("@/server/planner/plan-v2");
  const today = DateTime.now().setZone(ctx.timezone).toISODate()!;
  await planDays(ctx, [today], { trigger: "overrun", reasonPrefix: "Re-fitted after focus" });
}

/**
 * Start focus. The database allows one open session per person, so a double
 * tap (or two devices) can't start two: the repeated request gets the session
 * the first one started. Asking to focus on something else while a session is
 * open is refused, not silently ignored.
 */
export async function startFocus(ctx: Ctx, input: { task_id?: string | null; block_id?: string | null; planned_minutes?: number | null }): Promise<FocusSession> {
  const want = { task_id: input.task_id ?? null, block_id: input.block_id ?? null };
  const { data, error } = await ctx.db
    .from("focus_sessions")
    .insert({ user_id: ctx.userId, ...want, planned_minutes: input.planned_minutes ?? null })
    .select()
    .single();
  if (error) {
    if (error.code !== "23505") throw new Error(`Could not start focus: ${error.message}`);
    const { data: open, error: readErr } = await ctx.db.from("focus_sessions").select("*").eq("user_id", ctx.userId).is("ended_at", null).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!open) throw new Error("Could not start focus. Try again.");
    if (open.task_id !== want.task_id || open.block_id !== want.block_id) throw new UserFacingError(RUNNING_ELSEWHERE, 409);
    return open as FocusSession;
  }
  if (want.task_id) {
    const { error: e } = await ctx.db.from("tasks").update({ status: "in_progress" }).eq("id", want.task_id).eq("status", "todo");
    if (e) throw new Error(e.message);
  }
  if (want.block_id) {
    const { error: e } = await ctx.db.from("plan_blocks").update({ status: "in_progress" }).eq("id", want.block_id).eq("status", "planned");
    if (e) throw new Error(e.message);
  }
  await logActivity(ctx, { action: "focus_started", summary: "Started a focus session" });
  return data as FocusSession;
}

async function readSession(ctx: Ctx, sessionId: string): Promise<FocusSession> {
  const { data, error } = await ctx.db.from("focus_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserFacingError("Focus session not found", 404);
  return data as FocusSession;
}

/** The row a focus_* database function returned, if this call changed it. */
async function focusRpc(ctx: Ctx, fn: "focus_pause" | "focus_resume" | "focus_end", args: Record<string, unknown>, what: string) {
  const { data, error } = await ctx.db.rpc(fn, args);
  if (error) throw new Error(`Could not ${what}: ${error.message}`);
  return ((data ?? []) as FocusSession[])[0] ?? null;
}

/** Pause a running session. Pausing one that's already paused (or ended) changes nothing. */
export async function pauseFocus(ctx: Ctx, sessionId: string): Promise<FocusSession> {
  const row = await focusRpc(ctx, "focus_pause", { p_session: sessionId }, "pause focus");
  if (!row) return readSession(ctx, sessionId);
  await logActivity(ctx, { action: "focus_paused", summary: "Paused focus" });
  return row;
}

/** Resume a paused session; the time it was paused doesn't count as focus. */
export async function resumeFocus(ctx: Ctx, sessionId: string): Promise<FocusSession> {
  const row = await focusRpc(ctx, "focus_resume", { p_session: sessionId }, "resume focus");
  if (!row) return readSession(ctx, sessionId);
  await logActivity(ctx, { action: "focus_resumed", summary: "Resumed focus" });
  return row;
}

/**
 * End focus: records actual time (minus pauses) against the task — real data
 * for estimates and reviews. The end is claimed in the database, and the task's
 * minutes are added in the same statement, so if "end" arrives twice (double
 * tap, retry) only the first counts; the second gets the ended session back.
 */
export async function endFocus(
  ctx: Ctx,
  sessionId: string,
  outcome: "completed" | "progress" | "interrupted" | "abandoned",
  note?: string | null,
  reason?: StopReason | null,
  /** Planner v2: the person says it needs this much more (it took longer than estimated). */
  moreMinutes?: number | null,
): Promise<FocusSession> {
  const s = await focusRpc(ctx, "focus_end", { p_session: sessionId, p_outcome: outcome, p_note: note ?? null }, "end focus");
  if (!s) return readSession(ctx, sessionId); // already ended (or not the person's: then "not found")
  if (s.task_id && outcome === "completed") await completeTask({ ...ctx, actor: "user" }, s.task_id);
  let block: { status: string; reason: string | null } | null = null;
  if (s.block_id) {
    block = focusBlockOutcome(outcome, note, reason);
    const { data: b, error } = await ctx.db.from("plan_blocks").update({ status: block.status, outcome_reason: block.reason }).eq("id", s.block_id).select("plan_date").maybeSingle();
    if (error) throw new Error(error.message);
    if (b) await refreshStoredReview(ctx.db, ctx.userId, b.plan_date);
  }
  await logActivity(ctx, { action: "focus_ended", summary: `Focus session ended after ${s.actual_minutes} min (${outcome}${block?.reason ? `: ${block.reason}` : ""})` });
  try {
    await refitAfterOverrun(ctx, s, outcome, moreMinutes ?? null);
  } catch (err) {
    // Re-planning must never undo ending the session; the person can plan again.
    console.error("re-plan after focus failed:", err instanceof Error ? err.message : err);
  }
  return s;
}
