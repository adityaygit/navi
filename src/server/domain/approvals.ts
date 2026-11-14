import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import type { Approval, Task } from "@/lib/types";
import type { ActionField, ActionStatus, ActionView } from "@/lib/actions";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { logActivity, sameValue } from "./activity";
import { integrations } from "@/server/integrations";
import { ENTITY_PATCHES, ProfileUpdate, TaskCreate, TaskUpdate, compact } from "./schemas";
import type { EntityTable } from "./entities";

// Actions that wait for the person's OK. Anything consequential (external
// effects, deadline changes, cancelling or deleting, and every change when the
// person asked Navi to check first) is stored here with the exact operation
// that will run. It appears as a card in the chat that proposed it (and in
// Activity), the person can change it by talking to Navi, and it runs only
// when they tap Approve.
//
// State machine (see src/lib/actions.ts): proposed → approved → executing →
// completed | failed; proposed → declined | expired. Every move is a
// conditional update on the current state through the server's client (people
// can't update this table under RLS), and only approved → executing runs the
// operation, so it runs at most once however often Approve is tapped, retried
// or replayed. The operation is validated again and run with the person's own
// permissions at that moment; if what it was based on changed meanwhile, it
// expires instead of overwriting their newer edit.

export type ApprovalRequest = {
  actionType: string;
  summary: string;
  details: Record<string, unknown>;
  idempotencyKey?: string;
};

/** How long a proposal stays open without an answer. */
export const ACTION_TTL_HOURS = 72;
/** An action still "executing" after this long is reported as unconfirmed. */
const STUCK_MS = 2 * 60_000;

const TABLE_LABEL: Record<string, string> = {
  tasks: "task", projects: "project", goals: "goal", workspaces: "area", routines: "routine", events: "event", milestones: "milestone", notes: "note", plan_blocks: "plan block",
};

/** The action no longer matches the item it was based on; it expires instead of running. */
class StaleActionError extends Error {}

function keyFor(actionType: string, details: Record<string, unknown>): string {
  return createHash("sha256").update(actionType + JSON.stringify(details)).digest("hex").slice(0, 32);
}

function expiresAt(): string {
  return new Date(Date.now() + ACTION_TTL_HOURS * 3600_000).toISOString();
}

function pastExpiry(a: Pick<Approval, "status" | "expires_at">): boolean {
  return a.status === "proposed" && !!a.expires_at && Date.parse(a.expires_at) <= Date.now();
}

function tell(ctx: Ctx, id: string) {
  try {
    ctx.onAction?.(id);
  } catch {}
}

async function findOpen(ctx: Ctx, key: string): Promise<Approval | null> {
  const { data } = await ctx.db
    .from("approvals")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("idempotency_key", key)
    .in("status", ["proposed", "approved", "executing"])
    .limit(1)
    .maybeSingle();
  return (data as Approval | null) ?? null;
}

async function load(admin: SupabaseClient, userId: string, id: string): Promise<Approval | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("approvals").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return (data as Approval | null) ?? null;
}

/** Moves an action from one state to another only if it is still in `from`. Returns the new row, or null. */
async function move(admin: SupabaseClient, a: Approval, from: ActionStatus | ActionStatus[], set: Partial<Approval>, revision?: number): Promise<Approval | null> {
  let q = admin
    .from("approvals")
    .update({ ...set, updated_at: new Date().toISOString() })
    .eq("id", a.id)
    .eq("user_id", a.user_id);
  if (revision !== undefined) q = q.eq("revision", revision);
  q = Array.isArray(from) ? q.in("status", from) : q.eq("status", from);
  const { data, error } = await q.select().maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Approval | null) ?? null;
}

async function expire(ctx: Ctx, admin: SupabaseClient, a: Approval, why: string): Promise<Approval> {
  const done = await move(admin, a, "proposed", { status: "expired", error: why });
  if (done) await logActivity(ctx, { action: "approval_expired", entityType: "approvals", entityId: a.id, summary: `Expired: ${a.summary} — ${why}` });
  return done ?? ((await load(admin, a.user_id, a.id)) as Approval);
}

/**
 * Propose an action. The same open action proposed again (a retried tool
 * call, a reconnect, the same thing said twice) returns the existing one: the
 * database allows one open action per key, so even two requests at the same
 * instant make one card.
 */
export async function requestApproval(ctx: Ctx, req: ApprovalRequest): Promise<Approval> {
  const key = req.idempotencyKey ?? keyFor(req.actionType, req.details);
  const existing = await findOpen(ctx, key);
  if (existing && !pastExpiry(existing)) {
    tell(ctx, existing.id);
    return existing;
  }
  if (existing) await expire(ctx, createSupabaseAdmin(), existing, "It waited too long without an answer.");

  const { data, error } = await ctx.db
    .from("approvals")
    .insert({
      user_id: ctx.userId,
      action_type: req.actionType,
      summary: req.summary,
      details: req.details,
      idempotency_key: key,
      status: "proposed",
      conversation_id: ctx.conversationId ?? null,
      expires_at: expiresAt(),
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      const winner = await findOpen(ctx, key);
      if (winner) {
        tell(ctx, winner.id);
        return winner;
      }
    }
    throw new Error(`Could not create approval request: ${error.message}`);
  }
  await logActivity(ctx, { action: "approval_requested", entityType: "approvals", entityId: data.id, summary: `Asked for approval: ${req.summary}` });
  tell(ctx, data.id);
  return data as Approval;
}

/**
 * Approve or decline. Always answers with the action as it now really is, so
 * a second tap, a retry after a dropped connection or a tap on a card that
 * was already decided elsewhere just shows the current state instead of
 * failing or running again.
 */
export async function decideApproval(
  ctx: Ctx,
  approvalId: string,
  decision: "approve" | "reject",
  admin: SupabaseClient = createSupabaseAdmin(),
  /** The revision the person was looking at. If Navi changed the action since, nothing is approved and the new version is returned to look at. */
  seenRevision?: number,
): Promise<Approval> {
  let row = await load(admin, ctx.userId, approvalId);
  if (!row) throw new Error("That action doesn't exist (or isn't yours)");
  tell(ctx, row.id);
  if (decision === "approve" && seenRevision !== undefined && row.status === "proposed" && row.revision !== seenRevision) return row;
  const now = new Date().toISOString();
  const reload = async () => (await load(admin, ctx.userId, approvalId)) as Approval;

  if (decision === "reject") {
    if (row.status !== "proposed") return row;
    if (pastExpiry(row)) return expire(ctx, admin, row, "It waited too long without an answer.");
    const declined = await move(admin, row, "proposed", { status: "declined", decided_at: now });
    if (!declined) return reload();
    const det = row.details as Record<string, unknown>;
    if (det?.op === "apply_plan" && typeof det.changeset_id === "string") {
      await ctx.db.from("plan_changesets").update({ status: "expired" }).eq("id", det.changeset_id).eq("status", "proposed");
    }
    await logActivity(ctx, { action: "approval_rejected", entityType: "approvals", entityId: row.id, summary: `Declined: ${row.summary}` });
    return declined;
  }

  if (row.status === "proposed") {
    if (pastExpiry(row)) return expire(ctx, admin, row, "It waited too long without an answer.");
    const approved = await move(admin, row, "proposed", { status: "approved", decided_at: now }, seenRevision);
    row = approved ?? (await reload());
  }
  // "approved" but not yet running: this tap (or a retry after a crash) runs it.
  if (row.status !== "approved") return row;
  const claimed = await move(admin, row, "approved", { status: "executing" });
  if (!claimed) return reload();
  return execute(ctx, admin, claimed);
}

async function execute(ctx: Ctx, admin: SupabaseClient, approval: Approval): Promise<Approval> {
  const undo: string[] = [];
  // The person approved it, so it runs as them, with their database permissions.
  const asUser: Ctx = {
    ...ctx,
    actor: "user",
    autonomy: undefined,
    onAction: undefined,
    onActivity: (e) => {
      if (e.reversible) undo.push(e.id);
    },
  };
  try {
    const { summary } = await executeApproved(asUser, approval);
    const done = await move(admin, approval, "executing", { status: "completed", executed_at: new Date().toISOString(), result: { summary, undo }, error: null });
    await logActivity(ctx, { action: "approval_executed", entityType: "approvals", entityId: approval.id, summary: `Approved and done: ${summary}` });
    return done ?? ((await load(admin, ctx.userId, approval.id)) as Approval);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stale = err instanceof StaleActionError;
    const done = await move(admin, approval, "executing", { status: stale ? "expired" : "failed", error: message });
    await logActivity(ctx, {
      action: stale ? "approval_expired" : "approval_failed",
      entityType: "approvals",
      entityId: approval.id,
      summary: `${stale ? "Approved but out of date, so not done" : "Approved but failed"}: ${approval.summary} — ${message}`,
    });
    return done ?? ((await load(admin, ctx.userId, approval.id)) as Approval);
  }
}

/** A stored patch, validated again now (the rules may be stricter than when it was proposed). */
function validPatch(table: EntityTable, patch: Record<string, unknown>): Record<string, unknown> {
  if (table === "tasks") {
    const { completed_at: _derived, ...rest } = patch;
    void _derived;
    const parsed = compact(TaskUpdate.strict().parse(rest));
    if (parsed.status === "done") throw new Error("Only you can mark a task done.");
    return parsed;
  }
  const schema = ENTITY_PATCHES[table as keyof typeof ENTITY_PATCHES];
  if (!schema) throw new Error(`Can't change ${table}`);
  return compact(schema.parse(patch) as Record<string, unknown>);
}

function checkStillTheSame(current: Record<string, unknown>, expect: unknown, label: string) {
  if (!expect || typeof expect !== "object") return;
  for (const [k, v] of Object.entries(expect as Record<string, unknown>)) {
    if (!sameValue(current[k], v)) throw new StaleActionError(`The ${label} changed since Navi asked (${k.replace(/_/g, " ")}), so nothing was done. Ask again if you still want it.`);
  }
}

async function executeApproved(ctx: Ctx, approval: Approval): Promise<{ summary: string }> {
  const d = approval.details as Record<string, unknown>;
  if (approval.action_type.startsWith("internal.")) {
    const { updateEntity, deleteEntity } = await import("./entities");
    const tasks = await import("./tasks");
    const table = d.table as EntityTable;
    const label = TABLE_LABEL[table] ?? "item";
    const current = async () => {
      if (!d.id) return null;
      const { data } = await ctx.db.from(table).select("*").eq("id", String(d.id)).maybeSingle();
      if (!data) throw new StaleActionError(`That ${label} no longer exists, so nothing was done.`);
      return data as Record<string, unknown>;
    };
    const name = (row: Record<string, unknown> | null) => String(row?.title ?? row?.name ?? d.subject ?? label).slice(0, 80);

    switch (d.op) {
      case "apply_plan": {
        // A plan Navi proposed (planner v2): applied exactly as shown, or not
        // at all if the plan changed since (then the card expires).
        const { applyChangeset, StalePlanError } = await import("@/server/planner/plan-v2");
        try {
          await applyChangeset(ctx, String(d.changeset_id), `Applied after you approved: ${approval.summary}`);
        } catch (err) {
          if (err instanceof StalePlanError) throw new StaleActionError(`${err.message}, so nothing was changed. Ask Navi for a fresh plan.`);
          throw err;
        }
        return { summary: `Applied: ${approval.summary}` };
      }
      case "create": {
        if (table !== "tasks") throw new Error(`Can't create ${table} this way`);
        const values = TaskCreate.parse(d.values);
        const t = await tasks.createTask(ctx, values);
        await logActivity(ctx, { action: "explicit_command", entityType: "tasks", entityId: t.id, summary: `Added after you approved: “${t.title}”` });
        return { summary: `Created task “${t.title}”${t.due_at ? `, ${dueWords(t, ctx.timezone)}` : ""}` };
      }
      case "update": {
        const patch = validPatch(table, d.patch as Record<string, unknown>);
        const row = await current();
        checkStillTheSame(row!, d.expect, label);
        if (table === "tasks") await tasks.updateTask(ctx, String(d.id), patch);
        else await updateEntity(ctx, table, String(d.id), patch, { summary: approval.summary });
        return { summary: patch.status === "cancelled" ? `Cancelled ${label} “${name(row)}”` : `Updated ${label} “${name(row)}”` };
      }
      case "complete": {
        const row = await current();
        if (row!.status === "done") return { summary: `“${name(row)}” was already done` };
        await tasks.completeTask(ctx, String(d.id), typeof d.actual_minutes === "number" ? d.actual_minutes : null);
        return { summary: `Marked “${name(row)}” done` };
      }
      case "delete": {
        const row = await current();
        await deleteEntity(ctx, table, String(d.id));
        return { summary: `Deleted ${label} “${name(row)}”` };
      }
      case "settings": {
        const patch = compact(ProfileUpdate.strict().parse(d.patch));
        if (patch.timezone && !DateTime.now().setZone(patch.timezone).isValid) throw new Error(`Unknown time zone ${patch.timezone}`);
        const { error } = await ctx.db.from("profiles").update(patch).eq("id", ctx.userId);
        if (error) throw new Error(error.message);
        await logActivity(ctx, { action: "settings_updated", summary: `Updated settings after you approved: ${Object.keys(patch).join(", ")}` });
        return { summary: `Updated your settings (${Object.keys(patch).map((k) => k.replace(/_/g, " ")).join(", ")})` };
      }
    }
    throw new Error(`Unknown internal operation ${String(d.op)}`);
  }
  if (approval.action_type.startsWith("external.")) {
    const integration = integrations.find((i) => approval.action_type.startsWith(`external.${i.id}.`));
    if (!integration || !integration.isConnected()) {
      // Never pretend an external action happened.
      throw new Error("That service isn't connected, so nothing was sent or changed.");
    }
    const r = await integration.execute(approval.action_type, d);
    return { summary: typeof r.summary === "string" ? r.summary : `Done: ${approval.summary}` };
  }
  throw new Error(`Unknown action type ${approval.action_type}`);
}

/**
 * The person changed a waiting action by talking to Navi ("make it Friday
 * instead"). The same card updates in place (its revision goes up) instead of
 * a second card appearing; the change is validated exactly like the original.
 */
export async function reviseApproval(ctx: Ctx, approvalId: string, changes: Record<string, unknown>, admin: SupabaseClient = createSupabaseAdmin()): Promise<Approval> {
  const row = await load(admin, ctx.userId, approvalId);
  if (!row) throw new Error("That action doesn't exist (or isn't yours)");
  if (row.status !== "proposed") throw new Error(`That action is already ${row.status}, so it can't be changed. Propose a new one if needed.`);
  if (pastExpiry(row)) {
    await expire(ctx, admin, row, "It waited too long without an answer.");
    throw new Error("That action expired, so it can't be changed. Propose it again if still wanted.");
  }
  const d = { ...(row.details as Record<string, unknown>) };
  let summary = row.summary;
  if (!Object.keys(changes).length) throw new Error("No changes given.");

  if (row.action_type.startsWith("external.")) {
    const { exact_description, parameters, ...rest } = changes as { exact_description?: unknown; parameters?: unknown };
    if (typeof exact_description !== "string" || exact_description.trim().length < 10) {
      throw new Error("For an outside action, give exact_description: the full new description of exactly what will happen.");
    }
    Object.assign(d, typeof parameters === "object" && parameters ? parameters : {}, rest);
    summary = exact_description.trim().slice(0, 1000);
  } else {
    const table = d.table as EntityTable;
    switch (d.op) {
      case "create": {
        const values = compact(TaskCreate.parse({ ...(d.values as Record<string, unknown>), ...changes }));
        d.values = values;
        d.subject = values.title;
        summary = `Create task “${String(values.title).slice(0, 80)}”`;
        break;
      }
      case "update": {
        const patch = validPatch(table, { ...(d.patch as Record<string, unknown>), ...changes });
        // New fields need their current value recorded, like the original ones.
        const { data: item } = await ctx.db.from(table).select("*").eq("id", String(d.id)).maybeSingle();
        if (!item) throw new Error(`That ${TABLE_LABEL[table] ?? "item"} no longer exists.`);
        const expect = { ...((d.expect as Record<string, unknown>) ?? {}) };
        for (const k of Object.keys(patch)) if (!(k in expect)) expect[k] = item[k] ?? null;
        d.patch = patch;
        d.expect = expect;
        break;
      }
      case "complete": {
        const m = (changes as { actual_minutes?: unknown }).actual_minutes;
        if (Object.keys(changes).some((k) => k !== "actual_minutes") || (m != null && (typeof m !== "number" || m < 1 || m > 1440))) {
          throw new Error("Only actual_minutes (1–1440) can change on marking something done.");
        }
        d.actual_minutes = m ?? null;
        break;
      }
      case "settings":
        d.patch = compact(ProfileUpdate.strict().parse({ ...(d.patch as Record<string, unknown>), ...changes }));
        break;
      default:
        throw new Error("A deletion has nothing to change. If they don't want it, decline it.");
    }
  }

  const base = { details: d, summary, revision: row.revision + 1, expires_at: expiresAt() };
  let updated = await move(admin, row, "proposed", { ...base, idempotency_key: keyFor(row.action_type, d) }).catch(async (err: Error) => {
    // An identical open action already exists: keep this card's key.
    if (/duplicate key|approvals_open_key/.test(err.message)) return move(admin, row, "proposed", base);
    throw err;
  });
  if (!updated) throw new Error("That action was decided just now, so it can't be changed.");
  updated = updated as Approval;
  await logActivity(ctx, { action: "approval_revised", entityType: "approvals", entityId: row.id, summary: `Changed before approval: ${summary}` });
  tell(ctx, row.id);
  return updated;
}

// ---- views --------------------------------------------------------------------

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesWords(m: number): string {
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

function when(iso: string, zone: string): string {
  const d = DateTime.fromISO(iso).setZone(zone);
  if (!d.isValid) return iso;
  return d.hour === 23 && d.minute === 59 ? d.toFormat("ccc LLL d") : d.toFormat("ccc LLL d, h:mm a");
}

function dueWords(t: Pick<Task, "due_at" | "due_is_hard">, zone: string): string {
  return t.due_at ? `due ${when(t.due_at, zone)}${t.due_is_hard ? " (hard deadline)" : ""}` : "no due date";
}

const FIELD_LABEL: Record<string, string> = {
  title: "Title", name: "Name", notes: "Notes", body: "Text", priority: "Priority", due_at: "Due", due_is_hard: "Deadline", estimate_minutes: "Estimate", status: "Status", blocker: "Blocked on",
  starts_at: "Starts", ends_at: "Ends", start_time: "Time", days: "Days", duration_minutes: "Length", is_fixed: "Time can move", is_flexible: "Can move", plan_date: "Day", recurrence: "Repeats",
  location: "Where", target_date: "Target date", due_date: "Due", objective: "Objective", done_at: "Done", active: "Active", timezone: "Time zone", display_name: "Name",
  quiet_hours_start: "Quiet from", quiet_hours_end: "Quiet until", morning_briefing_time: "Morning briefing", evening_review_time: "Evening review", availability: "Free for work", actual_minutes: "Time spent",
};

function valueWords(key: string, v: unknown, zone: string): string {
  if (v === null || v === undefined || v === "") return "none";
  if (key === "priority" && typeof v === "number") return `P${v}${v === 1 ? " (highest)" : v === 4 ? " (lowest)" : ""}`;
  if (key === "due_is_hard") return v ? "hard deadline" : "flexible";
  if (key === "is_fixed") return v ? "no (fixed)" : "yes";
  if (key === "is_flexible") return v ? "yes" : "no (fixed)";
  if ((key.endsWith("_minutes") || key === "duration_minutes") && typeof v === "number") return minutesWords(v);
  if (key === "days" && Array.isArray(v)) return v.map((n) => WEEKDAY[Number(n)] ?? n).join(", ");
  if (key === "recurrence" && typeof v === "object") {
    const r = v as { freq?: string; days?: number[] | null };
    return r.freq === "daily" ? "daily" : `weekly${r.days?.length ? ` on ${r.days.map((n) => WEEKDAY[n]).join(", ")}` : ""}`;
  }
  if (key === "availability" && Array.isArray(v)) return v.map((w: { days: number[]; start: string; end: string }) => `${w.days.map((n) => WEEKDAY[n]).join("/")} ${w.start}–${w.end}`).join("; ");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return when(v, zone);
  if (typeof v === "string" && /^\d{2}:\d{2}/.test(v)) return DateTime.fromFormat(v.slice(0, 5), "HH:mm").toFormat("h:mm a");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 120);
  const s = String(v);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

function fieldsOf(values: Record<string, unknown>, zone: string, before?: Record<string, unknown>, skip: string[] = []): ActionField[] {
  const out: ActionField[] = [];
  const v = { ...values };
  // A due date and whether it's hard read as one line.
  if ("due_at" in v && v.due_at && v.due_is_hard !== undefined) {
    out.push({ label: "Due", value: `${valueWords("due_at", v.due_at, zone)}${v.due_is_hard ? " · hard deadline" : ""}`, from: before && "due_at" in before ? valueWords("due_at", before.due_at, zone) : undefined });
    delete v.due_at;
    delete v.due_is_hard;
  }
  for (const [k, val] of Object.entries(v)) {
    if (skip.includes(k) || k.endsWith("_id") || k === "completed_at" || val === undefined) continue;
    if (k === "priority" && val === 3 && !before) continue;
    out.push({ label: FIELD_LABEL[k] ?? k.replace(/_/g, " "), value: valueWords(k, val, zone), from: before && k in before ? valueWords(k, before[k], zone) : undefined });
  }
  return out;
}

function humanizeAction(type: string): string {
  const [, service = "", action = ""] = type.split(".");
  const words = `${service} ${action}`.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Outside action";
}

/** The card for one action, as the person should see it now. */
export function actionView(a: Approval, zone: string, reverted: Set<string> = new Set()): ActionView {
  const d = (a.details ?? {}) as Record<string, unknown>;
  const external = a.action_type.startsWith("external.");
  const label = TABLE_LABEL[String(d.table)] ?? "item";
  const subject = String(d.subject ?? (external ? a.summary : a.summary)).slice(0, 160);
  let verb = "Do this";
  let fields: ActionField[] = [];
  if (external) {
    verb = humanizeAction(a.action_type);
    fields = Object.entries(d)
      .filter(([, v]) => v !== null && v !== undefined)
      .slice(0, 8)
      .map(([k, v]) => ({ label: k.replace(/_/g, " "), value: valueWords(k, v, zone) }));
  } else if (d.op === "create") {
    verb = `Create ${label}`;
    fields = fieldsOf(d.values as Record<string, unknown>, zone, undefined, ["title"]);
  } else if (d.op === "update") {
    const patch = d.patch as Record<string, unknown>;
    verb = patch.status === "cancelled" ? `Cancel ${label}` : `Change ${label}`;
    fields = fieldsOf(patch, zone, (d.expect as Record<string, unknown>) ?? undefined, patch.status === "cancelled" ? ["status"] : []);
  } else if (d.op === "complete") {
    verb = "Mark done";
    fields = typeof d.actual_minutes === "number" ? [{ label: "Time spent", value: minutesWords(d.actual_minutes) }] : [];
  } else if (d.op === "delete") {
    verb = `Delete ${label}`;
  } else if (d.op === "settings") {
    verb = "Change settings";
    fields = fieldsOf(d.patch as Record<string, unknown>, zone);
  } else if (d.op === "apply_plan") {
    verb = "Apply plan";
    fields = Array.isArray(d.lines) ? (d.lines as ActionField[]).slice(0, 8) : [];
  }
  const result = (a.result ?? {}) as { summary?: unknown; undo?: unknown };
  const undo = Array.isArray(result.undo) ? result.undo.map(String) : [];
  const status: ActionStatus = pastExpiry(a) ? "expired" : a.status;
  const stuck = a.status === "executing" && Date.now() - Date.parse(a.updated_at ?? a.decided_at ?? a.created_at) > STUCK_MS;
  return {
    id: a.id,
    status,
    verb,
    subject: d.subject ? subject : a.summary,
    fields,
    reason: typeof d.reason === "string" ? d.reason : external ? "it affects people or services outside Navi" : null,
    external,
    result: typeof result.summary === "string" ? result.summary : null,
    error: stuck ? "Navi couldn't confirm this finished. Check whether it happened before asking again." : status === "expired" && !a.error ? "It waited too long without an answer." : a.error,
    undo,
    undone: undo.length > 0 && undo.every((id) => reverted.has(id)),
    revision: a.revision ?? 1,
    expiresAt: a.expires_at,
  };
}

/** Cards for these actions (the person's own only), keyed by id. */
export async function actionViews(ctx: Ctx, ids: string[]): Promise<Record<string, ActionView>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!unique.length) return {};
  const { data } = await ctx.db.from("approvals").select("*").in("id", unique);
  const rows = (data ?? []) as Approval[];
  const undoIds = rows.flatMap((r) => (Array.isArray((r.result as { undo?: unknown } | null)?.undo) ? ((r.result as { undo: string[] }).undo) : []));
  const reverted = await revertedAmong(ctx, undoIds);
  return Object.fromEntries(rows.map((r) => [r.id, actionView(r, ctx.timezone, reverted)]));
}

/** Which of these activity entries have been undone. */
export async function revertedAmong(ctx: Ctx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await ctx.db.from("activity_log").select("id").in("id", [...new Set(ids)]).not("reverted_at", "is", null);
  return new Set((data ?? []).map((r) => r.id as string));
}

/** For Navi's own context: how each action ended up, in words it can act on. */
export function actionStatusForModel(v: ActionView): string {
  switch (v.status) {
    case "proposed":
      return `waiting for the user's OK on its card${v.revision > 1 ? ` (changed ${v.revision - 1}×)` : ""}; to change it use revise_action, if they say no use decline_action`;
    case "approved":
    case "executing":
      return "approved, running";
    case "completed":
      return `approved by the user and done: ${v.result ?? ""}${v.undone ? " — then the user undid it" : ""}`;
    case "declined":
      return "the user declined it, so it was not done; don't propose it again unless they ask";
    case "failed":
      return `approved but it failed: ${v.error ?? "unknown error"}`;
    case "expired":
      return `expired without running: ${v.error ?? ""}`;
  }
}

/**
 * The person approves or declines an action card (web and phone app). Answers
 * with the card as it really is afterwards. Safe to repeat: it runs at most once.
 */
export async function decideActionView(ctx: Ctx, id: string, decision: "approve" | "reject", revision?: number): Promise<ActionView> {
  const row = await decideApproval(ctx, id, decision, createSupabaseAdmin(), typeof revision === "number" ? revision : undefined);
  const undo = Array.isArray((row.result as { undo?: unknown } | null)?.undo) ? (row.result as { undo: string[] }).undo : [];
  return actionView(row, ctx.timezone, await revertedAmong(ctx, undo));
}

/** What a decided card says in one line (the toast after Approve / Decline). */
export function decisionMessage(v: ActionView): string {
  return v.result ?? v.error ?? v.status;
}
