"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiCtx, type Ctx } from "@/server/context";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { createTask, updateTask, completeTask, startFocus, endFocus } from "@/server/domain/tasks";
import { createEntity, deleteEntity, updateEntity, type EntityTable } from "@/server/domain/entities";
import {
  acceptMany,
  acceptProposal,
  editProposal,
  mergeProposalIntoTask,
  setProposalStatus,
} from "@/server/domain/proposals";
import { confirmMemory, correctMemory, deleteMemory, rejectMemory, addMemory } from "@/server/domain/memory";
import { decideApproval } from "@/server/domain/approvals";
import { revertActivity } from "@/server/domain/activity";
import { generateDayPlan, generateWeekPlan, recoverPlan, setBlockOutcome } from "@/server/planner/plan";
import {
  EventCreate,
  GoalCreate,
  MemoryCreate,
  MilestoneCreate,
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

// Server actions for every dashboard control. Each one goes through the same
// domain functions the AI tools use, then refreshes all views.

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false, error: string };

async function act<T>(fn: (ctx: Ctx) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const ctx = await requireApiCtx();
    const data = await fn(ctx);
    revalidatePath("/", "layout");
    return { ok: true, data, message };
  } catch (err) {
    const error = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}

// ---- tasks & focus ---------------------------------------------------------
export async function createTaskAction(input: unknown) {
  return act((ctx) => createTask(ctx, TaskCreate.parse(input)), "Task added");
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
export async function endFocusAction(id: string, outcome: "completed" | "progress" | "interrupted" | "abandoned", note?: string | null) {
  return act((ctx) => endFocus(ctx, id, outcome, note));
}

// ---- structure -------------------------------------------------------------
const CREATE_SCHEMAS: Partial<Record<EntityTable, z.ZodTypeAny>> = {
  workspaces: WorkspaceCreate,
  goals: GoalCreate,
  projects: ProjectCreate,
  milestones: MilestoneCreate,
  routines: RoutineCreate,
  events: EventCreate,
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
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => !forbidden.includes(k)));
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
export async function acceptManyAction(ids: string[]) {
  return act((ctx) => acceptMany(ctx, ids));
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
export async function planDayAction(date?: string) {
  return act((ctx) => generateDayPlan(ctx, date));
}
export async function planWeekAction() {
  return act((ctx) => generateWeekPlan(ctx));
}
export async function blockOutcomeAction(id: string, status: "done" | "partial" | "skipped" | "missed" | "rest" | "interrupted" | "planned", reason?: string | null) {
  return act((ctx) => setBlockOutcome(ctx, id, status, reason));
}
export async function recoverPlanAction(input: { description: string; category: "interruption" | "rest" | "missing_info" | "estimate" | "external" | "other"; availableFrom?: string | null }) {
  return act((ctx) => recoverPlan(ctx, input));
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
export async function decideApprovalAction(id: string, decision: "approve" | "reject") {
  return act((ctx) => decideApproval(ctx, id, decision, createSupabaseAdmin()));
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
    // On-demand reviews replace today's stored one of the same kind (data may have changed).
    const { error } = await ctx.db
      .from("briefings")
      .upsert({ user_id: ctx.userId, kind, local_date: date, title: b.title, body: b.body, data: b.data, generated_by: "rules", read_at: null }, { onConflict: "user_id,kind,local_date" });
    if (error) throw new Error(error.message);
    return b;
  });
}
