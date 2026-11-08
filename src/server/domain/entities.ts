import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { logActivity, sameValue } from "./activity";
import { requestApproval } from "./approvals";
import { fieldWords } from "@/lib/plain-text";

// Generic create/update/delete for the user's structured items, with an
// activity-log entry for every change so it can be reviewed and undone.
// When Navi (not the user) attempts a consequential change, it becomes an
// approval request instead of executing.

export type EntityTable =
  | "tasks"
  | "projects"
  | "goals"
  | "workspaces"
  | "routines"
  | "events"
  | "milestones"
  | "notes"
  | "plan_blocks";

export const LABEL: Record<EntityTable, string> = {
  tasks: "task",
  projects: "project",
  goals: "goal",
  workspaces: "workspace",
  routines: "routine",
  events: "event",
  milestones: "milestone",
  notes: "note",
  plan_blocks: "plan block",
};

export function nameOf(row: Record<string, unknown>): string {
  return String(row.title ?? row.name ?? row.body ?? "item").slice(0, 80);
}

export async function createEntity<T = Record<string, unknown>>(
  ctx: Ctx,
  table: EntityTable,
  values: Record<string, unknown>,
  /**
   * `id`: a client-chosen uuid for the new row, so a retried create is
   * idempotent: if a row with this id already exists and is the person's, it
   * is returned as is (nothing new is created or logged).
   */
  opts: { summary?: string; id?: string } = {},
): Promise<T> {
  const { data, error } = await ctx.db
    .from(table)
    .insert({ ...values, ...(opts.id ? { id: opts.id } : {}), user_id: ctx.userId })
    .select()
    .single();
  if (error && error.code === "23505" && opts.id) {
    const { data: existing, error: readErr } = await ctx.db.from(table).select("*").eq("id", opts.id).eq("user_id", ctx.userId).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (existing) return existing as T;
    throw new Error(`Could not create ${LABEL[table]}: that id is already in use`);
  }
  if (error) throw new Error(`Could not create ${LABEL[table]}: ${error.message}`);
  await logActivity(ctx, {
    action: "create",
    entityType: table,
    entityId: data.id,
    summary: opts.summary ?? `Created ${LABEL[table]} “${nameOf(data)}”`,
    before: null,
    after: data,
    reversible: true,
  });
  return data as T;
}

export async function getEntity<T = Record<string, unknown>>(ctx: Ctx, table: EntityTable, id: string): Promise<T> {
  const { data, error } = await ctx.db.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`That ${LABEL[table]} doesn't exist (or isn't yours)`);
  return data as T;
}

/** Does the patch actually change any of these columns? (Unknown spellings count as a change.) */
function changes(before: Record<string, unknown>, patch: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => k in patch && !sameValue(patch[k], before[k]));
}

/**
 * Changes that Navi must not make on its own. Returns a reason or null.
 * Judged against the row as it is now, so a protection can't be removed in
 * one step and the protected value changed in the next (e.g. first clearing
 * due_is_hard, then moving the deadline): touching the protection itself
 * needs approval too.
 */
function needsApproval(table: EntityTable, before: Record<string, unknown>, patch: Record<string, unknown>): string | null {
  if (table === "tasks") {
    if (before.due_is_hard && changes(before, patch, ["due_at", "due_is_hard"])) return "changes a hard deadline";
    if (patch.status === "cancelled" && before.status !== "cancelled") return "cancels a task";
    if (before.commitment === "must" && "commitment" in patch && patch.commitment !== "must") return "lowers a must-complete task";
  }
  if (table === "routines") {
    const level = { fixed: 3, protected: 2, flexible: 1 } as Record<string, number>;
    if (before.protection && patch.protection && (level[String(patch.protection)] ?? 0) < (level[String(before.protection)] ?? 0)) return "lowers a routine's protection";
    if (before.kind === "sleep" && changes(before, patch, ["start_time", "days", "duration_minutes", "active", "protection", "kind"])) return "changes your sleep";
    if (before.protection === "fixed" && !before.is_fixed && changes(before, patch, ["start_time", "days", "duration_minutes", "active"])) return "changes a fixed routine";
  }
  if (table === "events") {
    if (before.external_ref) return "modifies an event owned by a connected external calendar";
    if (patch.status === "cancelled" && before.status !== "cancelled") return "cancels a commitment";
    // Events are fixed commitments: their times, repetition and status are the user's call.
    if (changes(before, patch, ["starts_at", "ends_at", "recurrence", "status"])) return "changes a fixed commitment";
  }
  if (table === "routines" && before.is_fixed && changes(before, patch, ["start_time", "days", "duration_minutes", "active", "is_fixed"])) {
    return "changes a fixed routine";
  }
  if (table === "plan_blocks") {
    if (before.is_flexible === false && changes(before, patch, ["starts_at", "ends_at", "plan_date", "is_flexible"])) return "moves a fixed block";
    if (patch.status === "done" && before.status !== "done") return "marks scheduled work as completed";
  }
  // Only the user decides that work is finished.
  if (table === "projects" && patch.status === "done" && before.status !== "done") return "marks a project as done";
  if (table === "goals" && patch.status === "achieved" && before.status !== "achieved") return "marks a goal as achieved";
  if (table === "milestones" && changes(before, patch, ["done_at"])) return "changes whether a milestone is done";
  if ((table === "projects" || table === "goals") && (patch.status === "archived" || patch.status === "dropped") && patch.status !== before.status) {
    return "drops a project or goal";
  }
  if (table === "workspaces" && patch.status === "archived" && before.status !== "archived") return "archives a workspace";
  return null;
}

export type UpdateResult<T> =
  | { kind: "updated"; row: T }
  | { kind: "approval_requested"; approvalId: string; reason: string };

/** The row already had the value an update was guarded against (`unless`). */
export class AlreadyChangedError extends Error {}

export async function updateEntity<T = Record<string, unknown>>(
  ctx: Ctx,
  table: EntityTable,
  id: string,
  patch: Record<string, unknown>,
  /** `unless`: apply only if the row doesn't (still) have these values, atomically. */
  opts: { summary?: string; unless?: Record<string, string> } = {},
): Promise<UpdateResult<T>> {
  const before = await getEntity<Record<string, unknown>>(ctx, table, id);
  if (ctx.actor === "navi") {
    if (table === "tasks" && patch.status === "done" && before.status !== "done") throw new Error("Only you can mark a task done.");
    const rule = needsApproval(table, before, patch);
    const reason = rule ? `it ${rule}` : ctx.autonomy === "ask" ? "you chose to approve every change" : null;
    if (reason) {
      // `expect`: the values this change was based on. If the item no longer
      // has them when the person approves, the action expires instead of
      // overwriting their newer edit.
      const expect: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) expect[k] = before[k] ?? null;
      const approval = await requestApproval(ctx, {
        actionType: `internal.update.${table}`,
        summary: opts.summary ?? `${patch.status === "cancelled" ? "Cancel" : "Update"} ${LABEL[table]} “${nameOf(before)}”`,
        details: { op: "update", table, id, patch, reason, subject: nameOf(before), expect },
      });
      return { kind: "approval_requested", approvalId: approval.id, reason };
    }
  }
  let query = ctx.db.from(table).update(patch).eq("id", id);
  for (const [k, v] of Object.entries(opts.unless ?? {})) query = query.neq(k, v);
  const { data, error } = await query.select().maybeSingle();
  if (error) throw new Error(`Could not update ${LABEL[table]}: ${error.message}`);
  if (!data) {
    if (opts.unless) throw new AlreadyChangedError(`This ${LABEL[table]} was already updated.`);
    throw new Error(`Could not update ${LABEL[table]}: not found`);
  }
  const changedKeys = Object.keys(patch);
  const prior: Record<string, unknown> = {};
  for (const k of changedKeys) prior[k] = before[k];
  if (table === "tasks" && patch.status !== before.status) {
    if (patch.status === "done") await settleTaskBlocks(ctx, id, "done");
    else if (patch.status === "cancelled") await settleTaskBlocks(ctx, id, "drop");
  }
  await logActivity(ctx, {
    action: "update",
    entityType: table,
    entityId: id,
    // Readable in Activity: what changed in words, never column names.
    summary: opts.summary ?? (table === "plan_blocks" && typeof patch.starts_at === "string" ? `Moved “${nameOf(data)}” to ${DateTime.fromISO(patch.starts_at, { setZone: true }).setZone(ctx.timezone).toFormat("ccc h:mm a")}` : `Changed the ${fieldWords(changedKeys)} of “${nameOf(data)}”`),
    before: prior,
    after: patch,
    reversible: true,
  });
  return { kind: "updated", row: data as T };
}

export type DeleteResult = { kind: "deleted" } | { kind: "approval_requested"; approvalId: string };

export async function deleteEntity(ctx: Ctx, table: EntityTable, id: string): Promise<DeleteResult> {
  const before = await getEntity<Record<string, unknown>>(ctx, table, id);
  if (ctx.actor === "navi") {
    const approval = await requestApproval(ctx, {
      actionType: `internal.delete.${table}`,
      summary: `Delete ${LABEL[table]} “${nameOf(before)}”`,
      details: { op: "delete", table, id, subject: nameOf(before), reason: "deleting can't be undone" },
    });
    return { kind: "approval_requested", approvalId: approval.id };
  }
  if (table === "tasks") await settleTaskBlocks(ctx, id, "drop");
  const { error } = await ctx.db.from(table).delete().eq("id", id);
  if (error) throw new Error(`Could not delete ${LABEL[table]}: ${error.message}`);
  await logActivity(ctx, {
    action: "delete",
    entityType: table,
    entityId: id,
    summary: `Deleted ${LABEL[table]} “${nameOf(before)}”`,
    before,
    reversible: false,
  });
  return { kind: "deleted" };
}

/**
 * Keeps the plan in step with a task that is finished, cancelled or deleted:
 * its still-open blocks no longer ask for work. Finished work counts as done
 * today; later blocks for it, or any open block of a dropped task, are removed.
 * Blocks with a recorded outcome stay as history.
 */
async function settleTaskBlocks(ctx: Ctx, taskId: string, outcome: "done" | "drop") {
  const open = ["planned", "in_progress"];
  if (outcome === "done") {
    const today = DateTime.now().setZone(ctx.timezone).toISODate()!;
    await ctx.db.from("plan_blocks").update({ status: "done" }).eq("user_id", ctx.userId).eq("task_id", taskId).in("status", open).lte("plan_date", today);
    await ctx.db.from("plan_blocks").delete().eq("user_id", ctx.userId).eq("task_id", taskId).in("status", open).gt("plan_date", today);
  } else {
    await ctx.db.from("plan_blocks").delete().eq("user_id", ctx.userId).eq("task_id", taskId).in("status", open);
  }
}
