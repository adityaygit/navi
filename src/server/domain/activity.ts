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

export async function logActivity(ctx: Ctx, input: ActivityInput): Promise<void> {
  const { error } = await ctx.db.from("activity_log").insert({
    user_id: ctx.userId,
    actor: ctx.actor,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    summary: input.summary,
    before: input.before ?? null,
    after: input.after ?? null,
    reversible: Boolean(input.reversible && input.entityType && REVERTIBLE_TABLES.has(input.entityType)),
  });
  // Logging must never break the user's action, but it should be visible in server logs.
  if (error) console.error("activity log insert failed:", error.message);
}

/**
 * Undo a logged change: a creation is deleted, an update is restored to its
 * previous values. Only the columns captured in `before` are restored.
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
  if (entry.before === null) {
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
  await ctx.db.from("activity_log").update({ reverted_at: new Date().toISOString() }).eq("id", activityId);
  await logActivity(ctx, {
    action: "revert",
    entityType: table,
    entityId: entry.entity_id,
    summary: `Undid: ${entry.summary}`,
  });
  return `Undid: ${entry.summary}`;
}
