import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { connectFeed } from "@/server/integrations/connections";
import { createTask, updateTask } from "@/server/domain/tasks";

// The Canvas cleanup scripts (scripts/canvas-cleanup/*.sql) against the local
// database: a realistic imported Canvas account (the real sync code and
// fixtures), the person's own data, and another account. backup → purge →
// nothing imported is left, own data intact, other account untouched →
// restore → every row back exactly. Runs the SQL files through psql, the way
// they run on the hosted project.

process.env.NAVI_INTEGRATION_ENCRYPTION_KEY ||= Buffer.alloc(32, 9).toString("base64");
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DIR = path.resolve(__dirname, "../../scripts/canvas-cleanup");
const FEED = "https://navi-u.instructure.com/feeds/calendars/user_AbCdEf0123456789xyzAbCdEf0123456789xyz.ics";
const V1 = readFileSync(path.resolve(__dirname, "../fixtures/canvas/feed-v1.ics"), "utf8");
const EMAIL = "canvas-cleanup@navi.test";
const OTHER = "canvas-cleanup-other@navi.test";

const runSql = (file: string, email = EMAIL) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-At", "-f", "-"], { input: readFileSync(path.join(DIR, file), "utf8").replaceAll("OWNER_EMAIL_HERE", email), encoding: "utf8" });
const psql = (sql: string) => execFileSync("psql", [DB, "-At", "-c", sql], { encoding: "utf8" }).trim();

/** Every row this account owns in the tables the cleanup touches, minus updated_at (bumped by the step re-attach). */
function snapshot(userId: string): string {
  const tables = ["tasks", "plan_blocks", "task_dependencies", "focus_sessions", "events", "integration_connections", "integration_secrets", "external_courses", "external_items", "integration_sync_runs", "integration_rate_events", "notifications", "activity_log", "approvals", "dismissed_suggestions"];
  return tables.map((t) => `${t}:${psql(`select coalesce(md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by (to_jsonb(x) - 'updated_at')::text)), 'empty') from public.${t} x where user_id = '${userId}'`)}`).join("\n");
}

let me: Awaited<ReturnType<typeof userClient>>;
let other: Awaited<ReturnType<typeof userClient>>;

beforeAll(async () => {
  me = await userClient(EMAIL);
  other = await userClient(OTHER);
  for (const u of [me, other]) await resetUser(u.userId);
  psql("drop schema if exists navi_backup cascade");
  const ctx = ctxFor(me.db, me.userId);
  const a = admin();
  // Imported Canvas data through the real connect + sync.
  const r = await connectFeed(ctx, "canvas", FEED, { admin: a, now: new Date("2026-11-12T15:00:00Z"), fetchText: async () => V1 });
  expect(r.outcome.ok).toBe(true);
  const { data: imported } = await me.db.from("tasks").select("id,title").eq("source", "external");
  const essay = imported!.find((t) => t.title.startsWith("Essay 1"))!;
  const lab = imported!.find((t) => t.title.startsWith("Lab report 1"))!;
  await updateTask(ctx, lab.id, { status: "done" });
  // The person's own work, some of it tied to imported tasks.
  const own = await createTask(ctx, { title: "Build a plan to fix Navi", estimate_minutes: 60 });
  const step = await createTask(ctx, { title: "Outline the essay (my step)", parent_task_id: essay.id });
  const day = "2026-11-20";
  await a.from("plan_blocks").insert([
    { user_id: me.userId, plan_date: day, task_id: essay.id, title: "Essay 1", starts_at: "2026-11-20T21:00:00Z", ends_at: "2026-11-20T22:00:00Z", is_flexible: true, created_by: "navi", status: "planned" },
    { user_id: me.userId, plan_date: day, task_id: own.id, title: own.title, starts_at: "2026-11-20T22:10:00Z", ends_at: "2026-11-20T23:10:00Z", is_flexible: true, created_by: "user", status: "planned" },
  ]);
  await a.from("focus_sessions").insert({ user_id: me.userId, task_id: essay.id, started_at: "2026-11-15T20:00:00Z", ended_at: "2026-11-15T20:25:00Z", planned_minutes: 25, actual_minutes: 25, outcome: "progress" });
  await a.from("notifications").insert([
    { user_id: me.userId, kind: "overdue", title: "Overdue", body: "x", url: "/tasks", dedupe_key: `overdue:${lab.id}:2026-10-20` },
    { user_id: me.userId, kind: "morning", title: "Morning", body: "y", url: "/", dedupe_key: "morning:2026-11-16" },
  ]);
  await a.from("dismissed_suggestions").insert({ user_id: me.userId, key: `old_task:${essay.id}` });
  expect(step.parent_task_id).toBe(essay.id);
  // Someone else's data, including their own Canvas-like task.
  await createTask(ctxFor(other.db, other.userId), { title: "Other person's task" });
  await a.from("tasks").insert({ user_id: other.userId, title: "Their import", source: "external", external_ref: "ext:00000000-0000-4000-8000-00000000c0de", due_at: "2026-11-01T00:00:00Z", due_is_hard: true, priority: 2 });
});
afterAll(async () => {
  psql("drop schema if exists navi_backup cascade");
  for (const u of [me, other]) await resetUser(u.userId);
});

describe("Canvas cleanup scripts", () => {
  it("preview counts exactly what will go, and what stays", () => {
    const out = runSql("preview.sql");
    const row = (label: string) => Number(out.split("\n").find((l) => l.startsWith(label))!.split("|")[1]);
    expect(row("tasks (imported: open)")).toBe(4);
    expect(row("tasks (imported: done)")).toBe(1);
    expect(row("steps you wrote under an imported task")).toBe(1);
    expect(row("plan_blocks on imported tasks")).toBe(1);
    expect(row("focus_sessions on imported tasks")).toBe(1);
    expect(row("events (imported)")).toBe(6);
    expect(row("integration_connections")).toBe(1);
    expect(row("notifications about imported tasks")).toBe(1);
    expect(row("KEPT: your own tasks")).toBe(2);
  });

  it("backup → purge removes every imported trace, keeps own data, stops sync; restore brings back every row", async () => {
    const before = snapshot(me.userId);
    const otherBefore = snapshot(other.userId);
    runSql("backup.sql");
    // A second backup under the same name refuses instead of overwriting.
    expect(() => runSql("backup.sql")).toThrow();
    runSql("purge.sql");

    const { data: tasks } = await admin().from("tasks").select("title,source,external_ref,parent_task_id").eq("user_id", me.userId).order("title");
    expect(tasks).toEqual([
      { title: "Build a plan to fix Navi", source: "user", external_ref: null, parent_task_id: null },
      { title: "Outline the essay (my step)", source: "user", external_ref: null, parent_task_id: null },
    ]);
    for (const [table, n] of [["integration_connections", 0], ["integration_secrets", 0], ["external_items", 0], ["external_courses", 0], ["integration_sync_runs", 0], ["events", 0]] as const) {
      const { count } = await admin().from(table).select("*", { count: "exact", head: true }).eq("user_id", me.userId);
      expect(count, table).toBe(n);
    }
    const { data: blocks } = await admin().from("plan_blocks").select("title").eq("user_id", me.userId);
    expect(blocks!.map((b) => b.title)).toEqual(["Build a plan to fix Navi"]);
    const { data: focus } = await admin().from("focus_sessions").select("task_id,actual_minutes").eq("user_id", me.userId);
    expect(focus).toEqual([{ task_id: null, actual_minutes: 25 }]); // focus history kept
    const { data: notes } = await admin().from("notifications").select("dedupe_key").eq("user_id", me.userId);
    expect(notes!.map((n) => n.dedupe_key)).toEqual(["morning:2026-11-16"]);
    expect(snapshot(other.userId)).toBe(otherBefore);
    // The backup isn't reachable through the API.
    expect(psql("select has_schema_privilege('authenticated', 'navi_backup', 'USAGE')")).toBe("f");

    runSql("restore.sql");
    expect(snapshot(me.userId)).toBe(before);
    expect(snapshot(other.userId)).toBe(otherBefore);
  });

  it("purge refuses to run without a backup", () => {
    psql("drop schema if exists navi_backup cascade");
    expect(() => runSql("purge.sql")).toThrow(/run backup.sql first/);
  });
});
