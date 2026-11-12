import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import type { TaskStatus } from "@/lib/types";
import { logActivity } from "@/server/domain/activity";
import {
  ASSIGNED_ISSUES_QUERY,
  ISSUES_BY_ID_QUERY,
  LinearApiError,
  LinearAuthError,
  LinearRateLimitError,
  linearGraphql,
  VIEWER_QUERY,
  type AssignedIssuesPage,
  type IssuesByIdPage,
  type LinearIssue,
  type LinearViewer,
} from "./api";
import { linearValues, mapProjectStatus, OPEN_STATUSES, snapshotOf, taskPatch, type DetachReason, type LinearSnapshot } from "./mapping";
import { getAccessToken, ReauthRequiredError } from "./tokens";
import type { FetchLike } from "./oauth";

// Read-only synchronisation: Linear → Navi. Imports the person's open assigned
// issues as tasks (and their Linear projects as projects), keeps Linear-owned
// fields current, and reconciles issues that were completed, cancelled,
// unassigned, archived or deleted. Never writes to Linear. Never moves plan
// blocks for other work: a task that Linear closes only loses its own future
// planned blocks, exactly as when it's finished or cancelled in Navi.
// Runs with the service-role client and scopes every query by user_id.

export const SYNC_INTERVAL_MINUTES = 30;
const LEASE_MINUTES = 5;
const MAX_PAGES = 10; // 1,000 open assigned issues per sync

export type SyncTrigger = "connect" | "manual" | "schedule" | "webhook";
export type SyncStats = { imported: number; updated: number; closed: number; detached: number; open: number; truncated: boolean };
export type SyncResult =
  | { ok: true; stats: SyncStats }
  | { ok: false; skipped: "already_running" | "not_active" | "not_found" }
  | { ok: false; error: string; reauth: boolean };

type Connection = {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  external_org_id: string;
  external_user_id: string;
  settings: { workspace_id?: string | null } | null;
};

type TaskRow = {
  id: string;
  status: TaskStatus;
  title: string;
  priority: number;
  due_at: string | null;
  project_id: string | null;
  external_id: string;
  external_connection_id: string | null;
  external_data: LinearSnapshot | null;
};

type Deps = { fetch?: FetchLike; now?: Date };

/** Runs a Linear query, refreshing the token once if Linear rejects it. */
function linearCaller(admin: SupabaseClient, connectionId: string, deps: Deps) {
  let token: string | null = null;
  return async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    token ??= await getAccessToken(admin, connectionId, { fetch: deps.fetch });
    try {
      return await linearGraphql<T>(token, query, variables, deps.fetch);
    } catch (err) {
      if (!(err instanceof LinearAuthError)) throw err;
      token = await getAccessToken(admin, connectionId, { force: true, fetch: deps.fetch });
      try {
        return await linearGraphql<T>(token, query, variables, deps.fetch);
      } catch (again) {
        if (again instanceof LinearAuthError) throw new ReauthRequiredError(again.message);
        throw again;
      }
    }
  };
}

/** Plain words for the Settings status line. Never includes tokens or raw provider bodies. */
export function syncErrorMessage(err: unknown): string {
  if (err instanceof ReauthRequiredError) return "Linear access expired or was revoked. Reconnect to keep syncing.";
  if (err instanceof LinearRateLimitError) return "Linear asked Navi to slow down. Navi will try again shortly.";
  if (err instanceof LinearApiError) return err.message.slice(0, 300);
  return `Sync failed: ${(err as Error).message ?? "unknown error"}`.slice(0, 300);
}

export async function syncConnection(admin: SupabaseClient, connectionId: string, trigger: SyncTrigger, deps: Deps = {}): Promise<SyncResult> {
  const now = deps.now ?? new Date();
  const { data: conn } = await admin.from("integration_connections").select("*").eq("id", connectionId).maybeSingle();
  if (!conn) return { ok: false, skipped: "not_found" };
  const connection = conn as Connection;
  if (connection.status !== "active") return { ok: false, skipped: "not_active" };

  // One sync per connection at a time; a lease older than 5 minutes is assumed dead.
  const staleBefore = new Date(now.getTime() - LEASE_MINUTES * 60_000).toISOString();
  const { data: leased } = await admin
    .from("integration_connections")
    .update({ sync_started_at: now.toISOString() })
    .eq("id", connectionId)
    .or(`sync_started_at.is.null,sync_started_at.lt.${staleBefore}`)
    .select("id");
  if (!leased?.length) return { ok: false, skipped: "already_running" };

  try {
    const stats = await runSync(admin, connection, trigger, deps, now);
    await admin
      .from("integration_connections")
      .update({ last_sync_at: new Date().toISOString(), last_sync_ok_at: new Date().toISOString(), last_sync_error: null, last_sync_stats: stats, sync_started_at: null, sync_requested_at: null })
      .eq("id", connectionId);
    return { ok: true, stats };
  } catch (err) {
    const reauth = err instanceof ReauthRequiredError;
    const message = syncErrorMessage(err);
    if (!reauth && !(err instanceof LinearRateLimitError) && !(err instanceof LinearApiError)) console.error("[linear sync]", connectionId, err);
    await admin
      .from("integration_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_error: message,
        sync_started_at: null,
        ...(reauth ? { status: "needs_reauth", status_detail: message } : {}),
      })
      .eq("id", connectionId);
    return { ok: false, error: message, reauth };
  }
}

async function runSync(admin: SupabaseClient, conn: Connection, trigger: SyncTrigger, deps: Deps, now: Date): Promise<SyncStats> {
  const call = linearCaller(admin, conn.id, deps);
  const { viewer } = await call<LinearViewer>(VIEWER_QUERY);
  if (viewer.organization.id !== conn.external_org_id) throw new ReauthRequiredError("This Linear token belongs to a different workspace");
  // Keep the names shown in Settings current (the workspace or person may have been renamed).
  await admin.from("integration_connections").update({ external_user_id: viewer.id, external_user_name: viewer.displayName || viewer.name, external_org_name: viewer.organization.name, external_org_url_key: viewer.organization.urlKey }).eq("id", conn.id);

  // 1. The person's open assigned issues.
  const open: LinearIssue[] = [];
  let after: string | null = null;
  let truncated = false;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      truncated = true;
      break;
    }
    const data: AssignedIssuesPage = await call<AssignedIssuesPage>(ASSIGNED_ISSUES_QUERY, { after });
    open.push(...data.viewer.assignedIssues.nodes);
    if (!data.viewer.assignedIssues.pageInfo.hasNextPage) break;
    after = data.viewer.assignedIssues.pageInfo.endCursor;
  }

  const { data: profile } = await admin.from("profiles").select("timezone").eq("id", conn.user_id).maybeSingle();
  const zone = (profile?.timezone as string | undefined) ?? "UTC";
  const workspaceId = conn.settings?.workspace_id ?? null;

  // 2. Projects of those issues → Navi projects (Linear owns name, target date and status).
  const projectIds = new Map<string, string>(); // Linear project id → Navi project id
  const linearProjects = new Map(open.filter((i) => i.project).map((i) => [i.project!.id, i.project!]));
  if (linearProjects.size) {
    const { data: existing, error } = await admin
      .from("projects")
      .select("id,external_id,name,due_date,status,external_url,external_connection_id")
      .eq("user_id", conn.user_id)
      .eq("external_source", "linear")
      .in("external_id", [...linearProjects.keys()]);
    if (error) throw new Error(`Could not read projects: ${error.message}`);
    const byExt = new Map((existing ?? []).map((p) => [p.external_id as string, p]));
    const toInsert: Record<string, unknown>[] = [];
    for (const [extId, p] of linearProjects) {
      const want = { name: p.name.slice(0, 200) || "Linear project", due_date: p.targetDate ?? null, status: mapProjectStatus(p.status?.type), external_url: p.url, external_connection_id: conn.id };
      const row = byExt.get(extId);
      if (!row) {
        toInsert.push({ ...want, user_id: conn.user_id, workspace_id: workspaceId, external_source: "linear", external_id: extId });
        continue;
      }
      projectIds.set(extId, row.id as string);
      const patch = Object.fromEntries(Object.entries(want).filter(([k, v]) => (row as Record<string, unknown>)[k] !== v));
      if (Object.keys(patch).length) await admin.from("projects").update(patch).eq("id", row.id).eq("user_id", conn.user_id);
    }
    if (toInsert.length) {
      await admin.from("projects").upsert(toInsert, { onConflict: "user_id,external_source,external_id", ignoreDuplicates: true });
      const { data: made } = await admin.from("projects").select("id,external_id").eq("user_id", conn.user_id).eq("external_source", "linear").in("external_id", toInsert.map((r) => r.external_id as string));
      for (const r of made ?? []) projectIds.set(r.external_id as string, r.id as string);
    }
  }

  // 3. Imported tasks this connection owns (or owned before a disconnect, same workspace).
  const { data: taskRows, error: taskErr } = await admin
    .from("tasks")
    .select("id,status,title,priority,due_at,project_id,external_id,external_connection_id,external_data")
    .eq("user_id", conn.user_id)
    .eq("external_source", "linear");
  if (taskErr) throw new Error(`Could not read tasks: ${taskErr.message}`);
  const mine = ((taskRows ?? []) as TaskRow[]).filter((t) => t.external_connection_id === conn.id || (!t.external_connection_id && t.external_data?.org_id === conn.external_org_id));
  const byIssue = new Map(mine.map((t) => [t.external_id, t]));

  const stats: SyncStats = { imported: 0, updated: 0, closed: 0, detached: 0, open: open.length, truncated };
  const closedTaskIds: string[] = [];
  const syncedAt = now.toISOString();

  const applyIssue = async (task: TaskRow, issue: LinearIssue) => {
    const values = linearValues(issue, zone, issue.project ? (projectIds.get(issue.project.id) ?? null) : null);
    const prev = task.external_data?.detached ? null : task.external_data?.synced;
    const patch: Record<string, unknown> = taskPatch(task, prev, values);
    const reattach = task.external_connection_id !== conn.id;
    const changedInLinear = task.external_data?.updated_at !== issue.updatedAt || Boolean(task.external_data?.detached);
    if (!Object.keys(patch).length && !reattach && !changedInLinear) return;
    if ("status" in patch) {
      patch.completed_at = patch.status === "done" ? (issue.completedAt ?? syncedAt) : null;
      if (!OPEN_STATUSES.includes(patch.status as TaskStatus) && OPEN_STATUSES.includes(task.status)) {
        stats.closed++;
        closedTaskIds.push(task.id);
      }
    }
    const { error } = await admin
      .from("tasks")
      .update({ ...patch, external_url: issue.url, external_connection_id: conn.id, external_data: snapshotOf(issue, conn.external_org_id, values), external_synced_at: syncedAt })
      .eq("id", task.id)
      .eq("user_id", conn.user_id);
    if (error) throw new Error(`Could not update a Linear task: ${error.message}`);
    if (Object.keys(patch).length) stats.updated++;
  };

  // 4. Open assigned issues: create the new ones, update the rest.
  const toInsert: Record<string, unknown>[] = [];
  for (const issue of open) {
    const task = byIssue.get(issue.id);
    if (task) {
      await applyIssue(task, issue);
      continue;
    }
    const values = linearValues(issue, zone, issue.project ? (projectIds.get(issue.project.id) ?? null) : null);
    toInsert.push({
      user_id: conn.user_id,
      workspace_id: workspaceId,
      title: values.title,
      priority: values.priority,
      due_at: values.due_at,
      project_id: values.project_id,
      status: values.status,
      source: "linear",
      external_source: "linear",
      external_id: issue.id,
      external_url: issue.url,
      external_connection_id: conn.id,
      external_data: snapshotOf(issue, conn.external_org_id, values),
      external_synced_at: syncedAt,
    });
  }
  if (toInsert.length) {
    // ignoreDuplicates: a parallel sync (or another connection to the same workspace) already made it.
    const { data: made, error } = await admin.from("tasks").upsert(toInsert, { onConflict: "user_id,external_source,external_id", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`Could not import Linear issues: ${error.message}`);
    stats.imported = made?.length ?? 0;
  }

  // 5. Previously imported issues that left the open assigned set: find out why.
  const openIds = new Set(open.map((i) => i.id));
  const stale = mine.filter((t) => !openIds.has(t.external_id) && !t.external_data?.detached && OPEN_STATUSES.includes(t.external_data?.synced?.status ?? "todo"));
  if (!truncated && stale.length) {
    const found = new Map<string, LinearIssue>();
    for (let i = 0; i < stale.length; i += 100) {
      const ids = stale.slice(i, i + 100).map((t) => t.external_id);
      const data = await call<IssuesByIdPage>(ISSUES_BY_ID_QUERY, { ids });
      for (const n of data.issues.nodes) found.set(n.id, n);
    }
    for (const task of stale) {
      const issue = found.get(task.external_id);
      const reason: DetachReason | null = !issue ? "missing" : issue.archivedAt || issue.trashed ? "archived" : issue.assignee?.id !== viewer.id ? "unassigned" : null;
      if (issue && !reason) {
        await applyIssue(task, issue); // completed or cancelled in Linear
        continue;
      }
      // No longer the person's Linear work: drop it from their plan (it stays in Navi, marked).
      const patch: Record<string, unknown> = {};
      if (OPEN_STATUSES.includes(task.status)) {
        patch.status = "cancelled";
        patch.completed_at = null;
        closedTaskIds.push(task.id);
      }
      const snapshot: LinearSnapshot | null = issue
        ? { ...snapshotOf(issue, conn.external_org_id, linearValues(issue, zone, task.project_id)), detached: reason }
        : task.external_data
          ? { ...task.external_data, detached: reason }
          : null;
      const { error } = await admin.from("tasks").update({ ...patch, external_data: snapshot, external_synced_at: syncedAt }).eq("id", task.id).eq("user_id", conn.user_id);
      if (error) throw new Error(`Could not update a Linear task: ${error.message}`);
      stats.detached++;
    }
  }

  // 6. Tasks Linear closed lose their own future planned blocks (nothing else moves).
  if (closedTaskIds.length) {
    const today = DateTime.fromJSDate(now).setZone(zone).toISODate()!;
    await admin.from("plan_blocks").delete().eq("user_id", conn.user_id).in("task_id", closedTaskIds).eq("status", "planned").gte("plan_date", today);
  }

  if (stats.imported || stats.updated || stats.closed || stats.detached) {
    const parts = [
      stats.imported && `imported ${stats.imported} issue${stats.imported === 1 ? "" : "s"}`,
      stats.updated && `updated ${stats.updated}`,
      stats.detached && `${stats.detached} no longer assigned to you`,
    ].filter(Boolean);
    await logActivity(
      { db: admin, userId: conn.user_id, actor: "system", timezone: zone },
      { action: "sync", entityType: "integration_connections", entityId: conn.id, summary: `Linear: ${parts.join(", ")}`, after: { trigger, ...stats }, reversible: false },
    );
  }
  return stats;
}

/**
 * Periodic reconciliation (called from the scheduler tick): active
 * connections not synced in the last 30 minutes, or that a webhook or
 * "Sync now" asked to sync, oldest first, within a time budget.
 */
export async function syncDueConnections(admin: SupabaseClient, opts: { limit?: number; budgetMs?: number; deps?: Deps } = {}) {
  const started = Date.now();
  const cutoff = new Date(Date.now() - SYNC_INTERVAL_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from("integration_connections")
    .select("id")
    .eq("provider", "linear")
    .eq("status", "active")
    .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff},sync_requested_at.not.is.null`)
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? 10);
  if (error) throw new Error(error.message);
  const results: Record<string, string> = {};
  for (const { id } of data ?? []) {
    if (Date.now() - started > (opts.budgetMs ?? 90_000)) break;
    const r = await syncConnection(admin, id, "schedule", opts.deps);
    results[id.slice(0, 8)] = r.ok ? `ok +${r.stats.imported} ~${r.stats.updated}` : "skipped" in r ? r.skipped : `error${r.reauth ? " (reconnect needed)" : ""}`;
  }
  return results;
}
