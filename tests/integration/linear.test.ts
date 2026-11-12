import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { completeLinearConnection, disconnectLinear, listLinearConnections } from "@/server/linear/connections";
import { syncConnection, syncDueConnections } from "@/server/linear/sync";
import { getAccessToken, ReauthRequiredError } from "@/server/linear/tokens";
import { handleLinearWebhook } from "@/server/linear/webhook";
import { updateTask, completeTask } from "@/server/domain/tasks";
import { deleteEntity } from "@/server/domain/entities";
import type { LinearIssue } from "@/server/linear/api";
import type { SupabaseClient } from "@supabase/supabase-js";

// The Linear integration end to end against the local database, with a
// simulated Linear (token endpoint, GraphQL API, revoke endpoint).

const ORG = "org-acme";
const ME = "lin-user-me";

class FakeLinear {
  issues = new Map<string, LinearIssue>();
  access = new Set<string>(["AT-1"]);
  refresh = new Set<string>(["RT-1"]);
  refreshCalls = 0;
  revoked: string[] = [];
  graphqlCalls = 0;
  n = 1;

  issue(id: string, over: Partial<LinearIssue> = {}): LinearIssue {
    const i: LinearIssue = {
      id,
      identifier: `ENG-${id}`,
      title: `Issue ${id}`,
      url: `https://linear.app/acme/issue/ENG-${id}`,
      priority: 2,
      priorityLabel: "High",
      dueDate: "2026-11-20",
      estimate: null,
      updatedAt: new Date(Date.now() - 1000 * this.n++).toISOString(),
      archivedAt: null,
      completedAt: null,
      canceledAt: null,
      trashed: false,
      description: "Details",
      assignee: { id: ME },
      state: { id: "st", name: "Todo", type: "unstarted" },
      team: { id: "team", key: "ENG", name: "Engineering" },
      cycle: null,
      project: { id: "proj-1", name: "Launch", url: "https://linear.app/acme/project/launch", targetDate: "2026-12-01", status: { type: "started", name: "In Progress" } },
      ...over,
    };
    this.issues.set(id, i);
    return i;
  }
  touch(id: string, over: Partial<LinearIssue>) {
    this.issues.set(id, { ...this.issues.get(id)!, ...over, updatedAt: new Date().toISOString() });
  }

  fetch = (async (url: string, init: RequestInit): Promise<Response> => {
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url === "https://api.linear.app/oauth/token") {
      const form = new URLSearchParams(String(init.body));
      if (form.get("grant_type") !== "refresh_token") return json(400, { error: "unsupported_grant_type" });
      this.refreshCalls++;
      const rt = form.get("refresh_token")!;
      if (!this.refresh.has(rt)) return json(400, { error: "invalid_grant" });
      this.refresh.delete(rt); // rotation: the old refresh token is spent
      const k = this.refreshCalls + 1;
      this.access.add(`AT-${k}`);
      this.refresh.add(`RT-${k}`);
      return json(200, { access_token: `AT-${k}`, token_type: "Bearer", expires_in: 86399, scope: "read", refresh_token: `RT-${k}` });
    }
    if (url === "https://api.linear.app/oauth/revoke") {
      const t = new URLSearchParams(String(init.body)).get("token")!;
      this.revoked.push(t);
      this.access.delete(t);
      this.refresh.delete(t);
      return new Response(null, { status: 200 });
    }
    if (url === "https://api.linear.app/graphql") {
      this.graphqlCalls++;
      const token = String((init.headers as Record<string, string>).Authorization).replace("Bearer ", "");
      if (!this.access.has(token)) return json(401, { errors: [{ message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } }] });
      const { query, variables } = JSON.parse(String(init.body));
      if (query.includes("NaviViewer")) return json(200, { data: { viewer: { id: ME, name: "Me", displayName: "me", email: "me@acme.test", organization: { id: ORG, name: "Acme", urlKey: "acme" } } } });
      if (query.includes("NaviAssignedIssues")) {
        const nodes = [...this.issues.values()].filter((i) => i.assignee?.id === ME && !i.archivedAt && !["completed", "canceled"].includes(i.state.type));
        return json(200, { data: { viewer: { assignedIssues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } });
      }
      if (query.includes("NaviIssuesById")) {
        const nodes = (variables.ids as string[]).map((id) => this.issues.get(id)).filter(Boolean);
        return json(200, { data: { issues: { nodes } } });
      }
    }
    return json(404, {});
  }) as unknown as typeof fetch;
}

let A: { db: SupabaseClient; userId: string };
let B: { db: SupabaseClient; userId: string };
let linear: FakeLinear;
const svc = admin();

async function connect(expiresInMs = 86_000_000) {
  return completeLinearConnection(svc, A.userId, { accessToken: "AT-1", refreshToken: "RT-1", expiresAt: new Date(Date.now() + expiresInMs), scopes: ["read"] }, linear.fetch);
}
const linearTasks = async () => (await svc.from("tasks").select("*").eq("user_id", A.userId).eq("external_source", "linear").order("external_id")).data ?? [];

beforeAll(async () => {
  process.env.NAVI_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.LINEAR_CLIENT_ID = "test-client";
  process.env.LINEAR_CLIENT_SECRET = "test-secret";
  A = await userClient("linear-a@navi.test");
  B = await userClient("linear-b@navi.test");
});

beforeEach(async () => {
  await resetUser(A.userId);
  await resetUser(B.userId);
  linear = new FakeLinear();
});

describe("Linear connection storage and access control", () => {
  it("stores tokens encrypted; only the owner can see the connection, and nobody but the server can see tokens", async () => {
    const { id } = await connect();
    const { data: tok } = await svc.from("integration_tokens").select("*").eq("connection_id", id).single();
    expect(tok!.access_token_enc).not.toContain("AT-1");
    expect(tok!.refresh_token_enc).not.toContain("RT-1");

    expect(await listLinearConnections(A.db)).toHaveLength(1);
    expect(await listLinearConnections(B.db)).toHaveLength(0);
    // Tokens are unreadable to people, even their own.
    const own = await A.db.from("integration_tokens").select("*");
    expect(own.data ?? []).toHaveLength(0);
    // People can't create or edit connections directly.
    const forged = await B.db.from("integration_connections").insert({ user_id: B.userId, provider: "linear", external_org_id: "x", external_user_id: "y" });
    expect(forged.error).not.toBeNull();
    const edit = await A.db.from("integration_connections").update({ status: "active" }).eq("id", id).select();
    expect(edit.data ?? []).toHaveLength(0);
  });

  it("people can't forge or change a task's Linear link", async () => {
    const { id } = await connect();
    const forged = await B.db.from("tasks").insert({ user_id: B.userId, title: "x", external_source: "linear", external_id: "iss", external_connection_id: id });
    expect(forged.error?.message).toMatch(/managed by Navi/);
    linear.issue("1");
    await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    const [t] = await linearTasks();
    const changed = await A.db.from("tasks").update({ external_id: "other" }).eq("id", t.id);
    expect(changed.error?.message).toMatch(/managed by Navi/);
  });
});

describe("Linear sync", () => {
  it("imports open assigned issues with priority, status, due date and project, without duplicates", async () => {
    linear.issue("1");
    linear.issue("2", { priority: 1, priorityLabel: "Urgent", state: { id: "s", name: "In Progress", type: "started" }, dueDate: null, project: null });
    linear.issue("3", { assignee: { id: "someone-else" } });
    linear.issue("4", { state: { id: "s", name: "Done", type: "completed" } });
    const { id } = await connect();
    const r = await syncConnection(svc, id, "connect", { fetch: linear.fetch });
    expect(r).toMatchObject({ ok: true, stats: { imported: 2, open: 2 } });

    const tasks = await linearTasks();
    expect(tasks.map((t) => [t.external_id, t.title, t.priority, t.status, t.source])).toEqual([
      ["1", "Issue 1", 2, "todo", "linear"],
      ["2", "Issue 2", 1, "in_progress", "linear"],
    ]);
    expect(tasks[0].due_at).toBe("2026-11-21T04:59:00+00:00"); // 23:59 New York
    expect(tasks[0].external_url).toBe("https://linear.app/acme/issue/ENG-1");
    expect(tasks[0].external_data).toMatchObject({ identifier: "ENG-1", state_name: "Todo", priority_label: "High", org_id: ORG });
    const { data: projects } = await svc.from("projects").select("*").eq("user_id", A.userId);
    expect(projects).toHaveLength(1);
    expect(projects![0]).toMatchObject({ name: "Launch", due_date: "2026-12-01", status: "active", external_id: "proj-1" });
    expect(tasks[0].project_id).toBe(projects![0].id);

    // Re-running (and running twice at once) never duplicates.
    await Promise.all([syncConnection(svc, id, "manual", { fetch: linear.fetch }), syncConnection(svc, id, "manual", { fetch: linear.fetch })]);
    await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    expect(await linearTasks()).toHaveLength(2);
    expect((await svc.from("projects").select("id").eq("user_id", A.userId)).data).toHaveLength(1);
    const { data: conn } = await svc.from("integration_connections").select("*").eq("id", id).single();
    expect(conn).toMatchObject({ status: "active", last_sync_error: null, sync_started_at: null });
    expect(conn.last_sync_ok_at).not.toBeNull();
  });

  it("Linear owns the issue's fields; Navi owns planning; nothing is written to Linear", async () => {
    linear.issue("1");
    const { id } = await connect();
    await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    const [t] = await linearTasks();
    const ctx = ctxFor(A.db, A.userId);

    await expect(updateTask(ctx, t.id, { title: "My name" })).rejects.toThrow(/comes from Linear/);
    await expect(updateTask(ctx, t.id, { due_at: "2026-11-25T10:00:00Z" })).rejects.toThrow(/comes from Linear/);
    await expect(updateTask(ctx, t.id, { recurrence: { freq: "daily" } })).rejects.toThrow(/comes from Linear/);
    await expect(deleteEntity(ctx, "tasks", t.id)).rejects.toThrow(/comes from Linear/);
    // Planning fields are Navi's.
    await updateTask(ctx, t.id, { estimate_minutes: 90, commitment: "must", notes: "my notes" });
    // A plan block for it (Navi's scheduling) is untouched by a sync.
    await svc.from("plan_blocks").insert({ user_id: A.userId, task_id: t.id, title: "Issue 1", plan_date: "2099-01-01", starts_at: "2099-01-01T15:00:00Z", ends_at: "2099-01-01T16:00:00Z", status: "planned" });

    linear.touch("1", { title: "Renamed in Linear", priority: 1 });
    const r = await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    expect(r).toMatchObject({ ok: true, stats: { updated: 1 } });
    const [after] = await linearTasks();
    expect(after).toMatchObject({ title: "Renamed in Linear", priority: 1, estimate_minutes: 90, commitment: "must", notes: "my notes" });
    expect((await svc.from("plan_blocks").select("id").eq("task_id", t.id)).data).toHaveLength(1);
    // Read-only: only queries went to Linear, never a mutation.
    expect(linear.revoked).toEqual([]);
  });

  it("done in Navi sticks until Linear moves; Linear closing it clears its own future blocks only", async () => {
    linear.issue("1");
    linear.issue("2");
    const { id } = await connect();
    await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    const [t1, t2] = await linearTasks();
    const ctx = ctxFor(A.db, A.userId);
    await completeTask(ctx, t1.id);
    linear.touch("1", { description: "edited" }); // unrelated Linear edit
    await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    expect((await linearTasks())[0].status).toBe("done");

    await svc.from("plan_blocks").insert([
      { user_id: A.userId, task_id: t2.id, title: "Issue 2", plan_date: "2099-01-01", starts_at: "2099-01-01T15:00:00Z", ends_at: "2099-01-01T16:00:00Z", status: "planned" },
      { user_id: A.userId, task_id: t1.id, title: "Issue 1", plan_date: "2099-01-01", starts_at: "2099-01-01T17:00:00Z", ends_at: "2099-01-01T18:00:00Z", status: "planned" },
    ]);
    linear.touch("2", { state: { id: "d", name: "Done", type: "completed" }, completedAt: "2026-11-11T12:00:00.000Z" });
    const r = await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    expect(r).toMatchObject({ ok: true, stats: { closed: 1 } });
    const [, after2] = await linearTasks();
    expect(after2).toMatchObject({ status: "done" });
    expect((await svc.from("plan_blocks").select("id").eq("task_id", t2.id)).data).toHaveLength(0);
    expect((await svc.from("plan_blocks").select("id").eq("task_id", t1.id)).data).toHaveLength(1); // other work untouched
  });

  it("unassigned, archived or deleted issues leave the plan but stay in Navi, marked; reassignment brings them back", async () => {
    linear.issue("1");
    linear.issue("2");
    linear.issue("3");
    const { id } = await connect();
    await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    linear.touch("1", { assignee: { id: "someone-else" } });
    linear.touch("2", { archivedAt: new Date().toISOString() });
    linear.issues.delete("3");
    const r = await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    expect(r).toMatchObject({ ok: true, stats: { detached: 3 } });
    const tasks = await linearTasks();
    expect(tasks.map((t) => [t.status, t.external_data.detached])).toEqual([
      ["cancelled", "unassigned"],
      ["cancelled", "archived"],
      ["cancelled", "missing"],
    ]);
    // Detached ones aren't re-queried every time.
    const before = linear.graphqlCalls;
    await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    expect(linear.graphqlCalls - before).toBe(2); // viewer + assigned issues only

    linear.touch("1", { assignee: { id: ME } });
    await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    const [back] = await linearTasks();
    expect(back.status).toBe("todo");
    expect(back.external_data.detached).toBeNull();
  });
});

describe("Linear tokens", () => {
  it("refreshes an expired access token once, rotating the refresh token, even with parallel callers", async () => {
    linear.issue("1");
    const { id } = await connect(-60_000);
    linear.access.clear(); // AT-1 has expired at Linear too
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 50)));
    const tokens = await Promise.all([1, 2, 3].map(() => getAccessToken(svc, id, { fetch: linear.fetch, sleep })));
    expect(new Set(tokens)).toEqual(new Set(["AT-2"]));
    expect(linear.refreshCalls).toBe(1);
    expect(linear.refresh.has("RT-1")).toBe(false);
    const { data: tok } = await svc.from("integration_tokens").select("token_version,refresh_lease_until,refresh_token_enc").eq("connection_id", id).single();
    expect(tok!.refresh_lease_until).toBeNull();
    expect(tok!.refresh_token_enc).not.toContain("RT-2");
    expect((await syncConnection(svc, id, "manual", { fetch: linear.fetch })).ok).toBe(true);
  });

  it("a token Linear rejects is refreshed and retried; a revoked grant asks the person to reconnect", async () => {
    linear.issue("1");
    const { id } = await connect();
    linear.access.clear(); // access token revoked early, refresh still valid
    expect(await syncConnection(svc, id, "manual", { fetch: linear.fetch })).toMatchObject({ ok: true });
    expect(linear.refreshCalls).toBe(1);

    linear.access.clear();
    linear.refresh.clear(); // the person removed Navi in Linear
    const r = await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    expect(r).toMatchObject({ ok: false, reauth: true });
    const [conn] = await listLinearConnections(A.db);
    expect(conn.status).toBe("needs_reauth");
    expect(conn.last_sync_error).toMatch(/Reconnect/);
    // Imported tasks stay; scheduled syncs skip the connection until reconnected.
    expect(await linearTasks()).toHaveLength(1);
    expect(await syncDueConnections(svc, { deps: { fetch: linear.fetch } })).toEqual({});
    await expect(getAccessToken(svc, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(ReauthRequiredError);

    // Reconnecting the same workspace reuses the connection and its tasks.
    linear.access.add("AT-1");
    linear.refresh.add("RT-1");
    const again = await connect();
    expect(again.id).toBe(id);
    expect(await syncConnection(svc, id, "manual", { fetch: linear.fetch })).toMatchObject({ ok: true, stats: { imported: 0 } });
  });
});

describe("Linear disconnect, reconciliation and webhooks", () => {
  it("disconnect revokes at Linear, deletes tokens, keeps tasks as editable Navi tasks; reconnect re-links without duplicates", async () => {
    linear.issue("1");
    const { id } = await connect();
    await syncConnection(svc, id, "manual", { fetch: linear.fetch });
    const r = await disconnectLinear(svc, A.userId, id, linear.fetch);
    expect(r.revoked).toBe(true);
    expect(linear.revoked.sort()).toEqual(["AT-1", "RT-1"]);
    expect((await svc.from("integration_tokens").select("connection_id").eq("connection_id", id)).data).toHaveLength(0);
    expect(await listLinearConnections(A.db)).toHaveLength(0);
    const [t] = await linearTasks();
    expect(t.external_connection_id).toBeNull();
    expect(t.external_id).toBe("1");
    await updateTask(ctxFor(A.db, A.userId), t.id, { title: "Mine now" });

    // Someone else can't disconnect your connection.
    linear.access.add("AT-1");
    linear.refresh.add("RT-1");
    const { id: id2 } = await connect();
    await expect(disconnectLinear(svc, B.userId, id2, linear.fetch)).rejects.toThrow(/isn't yours/);
    await syncConnection(svc, id2, "manual", { fetch: linear.fetch });
    const tasks = await linearTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ external_connection_id: id2, title: "Issue 1" }); // Linear owns it again
  });

  it("periodic reconciliation syncs due connections; a webhook only flags its workspace for the next sync", async () => {
    linear.issue("1");
    const { id } = await connect();
    expect(Object.values(await syncDueConnections(svc, { deps: { fetch: linear.fetch } }))).toEqual(["ok +1 ~0"]);
    expect(await syncDueConnections(svc, { deps: { fetch: linear.fetch } })).toEqual({}); // just synced

    expect(await handleLinearWebhook(svc, { type: "Issue", action: "update", organizationId: "other-org" }, "test-client")).toBe("sync_requested");
    expect(await syncDueConnections(svc, { deps: { fetch: linear.fetch } })).toEqual({});
    expect(await handleLinearWebhook(svc, { type: "Issue", action: "update", organizationId: ORG }, "test-client")).toBe("sync_requested");
    linear.issue("2");
    expect(Object.values(await syncDueConnections(svc, { deps: { fetch: linear.fetch } }))).toEqual(["ok +1 ~0"]);

    expect(await handleLinearWebhook(svc, { type: "OAuthApp", action: "revoked", organizationId: ORG, oauthClientId: "someone-elses-app" }, "test-client")).toBe("ignored");
    expect(await handleLinearWebhook(svc, { type: "OAuthApp", action: "revoked", organizationId: ORG, oauthClientId: "test-client" }, "test-client")).toBe("access_revoked");
    const { data: conn } = await svc.from("integration_connections").select("status").eq("id", id).single();
    expect(conn!.status).toBe("needs_reauth");
  });
});
