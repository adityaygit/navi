import "server-only";
import type { Ctx } from "@/server/context";
import type { Task } from "@/lib/types";
import { awaitingTriage } from "@/lib/triage";
import { completeTask, updateTask } from "./tasks";
import { setItemHidden } from "@/server/integrations/connections";

// The person's decision about overdue imported work held for triage (see
// lib/triage.ts). One path for the chat tool, the web Today screen and the
// phone app. The result is read back from the database, never assumed.

export type TriageDecision = "handed_in" | "not_needed";
type Row = Pick<Task, "id" | "title" | "status" | "source" | "external_ref" | "due_at" | "commitment">;

/** Open imported tasks past their deadline (what Today shows as "needs a decision"). */
export async function triageList(ctx: Ctx): Promise<Row[]> {
  const { data, error } = await ctx.db.from("tasks").select("id,title,status,source,external_ref,due_at,commitment").eq("source", "external").in("status", ["todo", "in_progress", "blocked"]).order("due_at");
  if (error) throw new Error(`Could not read imported tasks: ${error.message}`);
  const now = Date.now();
  return ((data ?? []) as Row[]).filter((t) => awaitingTriage(t, now));
}

export type TriageResult = { decision: TriageDecision; asked: number; changed: Row[]; notChanged: Row[]; unknown: string[] };

/**
 * Apply a decision to some (ids) or all (all=true) overdue imports. Ids that
 * aren't the person's open imported tasks are reported, never touched (RLS
 * also hides other people's rows). Runs as the person: only they can say
 * their work is handed in.
 */
export async function resolveTriage(ctx: Ctx, decision: TriageDecision, target: { ids?: string[] | null; all?: boolean | null }): Promise<TriageResult> {
  const ids = target.ids ?? [];
  const { data } = await ctx.db.from("tasks").select("id,title,status,source,external_ref,due_at,commitment").eq("source", "external").in("status", ["todo", "in_progress", "blocked"]);
  const now = Date.now();
  const pool = ((data ?? []) as Row[]).filter((t) => awaitingTriage(t, now) || ids.includes(t.id));
  const wanted = target.all ? pool : pool.filter((t) => ids.includes(t.id));
  const unknown = ids.filter((id) => !pool.some((t) => t.id === id));
  const asUser: Ctx = { ...ctx, actor: "user" };
  for (const t of wanted) {
    try {
      if (decision === "handed_in") await completeTask(asUser, t.id);
      else {
        // Set aside through the integration (hidden, reversible on the Canvas page) when it's still linked.
        const { data: item } = await ctx.db.from("external_items").select("id").eq("task_id", t.id).maybeSingle();
        if (item) await setItemHidden(asUser, item.id, true);
        else await updateTask(asUser, t.id, { status: "cancelled" });
      }
    } catch {
      // Reported below from the read-back.
    }
  }
  const target_status = decision === "handed_in" ? "done" : "cancelled";
  const { data: after } = wanted.length ? await ctx.db.from("tasks").select("id,status").in("id", wanted.map((t) => t.id)) : { data: [] };
  const done = new Set(((after ?? []) as { id: string; status: string }[]).filter((t) => t.status === target_status).map((t) => t.id));
  return { decision, asked: wanted.length, changed: wanted.filter((t) => done.has(t.id)), notChanged: wanted.filter((t) => !done.has(t.id)), unknown };
}
