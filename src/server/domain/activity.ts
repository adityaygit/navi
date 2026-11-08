import "server-only";
import type { Ctx } from "@/server/context";

// Tables an activity entry may point at and be reverted on.
const REVERTIBLE_TABLES = new Set([
  "tasks",
  "projects",
  "goals",
  "workspaces",
  "routines",
  "events",
  "plan_blocks",
  "memories",
  "notes",
  "milestones",
  // Planner v2: one-day facts, usual times, session changes, dependencies,
  // settings (B6: a free-time change can be undone), and whole planning runs.
  "day_exceptions",
  "availability_rules",
  "event_occurrence_overrides",
  "task_dependencies",
  "profiles",
  "plan_changesets",
]);

export type ActivityInput = {
  action: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  reversible?: boolean;
};

export async function logActivity(ctx: Ctx, input: ActivityInput): Promise<string | null> {
  const reversible = Boolean(input.reversible && input.entityType && REVERTIBLE_TABLES.has(input.entityType));
  const { data, error } = await ctx.db
    .from("activity_log")
    .insert({
      user_id: ctx.userId,
      actor: ctx.actor,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      summary: input.summary,
      before: input.before ?? null,
      after: input.after ?? null,
      reversible,
    })
    .select("id")
    .maybeSingle();
  // Logging must never break the user's action, but it should be visible in server logs.
  if (error || !data) {
    console.error("activity log insert failed:", error?.message ?? "no row");
    return null;
  }
  try {
    ctx.onActivity?.({ id: data.id, reversible });
  } catch {}
  return data.id as string;
}

/** Same value, allowing for equivalent spellings of times and timestamps. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "string" && typeof b === "string") {
    const time = /^\d{2}:\d{2}(:\d{2})?$/;
    if (time.test(a) && time.test(b)) return a.padEnd(8, ":00").slice(0, 8) === b.padEnd(8, ":00").slice(0, 8);
    if (a.includes("T") && b.includes("T")) {
      const ta = Date.parse(a);
      const tb = Date.parse(b);
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta === tb;
    }
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Undo a logged change: a creation is deleted, an update is restored to its
 * previous values. Only the columns captured in `before` are restored.
 *
 * The entry is claimed first (reverted_at set only if still empty), so two
 * taps can't both undo it; if undoing then fails, the claim is released. An
 * update is only undone while the item still has the values that change set:
 * if it was edited since, undoing would silently throw that edit away.
 */
export async function revertActivity(ctx: Ctx, activityId: string): Promise<string> {
  const { data: entry, error } = await ctx.db
    .from("activity_log")
    .select("*")
    .eq("id", activityId)
    .single();
  if (error || !entry) throw new Error("Activity entry not found");
  if (!entry.reversible) throw new Error("This change can't be undone automatically");
  if (entry.reverted_at) throw new Error("Already undone");
  if (!REVERTIBLE_TABLES.has(entry.entity_type)) throw new Error("Unsupported entity");
  const table = entry.entity_type as string;

  if (entry.before !== null && entry.after && typeof entry.after === "object") {
    const { data: current } = await ctx.db.from(table).select("*").eq("id", entry.entity_id).maybeSingle();
    if (!current) throw new Error("That item no longer exists, so there's nothing to undo");
    const changedSince = Object.entries(entry.after as Record<string, unknown>).some(([k, v]) => k in current && !sameValue(current[k], v));
    if (changedSince) throw new Error("It was changed again since, so undoing this would throw that away. Edit it directly instead.");
  }

  const { data: claimed } = await ctx.db
    .from("activity_log")
    .update({ reverted_at: new Date().toISOString() })
    .eq("id", activityId)
    .is("reverted_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) throw new Error("Already undone");

  try {
    if (table === "plan_changesets") {
      // A whole planning run: undone in one locked step, or not at all.
      const { revertChangeset } = await import("@/server/planner/plan-v2");
      await revertChangeset(ctx, entry.entity_id);
    } else if (entry.before === null) {
      const { error: delErr } = await ctx.db.from(table).delete().eq("id", entry.entity_id);
      if (delErr) throw new Error(delErr.message);
    } else {
      const restore = { ...(entry.before as Record<string, unknown>) };
      delete restore.id;
      delete restore.user_id;
      delete restore.created_at;
      delete restore.updated_at;
      const { error: upErr } = await ctx.db.from(table).update(restore).eq("id", entry.entity_id);
      if (upErr) throw new Error(upErr.message);
    }
  } catch (err) {
    await ctx.db.from("activity_log").update({ reverted_at: null }).eq("id", activityId);
    throw err;
  }
  await logActivity(ctx, {
    action: "revert",
    entityType: table,
    entityId: entry.entity_id,
    summary: `Undid: ${entry.summary}`,
  });
  return `Undid: ${entry.summary}`;
}

/**
 * Undo everything one action did, newest change first (e.g. a completed
 * recurring task: remove the next occurrence, then reopen it). Entries already
 * undone are skipped, so a second tap is harmless.
 */
export async function revertActivities(ctx: Ctx, ids: string[]): Promise<{ undone: number; message: string }> {
  const { data: entries } = await ctx.db.from("activity_log").select("id,reverted_at,created_at").in("id", ids);
  const open = (entries ?? []).filter((e) => !e.reverted_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!entries?.length) throw new Error("Nothing to undo");
  if (!open.length) return { undone: 0, message: "Already undone" };
  let undone = 0;
  for (const e of open) {
    try {
      await revertActivity(ctx, e.id);
      undone++;
    } catch (err) {
      if (err instanceof Error && err.message === "Already undone") continue;
      if (undone) throw new Error(`Partly undone (${undone} of ${open.length}): ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
  return { undone, message: "Undone" };
}
