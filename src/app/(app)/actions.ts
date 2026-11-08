"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiCtx, type Ctx } from "@/server/context";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { createTask, updateTask, completeTask, startFocus, endFocus, pauseFocus, resumeFocus } from "@/server/domain/tasks";
import { createEntity, deleteEntity, updateEntity, type EntityTable } from "@/server/domain/entities";
import {
  acceptMany,
  acceptManyProblem,
  acceptProposal,
  editProposal,
  mergeProposalIntoTask,
  setProposalStatus,
} from "@/server/domain/proposals";
import { confirmMemory, correctMemory, deleteMemory, rejectMemory, addMemory } from "@/server/domain/memory";
import { actionView, decideApproval, revertedAmong } from "@/server/domain/approvals";
import { revertActivities, revertActivity } from "@/server/domain/activity";
import type { ActionView } from "@/lib/actions";
import { generateDayPlan, generateWeekPlan, recoverPlan, setBlockOutcome } from "@/server/planner/plan";
import { summarizeDayPlan, summarizeWeekPlan } from "@/lib/plan-summary";
import {
  EventCreate,
  GoalCreate,
  MemoryCreate,
  MilestoneCreate,
  NoteCreate,
  ProfileUpdate,
  ProjectCreate,
  RoutineCreate,
  TaskCreate,
  TaskUpdate,
  WorkspaceCreate,
  compact,
} from "@/server/domain/schemas";
import { approveBudgetOverride } from "@/server/ai/budget";
import { logActivity } from "@/server/domain/activity";
import { isValidZone } from "@/lib/time";
import { WELCOME_STEPS, type WelcomeStep } from "@/lib/onboarding";
import { createConversation, deleteConversation, renameConversation } from "@/server/ai/chat";

// Server actions for every dashboard control. Each one goes through the same
// domain functions the AI tools use, then refreshes all views.

// `changed` on a failure: part of the request went through (e.g. some items of
// "accept all"), so views should refresh even though it didn't fully succeed.
export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string; changed?: boolean; data?: T };

/** Thrown inside an action when only part of it went through: reported as a failure, but views still refresh. */
class PartialFailure<T> extends Error {
  constructor(message: string, public data: T) {
    super(message);
  }
}

async function act<T>(fn: (ctx: Ctx) => Promise<T>, message?: string | ((data: T, ctx: Ctx) => string)): Promise<ActionResult<T>> {
  try {
    const ctx = await requireApiCtx();
    const data = await fn(ctx);
    revalidatePath("/", "layout");
    return { ok: true, data, message: typeof message === "function" ? message(data, ctx) : message };
  } catch (err) {
    if (err instanceof PartialFailure) {
      revalidatePath("/", "layout");
      return { ok: false, error: err.message, changed: true, data: err.data as T };
    }
    const error = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}

// ---- tasks & focus ---------------------------------------------------------
// `id` (optional): a uuid the client makes once per submit and sends again on
// every retry of that submit, so a retry returns the task it already made
// instead of adding a second one. See newSubmitId in client-actions.
const ClientId = z.object({ id: z.string().uuid().optional() });
export async function createTaskAction(input: unknown) {
  return act((ctx) => createTask(ctx, TaskCreate.parse(input), { id: ClientId.parse(input ?? {}).id }), "Task added");
}
export async function updateTaskAction(id: string, input: unknown) {
  return act(async (ctx) => {
    const { status, ...rest } = TaskUpdate.parse(input);
    const r = await updateTask(ctx, id, status === "done" ? rest : { ...rest, ...(status ? { status } : {}) });
    // Completion goes through completeTask so recurring tasks spawn their next occurrence.
    if (status === "done") return completeTask(ctx, id);
    return r;
  }, "Saved");
}
export async function completeTaskAction(id: string, actualMinutes?: number | null) {
  return act((ctx) => completeTask(ctx, id, actualMinutes), "Done");
}
export async function startFocusAction(input: { task_id?: string | null; block_id?: string | null; planned_minutes?: number | null }) {
  return act((ctx) => startFocus(ctx, input));
}
const FocusEnd = z.object({
  outcome: z.enum(["completed", "progress", "interrupted", "abandoned"]),
  note: z.string().max(300).nullish(),
  reason: z.enum(["rest", "missing_info", "estimate"]).nullish(),
});
export async function endFocusAction(id: string, outcome: "completed" | "progress" | "interrupted" | "abandoned", note?: string | null, reason?: "rest" | "missing_info" | "estimate" | null, moreMinutes?: number | null) {
  return act((ctx) => {
    const v = FocusEnd.parse({ outcome, note, reason });
    const more = moreMinutes == null ? null : z.number().int().min(5).max(480).parse(moreMinutes);
    return endFocus(ctx, id, v.outcome, v.note, v.reason, more);
  });
}
const SessionId = z.string().uuid();
export async function pauseFocusAction(id: string) {
  return act((ctx) => pauseFocus(ctx, SessionId.parse(id)), "Paused");
}
export async function resumeFocusAction(id: string) {
  return act((ctx) => resumeFocus(ctx, SessionId.parse(id)), "Resumed");
}

// ---- structure -------------------------------------------------------------
const CREATE_SCHEMAS: Partial<Record<EntityTable, z.ZodTypeAny>> = {
  workspaces: WorkspaceCreate,
  goals: GoalCreate,
  projects: ProjectCreate,
  milestones: MilestoneCreate,
  routines: RoutineCreate,
  events: EventCreate,
  notes: NoteCreate,
};
export async function createItemAction(table: EntityTable, input: unknown) {
  return act(async (ctx) => {
    const schema = CREATE_SCHEMAS[table];
    if (!schema) throw new Error("Unsupported item type");
    const values = compact(schema.parse(input) as Record<string, unknown>);
    return createEntity(ctx, table, values);
  }, "Added");
}
export async function updateItemAction(table: EntityTable, id: string, patch: Record<string, unknown>) {
  return act(async (ctx) => {
    const forbidden = ["id", "user_id", "created_at", "updated_at"];
    let clean: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([k]) => !forbidden.includes(k)));
    if (table === "notes") clean = compact(NoteCreate.partial().parse(clean));
    return updateEntity(ctx, table, id, clean);
  }, "Saved");
}
export async function deleteItemAction(table: EntityTable, id: string) {
  return act((ctx) => deleteEntity(ctx, table, id), "Deleted");
}

// ---- review inbox ----------------------------------------------------------
export async function acceptProposalAction(id: string, edits?: Record<string, unknown>) {
  return act((ctx) => acceptProposal(ctx, id, edits), "Accepted");
}
/** Accept several items. If any couldn't be accepted it's reported as a failure naming them; the rest stay accepted. */
export async function acceptManyAction(ids: string[]) {
  return act(async (ctx) => {
    const results = await acceptMany(ctx, z.array(z.string().uuid()).max(500).parse(ids));
    const problem = acceptManyProblem(results);
    if (problem) throw results.some((r) => r.ok) ? new PartialFailure(problem, results) : new Error(problem);
    return results;
  }, (results) => `Accepted ${results.length} item${results.length === 1 ? "" : "s"}`);
}
export async function setProposalStatusAction(id: string, status: "rejected" | "deferred" | "pending") {
  return act((ctx) => setProposalStatus(ctx, id, status));
}
export async function editProposalAction(id: string, payload: Record<string, unknown>) {
  return act((ctx) => editProposal(ctx, id, payload), "Saved");
}
export async function mergeProposalAction(id: string, taskId: string) {
  return act((ctx) => mergeProposalIntoTask(ctx, id, taskId), "Merged");
}

/** Finish onboarding: accept the chosen items, keep the rest for later review, build the first plan. */
export async function completeOnboardingAction(acceptIds: string[]) {
  return act(async (ctx) => {
    const results = await acceptMany(ctx, acceptIds);
    const failed = results.filter((r) => !r.ok);
    // Anything not accepted stays in the inbox (as pending) instead of disappearing.
    await ctx.db.from("proposals").update({ batch: null }).eq("batch", "onboarding").eq("status", "pending");
    await ctx.db.from("profiles").update({ onboarding_status: "completed" }).eq("id", ctx.userId);
    // Setup continues on /welcome with "Stay in touch" and the first plan.
    await setWelcomeStep(ctx, "notify");
    const plan = await generateWeekPlan(ctx);
    await logActivity(ctx, { action: "onboarding_completed", summary: `Finished setup: ${results.length - failed.length} items activated` });
    return { accepted: results.length - failed.length, failed, plannedBlocks: plan.reduce((s, d) => s + d.blocks.length, 0) };
  });
}
export async function skipOnboardingAction() {
  return act(async (ctx) => {
    await ctx.db.from("profiles").update({ onboarding_status: "skipped" }).eq("id", ctx.userId);
  });
}
export async function restartOnboardingAction() {
  return act(async (ctx) => {
    await ctx.db.from("profiles").update({ onboarding_status: "in_progress" }).eq("id", ctx.userId);
  });
}

// ---- planner ---------------------------------------------------------------
const PlanDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
// Planning results are summarized for the person (placed / moved / didn't fit / warnings).
export async function planDayAction(date?: string | null) {
  return act((ctx) => generateDayPlan(ctx, PlanDate.parse(date) ?? undefined), (r, ctx) => summarizeDayPlan(r, ctx.timezone));
}
export async function planWeekAction(start?: string | null) {
  return act((ctx) => generateWeekPlan(ctx, PlanDate.parse(start)), (rs, ctx) => summarizeWeekPlan(rs, ctx.timezone));
}
const BlockOutcome = z.object({
  status: z.enum(["done", "partial", "skipped", "missed", "rest", "interrupted", "planned"]),
  reason: z.string().max(300).nullish(),
});
export async function blockOutcomeAction(id: string, status: "done" | "partial" | "skipped" | "missed" | "rest" | "interrupted" | "planned", reason?: string | null) {
  return act((ctx) => {
    const v = BlockOutcome.parse({ status, reason });
    return setBlockOutcome(ctx, id, v.status, v.reason);
  });
}
const Recovery = z.object({
  description: z.string().min(1).max(500),
  category: z.enum(["interruption", "rest", "missing_info", "estimate", "external", "other"]),
  availableFrom: z.string().max(40).nullish(),
  since: z.string().max(40).nullish(),
});
export async function recoverPlanAction(input: { description: string; category: "interruption" | "rest" | "missing_info" | "estimate" | "external" | "other"; availableFrom?: string | null; since?: string | null }) {
  return act((ctx) => recoverPlan(ctx, Recovery.parse(input)));
}

// ---- memory ----------------------------------------------------------------
export async function addMemoryAction(input: unknown) {
  return act((ctx) => addMemory(ctx, { ...MemoryCreate.parse(input), origin: "stated" }), "Saved");
}
export async function correctMemoryAction(id: string, content: string) {
  return act((ctx) => correctMemory(ctx, id, content), "Corrected");
}
export async function confirmMemoryAction(id: string) {
  return act((ctx) => confirmMemory(ctx, id));
}
export async function rejectMemoryAction(id: string) {
  return act((ctx) => rejectMemory(ctx, id));
}
export async function deleteMemoryAction(id: string) {
  return act((ctx) => deleteMemory(ctx, id), "Deleted");
}

// ---- approvals & activity --------------------------------------------------
/**
 * Approve or decline an action card. Answers with the card as it really is
 * afterwards: done (with what happened), failed, declined, expired, or
 * unchanged when Navi revised it after the person last looked (`revision`).
 * Tapping twice or retrying is safe: the action runs at most once.
 */
export async function decideApprovalAction(id: string, decision: "approve" | "reject", revision?: number): Promise<ActionResult<ActionView>> {
  return act(
    async (ctx) => {
      const row = await decideApproval(ctx, id, decision, createSupabaseAdmin(), typeof revision === "number" ? revision : undefined);
      const undo = Array.isArray((row.result as { undo?: unknown } | null)?.undo) ? ((row.result as { undo: string[] }).undo) : [];
      return actionView(row, ctx.timezone, await revertedAmong(ctx, undo));
    },
    (v) => v.result ?? v.error ?? v.status,
  );
}
/** Undo everything one of Navi's steps (or an approved action) changed. */
export async function undoChangesAction(activityIds: string[]) {
  return act(async (ctx) => {
    const ids = z.array(z.string().uuid()).min(1).max(20).parse(activityIds);
    return revertActivities(ctx, ids);
  }, (r) => r.message);
}
/** Navi's autonomy: "auto" = low-risk changes happen right away; "ask" = every change waits for a tap. */
export async function setAutonomyAction(value: "auto" | "ask") {
  return act(async (ctx) => {
    const autonomy = z.enum(["auto", "ask"]).parse(value);
    const { data } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).single();
    const preferences = { ...((data?.preferences as Record<string, unknown> | null) ?? {}), autonomy };
    const { error } = await ctx.db.from("profiles").update({ preferences }).eq("id", ctx.userId);
    if (error) throw new Error(error.message);
    await logActivity(ctx, { action: "settings_updated", summary: autonomy === "ask" ? "Navi now asks before every change" : "Navi now makes low-risk changes on its own" });
    return autonomy;
  }, "Saved");
}
export async function revertActivityAction(id: string) {
  return act((ctx) => revertActivity(ctx, id));
}

// ---- settings --------------------------------------------------------------
export async function updateProfileAction(input: unknown) {
  return act(async (ctx) => {
    const patch = compact(ProfileUpdate.parse(input));
    if (patch.timezone && !isValidZone(patch.timezone)) throw new Error(`Unknown time zone: ${patch.timezone}`);
    const { error } = await ctx.db.from("profiles").update(patch).eq("id", ctx.userId);
    if (error) throw new Error(error.message);
    await logActivity(ctx, { action: "settings_updated", summary: `Updated settings: ${Object.keys(patch).join(", ")}` });
  }, "Settings saved");
}
/** Sets the time zone from the browser on first run (only while still the default). */
export async function adoptBrowserTimezoneAction(zone: string) {
  return act(async (ctx) => {
    if (!isValidZone(zone)) return;
    await ctx.db.from("profiles").update({ timezone: zone }).eq("id", ctx.userId).eq("timezone", "UTC");
  });
}
export async function approveBudgetOverrideAction(extraUsd: number) {
  return act(async (ctx) => {
    const { data } = await ctx.db.auth.getClaims();
    await approveBudgetOverride(ctx.userId, data?.claims?.email as string | undefined, extraUsd);
    await logActivity(ctx, { action: "budget_override", summary: `Approved +$${extraUsd.toFixed(2)} AI testing budget for today` });
  }, "Override approved for today");
}
export async function markBriefingReadAction(id: string) {
  return act(async (ctx) => {
    await ctx.db.from("briefings").update({ read_at: new Date().toISOString() }).eq("id", id);
  });
}

// ---- reviews ---------------------------------------------------------------
export async function generateBriefingAction(kind: "morning" | "evening" | "weekly") {
  return act(async (ctx) => {
    const { getProfile } = await import("@/server/context");
    const { buildBriefing } = await import("@/server/jobs/briefings");
    const { nowIn } = await import("@/lib/time");
    const profile = await getProfile(ctx);
    const date = nowIn(profile.timezone).toISODate()!;
    const b = await buildBriefing(ctx.db, profile, kind, date);
    if ("week" in b && b.week) {
      const { learnFromWeek } = await import("@/server/domain/patterns");
      await learnFromWeek(ctx.db, ctx.userId, b.week);
    }
    // On-demand reviews replace today's stored one of the same kind (data may have changed).
    const { error } = await ctx.db
      .from("briefings")
      .upsert({ user_id: ctx.userId, kind, local_date: date, title: b.title, body: b.body, data: b.data, generated_by: "rules", read_at: null }, { onConflict: "user_id,kind,local_date" });
    if (error) throw new Error(error.message);
    return { title: b.title, body: b.body };
  });
}

// ---- chats -----------------------------------------------------------------
export async function createChatAction() {
  return act((ctx) => createConversation(ctx, "chat"));
}
export async function renameChatAction(id: string, title: string) {
  return act((ctx) => renameConversation(ctx, z.string().uuid().parse(id), z.string().max(200).parse(title)), "Chat renamed");
}
export async function deleteChatAction(id: string) {
  return act((ctx) => deleteConversation(ctx, z.string().uuid().parse(id)), "Chat deleted");
}

// ---- Navi 1.5 shell ----------------------------------------------------------

/** ⌘K / Ctrl K: open tasks whose title matches. Read-only, so no refresh. */
export async function searchTasksAction(query: string): Promise<ActionResult<{ id: string; title: string; due_at: string | null; workspace_id: string | null }[]>> {
  try {
    const ctx = await requireApiCtx();
    const q = z.string().max(200).parse(query).trim();
    if (!q) return { ok: true, data: [] };
    // ilike wildcards in the person's text are matched literally.
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { data, error } = await ctx.db
      .from("tasks")
      .select("id,title,due_at,workspace_id")
      .in("status", ["todo", "in_progress", "blocked"])
      .ilike("title", pattern)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(6);
    if (error) throw new Error(error.message);
    return { ok: true, data: data ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const SuggestionKey = z.string().min(3).max(200).regex(/^[a-z_]+:[A-Za-z0-9:_-]+$/);
/** "Not now" on a page suggestion: it never comes back the same way. */
export async function dismissSuggestionAction(key: string) {
  return act(async (ctx) => {
    const k = SuggestionKey.parse(key);
    const { error } = await ctx.db.from("dismissed_suggestions").upsert({ user_id: ctx.userId, key: k }, { onConflict: "user_id,key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  });
}

// ---- setup (/welcome) ----------------------------------------------------------

/** Remember the setup screen the person is on, so they come back to it on any device. */
async function setWelcomeStep(ctx: Ctx, step: WelcomeStep | "done") {
  const { data } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).single();
  const preferences = { ...((data?.preferences as Record<string, unknown> | null) ?? {}), onboarding_step: step };
  const { error } = await ctx.db.from("profiles").update({ preferences }).eq("id", ctx.userId);
  if (error) throw new Error(error.message);
}

export async function saveWelcomeStepAction(step: string) {
  return act(async (ctx) => {
    const s = z.enum([...WELCOME_STEPS, "done"]).parse(step);
    await setWelcomeStep(ctx, s);
    // Starting to talk means setup is under way (the gate keeps them here until done or skipped).
    if (s === "talk") await ctx.db.from("profiles").update({ onboarding_status: "in_progress" }).eq("id", ctx.userId).in("onboarding_status", ["not_started"]);
  });
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Basics = z.object({ display_name: z.string().trim().min(1).max(120), timezone: z.string().max(64), wake: HHMM, bed: HHMM });

/**
 * The basics step: name, time zone, wake-up and bedtime. Wake/bed set quiet
 * hours (bedtime to wake-up), the morning briefing (at wake-up), and when Navi
 * may plan flexible work (between them). The evening briefing stays at 21:00.
 */
export async function saveBasicsAction(input: unknown) {
  return act(async (ctx) => {
    const b = Basics.parse(input);
    if (!isValidZone(b.timezone)) throw new Error(`Unknown time zone: ${b.timezone}`);
    const { data } = await ctx.db.from("profiles").select("preferences,onboarding_status").eq("id", ctx.userId).single();
    const preferences = { ...((data?.preferences as Record<string, unknown> | null) ?? {}), wake_time: b.wake, bed_time: b.bed, onboarding_step: "talk" };
    // A bedtime after midnight: plan until the end of the day.
    const end = b.bed > b.wake ? b.bed : "23:59";
    const { error } = await ctx.db
      .from("profiles")
      .update({
        display_name: b.display_name,
        timezone: b.timezone,
        quiet_hours_start: b.bed,
        quiet_hours_end: b.wake,
        morning_briefing_time: b.wake,
        availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: b.wake, end }],
        preferences,
        ...(data?.onboarding_status === "not_started" ? { onboarding_status: "in_progress" } : {}),
      })
      .eq("id", ctx.userId);
    if (error) throw new Error(error.message);
    await logActivity(ctx, { action: "settings_updated", summary: `Setup basics: up at ${b.wake}, in bed by ${b.bed}, ${b.timezone}` });
  });
}

/** "That's enough for now": open the review of what Navi picked up. */
export async function finishTalkAction() {
  return act(async (ctx) => {
    const { count } = await ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("batch", "onboarding").eq("status", "pending");
    if (!count) throw new Error("Nothing to review yet. Tell Navi a little about your week first, or choose “Do this later”.");
    await ctx.db.from("profiles").update({ onboarding_status: "reviewing" }).eq("id", ctx.userId);
    await setWelcomeStep(ctx, "review");
  });
}

/** "Do this later": use the app now, finish setup any time from Home or Settings. */
export async function skipWelcomeAction(step: string) {
  return act(async (ctx) => {
    const s = z.enum([...WELCOME_STEPS, "done"]).parse(step);
    await setWelcomeStep(ctx, s);
    await ctx.db.from("profiles").update({ onboarding_status: "skipped" }).eq("id", ctx.userId).in("onboarding_status", ["not_started", "in_progress", "reviewing"]);
  });
}
