import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { connectFeed, disconnectFeed, refreshConnection, resolveDuplicate, setCourseExcluded, setCourseLink, setItemHidden } from "@/server/integrations/connections";
import { runSync, syncDueConnections } from "@/server/integrations/feed-sync";
import { FeedError } from "@/server/integrations/safe-fetch";
import { updateTask, createTask } from "@/server/domain/tasks";
import type { Ctx } from "@/server/context";

// End-to-end sync against the local database with realistic Canvas fixtures
// (tests/fixtures/canvas). The network is replaced by a fixture fetcher; the
// SSRF-safe fetcher itself is covered in tests/unit/canvas-feed.test.ts.

process.env.NAVI_INTEGRATION_ENCRYPTION_KEY ||= Buffer.alloc(32, 9).toString("base64");

const FIX = path.resolve(__dirname, "../fixtures/canvas");
const V1 = readFileSync(path.join(FIX, "feed-v1.ics"), "utf8");
const V2 = readFileSync(path.join(FIX, "feed-v2.ics"), "utf8");
const FEED = "https://navi-u.instructure.com/feeds/calendars/user_AbCdEf0123456789xyzAbCdEf0123456789xyz.ics";
const T0 = new Date("2026-11-12T15:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
/** Drop one VEVENT (by UID) from a feed: "deleted in Canvas". */
const without = (feed: string, uid: string) => feed.replace(new RegExp(`BEGIN:VEVENT\\r\\nDTSTAMP:[^\\r]*\\r\\nUID:${uid}\\r\\n[\\s\\S]*?END:VEVENT\\r\\n`, "g"), "");

let me: { db: SupabaseClient; userId: string };
let other: { db: SupabaseClient; userId: string };
let ctx: Ctx;
let feed = V1;
const a = admin();
const deps = (now = T0) => ({ admin: a, now, fetchText: async () => feed });
const sync = (connId: string, now: Date, f?: string) => {
  if (f !== undefined) feed = f;
  return runSync(a, connId, { trigger: "manual", now, fetchFeed: async () => feed });
};

async function tasks() {
  const { data } = await me.db.from("tasks").select("*").order("title");
  return data ?? [];
}
const byTitle = async (prefix: string) => (await tasks()).find((t) => t.title.startsWith(prefix));

beforeAll(async () => {
  me = await userClient("canvas@navi.test");
  other = await userClient("canvas-other@navi.test");
});
beforeEach(async () => {
  await resetUser(me.userId);
  await resetUser(other.userId);
  ctx = ctxFor(me.db, me.userId);
  feed = V1;
});

async function connectWithOwnTask() {
  // The person already wrote this one down themselves.
  await createTask(ctx, { title: "Problem set 4", due_at: "2026-11-18T03:00:00Z" });
  return connectFeed(ctx, "canvas", FEED.replace("https://", "webcal://"), deps());
}

describe("Canvas calendar feed", () => {
  it("connects, stores the link encrypted, and imports a concise first batch", async () => {
    const { connectionId, outcome } = await connectWithOwnTask();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status).toBe("success");
    expect(outcome.counts).toMatchObject({ assignments: 5, created: 4 + 6, duplicates: 1, courses: 3 });
    expect(outcome.counts.newCourses.sort()).toEqual(["ENGL 101 Composition", "HIST 210 Modern Europe", "MATH 150 Calculus"].sort());

    // Assignments became ordinary tasks Navi plans with; Canvas owns title + due.
    const essay = (await byTitle("Essay 1"))!;
    expect(essay).toMatchObject({ source: "external", status: "todo", due_is_hard: true, due_at: "2026-11-20T04:59:00+00:00", notes: null });
    expect(essay.external_ref).toMatch(/^ext:/);
    // All-day assignment: due 11:59 PM in the person's zone.
    expect((await byTitle("Reading response"))!.due_at).toBe("2026-12-02T04:59:00+00:00");
    // The possible duplicate is held for a decision, not imported or merged.
    expect((await tasks()).filter((t) => /problem set 4/i.test(t.title))).toHaveLength(1);
    expect((await byTitle("Problem set 4"))!.source).toBe("user");

    // Timed events: office hours, 4 study-group sessions (one excluded, one cancelled), advising.
    const { data: events } = await me.db.from("events").select("title,starts_at,ends_at,status,source,location").order("starts_at");
    expect(events!.map((e) => e.title)).toEqual(["Study group", "Study group", "Office hours [ENGL 101 Composition]", "Study group", "Advising [HIST 210 Modern Europe]", "Study group (moved)"]);
    expect(events!.every((e) => e.source === "external" && e.status === "confirmed")).toBe(true);
    expect(events!.find((e) => e.title.startsWith("Office"))).toMatchObject({ starts_at: "2026-11-17T19:00:00+00:00", location: "Humanities 204" });

    // The person can read status and items, but never the stored link.
    const { data: conn } = await me.db.from("integration_connections").select("*").single();
    expect(conn).toMatchObject({ status: "active", display_host: "navi-u.instructure.com", consecutive_failures: 0 });
    expect(JSON.stringify(conn)).not.toContain("user_AbCdEf");
    const { data: secretsAsUser } = await me.db.from("integration_secrets").select("*");
    expect(secretsAsUser ?? []).toEqual([]);
    const { data: secret } = await a.from("integration_secrets").select("ciphertext").eq("connection_id", connectionId).single();
    expect(secret!.ciphertext).toMatch(/^v1\./);
    expect(secret!.ciphertext).not.toContain("instructure");
    const { data: items } = await me.db.from("external_items").select("*");
    expect(items!.find((i) => i.uid === "event-calendar-event-2005")!.url).toBeNull(); // off-site link dropped
    expect(items!.find((i) => i.uid === "event-assignment-1001")!.description).not.toMatch(/<script/);
    const { data: runs } = await me.db.from("integration_sync_runs").select("trigger,status");
    expect(runs).toEqual([{ trigger: "connect", status: "success" }]);
  });

  it("is idempotent: importing the same feed again creates nothing new", async () => {
    const { connectionId } = await connectWithOwnTask();
    const before = (await tasks()).length;
    const r = await sync(connectionId, at(60));
    expect(r.ok && r.counts).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect((await tasks()).length).toBe(before);
    const { count } = await me.db.from("events").select("id", { count: "exact", head: true });
    expect(count).toBe(6);
    // Concurrent runs: one claims the connection, the other is told it's busy.
    const [x, y] = await Promise.all([sync(connectionId, at(61)), sync(connectionId, at(61))]);
    expect([x, y].filter((r) => !r.ok && r.code === "busy")).toHaveLength(1);
  });

  it("refreshes changed due dates while keeping Navi's planning fields; Canvas-owned fields can't be edited", async () => {
    const { connectionId } = await connectWithOwnTask();
    const essay = (await byTitle("Essay 1"))!;
    await updateTask(ctx, essay.id, { priority: 1, estimate_minutes: 120, notes: "Outline first" });
    await expect(updateTask(ctx, essay.id, { title: "My essay" })).rejects.toThrow(/Canvas/);
    await expect(updateTask(ctx, essay.id, { due_at: "2026-12-01T00:00:00Z" })).rejects.toThrow(/Canvas/);

    const r = await sync(connectionId, at(60), V2);
    expect(r.ok && r.counts.updated).toBeGreaterThanOrEqual(1);
    const after = (await byTitle("Essay 1"))!;
    expect(after).toMatchObject({ id: essay.id, due_at: "2026-11-22T04:59:00+00:00", priority: 1, estimate_minutes: 120, notes: "Outline first", status: "todo" });
    const { data: log } = await me.db.from("activity_log").select("summary").like("summary", "Canvas changed the due date%");
    expect(log).toHaveLength(1);
  });

  it("removes deleted items only after two complete syncs, parks (never deletes) the task, and restores it", async () => {
    const { connectionId } = await connectWithOwnTask();
    const quiz = (await byTitle("Quiz 3"))!;
    const r1 = await sync(connectionId, at(60), V2);
    expect(r1.ok && r1.counts).toMatchObject({ removed: 0, pendingRemoval: 1 });
    expect((await byTitle("Quiz 3"))!.status).toBe("todo");
    // Too soon after the first miss: still pending.
    const r2 = await sync(connectionId, at(70), V2);
    expect(r2.ok && r2.counts.removed).toBe(0);
    const r3 = await sync(connectionId, at(120), V2);
    expect(r3.ok && r3.counts.removed).toBe(1);
    expect((await byTitle("Quiz 3"))).toMatchObject({ id: quiz.id, status: "cancelled" });
    // It comes back in Canvas: the same task is reopened.
    const r4 = await sync(connectionId, at(180), V1);
    expect(r4.ok && r4.counts.restored).toBeGreaterThanOrEqual(1);
    expect((await byTitle("Quiz 3"))).toMatchObject({ id: quiz.id, status: "todo" });
  });

  it("detects new courses and never removes items that aged out of Canvas's window", async () => {
    const { connectionId } = await connectWithOwnTask();
    const r = await sync(connectionId, at(60), V2);
    expect(r.ok && r.counts.newCourses).toEqual(["BIOL 110 Intro Biology"]);
    expect(await byTitle("Lab 2")).toBeTruthy();
    // Two weeks later Canvas no longer sends "Lab report 1" (due Oct 20, now > 30 days ago).
    const lab = (await byTitle("Lab report 1"))!;
    await updateTask(ctx, lab.id, { status: "done" });
    const later = new Date("2026-11-26T15:00:00Z");
    const aged = without(V2, "event-assignment-1005");
    await sync(connectionId, later, aged);
    await sync(connectionId, new Date(later.getTime() + 3 * 3600_000), aged);
    const { data: item } = await me.db.from("external_items").select("state,missing_count").eq("uid", "event-assignment-1005").single();
    expect(item).toEqual({ state: "active", missing_count: 0 });
    expect((await byTitle("Lab report 1"))!.status).toBe("done");
  });

  it("keeps the previous data when a sync fails, with a helpful error, then recovers", async () => {
    const { connectionId } = await connectWithOwnTask();
    const before = await tasks();
    const fail = (err: Error) => runSync(a, connectionId, { trigger: "schedule", now: at(60), fetchFeed: async () => { throw err; } });
    const r = await fail(new FeedError("network", "x", true));
    expect(r).toMatchObject({ ok: false, code: "network", retryable: true });
    let { data: conn } = await me.db.from("integration_connections").select("*").single();
    expect(conn).toMatchObject({ status: "error", consecutive_failures: 1, last_error_code: "network" });
    expect(conn!.last_error).toMatch(/couldn't reach Canvas/i);
    expect(Date.parse(conn!.next_sync_at)).toBeGreaterThan(Date.now() + 10 * 60_000);

    // An HTML login page instead of a calendar; and a refused (reset) link.
    expect(await runSync(a, connectionId, { trigger: "schedule", now: at(61), fetchFeed: async () => "<!doctype html><title>Log in</title>" })).toMatchObject({ ok: false, code: "not_calendar" });
    expect(await fail(new FeedError("http_auth", "x"))).toMatchObject({ ok: false, code: "http_auth" });
    ({ data: conn } = await me.db.from("integration_connections").select("*").single());
    expect(conn).toMatchObject({ status: "reauth", consecutive_failures: 3 });
    expect(conn!.last_error).toMatch(/may have been reset/);
    expect(await tasks()).toEqual(before);

    const ok = await sync(connectionId, at(120), V1);
    expect(ok.ok).toBe(true);
    ({ data: conn } = await me.db.from("integration_connections").select("*").single());
    expect(conn).toMatchObject({ status: "active", consecutive_failures: 0, last_error: null });
  });

  it("removes nothing from a feed at Canvas's 1,000-item cap or an empty feed", async () => {
    const { connectionId } = await connectWithOwnTask();
    const filler = Array.from({ length: 1000 }, (_, i) => `BEGIN:VEVENT\r\nUID:event-calendar-event-9${i}\r\nDTSTART:20270115T150000Z\r\nDTEND:20270115T160000Z\r\nSUMMARY:Filler ${i}\r\nEND:VEVENT\r\n`).join("");
    const capped = without(V1, "event-assignment-1002").replace("END:VCALENDAR", `${filler}END:VCALENDAR`);
    for (const m of [60, 120]) {
      const r = await sync(connectionId, at(m), capped);
      expect(r.ok && r.status).toBe("partial");
      expect(r.ok && r.counts.pendingRemoval + r.counts.removed).toBe(0);
    }
    expect((await byTitle("Quiz 3"))!.status).toBe("todo");
    const empty = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
    for (const m of [180, 240]) {
      const r = await sync(connectionId, at(m), empty);
      expect(r.ok && r.status).toBe("partial");
    }
    expect((await tasks()).filter((t) => t.status === "cancelled")).toHaveLength(0);
  });

  it("refuses invalid feeds on connect without saving anything, and duplicate connections", async () => {
    feed = "<html>not a calendar</html>";
    await expect(connectFeed(ctx, "canvas", FEED, deps())).rejects.toThrow(/didn't return a readable calendar/);
    await expect(connectFeed(ctx, "canvas", "https://evil.example.com/feeds/calendars/user_abcdefgh123.ics", deps())).rejects.toThrow(/isn't from a Canvas site/);
    await expect(connectFeed(ctx, "canvas", "https://navi-u.instructure.com/courses/1", deps())).rejects.toThrow(/doesn't look like a Canvas calendar feed/);
    const { count } = await a.from("integration_connections").select("id", { count: "exact", head: true }).eq("user_id", me.userId);
    expect(count).toBe(0);
    feed = V1;
    await connectFeed(ctx, "canvas", FEED, deps());
    await expect(connectFeed(ctx, "canvas", FEED, deps())).rejects.toThrow(/already connected/);
  });

  it("lets the person hide items, decide duplicates, exclude and link courses", async () => {
    const { connectionId } = await connectWithOwnTask();
    const { data: items } = await me.db.from("external_items").select("id,uid,hidden_reason,course_id");
    const quizItem = items!.find((i) => i.uid === "event-assignment-1002")!;
    await setItemHidden(ctx, quizItem.id, true, { admin: a });
    expect((await byTitle("Quiz 3"))!.status).toBe("cancelled");
    await sync(connectionId, at(60), V1); // sync respects the choice
    expect((await byTitle("Quiz 3"))!.status).toBe("cancelled");
    await setItemHidden(ctx, quizItem.id, false, { admin: a });
    expect((await byTitle("Quiz 3"))!.status).toBe("todo");

    const dup = items!.find((i) => i.hidden_reason === "duplicate")!;
    await resolveDuplicate(ctx, dup.id, "keep_both", { admin: a });
    expect((await tasks()).filter((t) => /problem set 4/i.test(t.title))).toHaveLength(2);

    const { data: courses } = await me.db.from("external_courses").select("id,name");
    const hist = courses!.find((c) => c.name.startsWith("HIST"))!;
    await setCourseExcluded(ctx, hist.id, true, { admin: a });
    expect((await byTitle("Reading response"))!.status).toBe("cancelled");
    const { data: advising } = await me.db.from("events").select("status").like("title", "Advising%").single();
    expect(advising!.status).toBe("cancelled");
    await setCourseExcluded(ctx, hist.id, false, { admin: a });
    expect((await byTitle("Reading response"))!.status).toBe("todo");

    const { data: proj } = await me.db.from("projects").insert({ user_id: me.userId, name: "History essays" }).select("id").single();
    await setCourseLink(ctx, hist.id, { kind: "project", id: proj!.id }, { admin: a });
    expect((await byTitle("Reading response"))!.project_id).toBe(proj!.id);
    // Someone else's project can't be linked.
    const { data: theirs } = await other.db.from("projects").insert({ user_id: other.userId, name: "Theirs" }).select("id").single();
    await expect(setCourseLink(ctx, hist.id, { kind: "project", id: theirs!.id }, { admin: a })).rejects.toThrow(/isn't yours/);

    // Deleting an imported task in Navi is a decision: it isn't re-created.
    const essay = (await byTitle("Essay 1"))!;
    await me.db.from("tasks").delete().eq("id", essay.id);
    await sync(connectionId, at(120), V1);
    expect(await byTitle("Essay 1")).toBeUndefined();
  });

  it("isolates people: no one else can see, refresh, change or disconnect a connection", async () => {
    const { connectionId } = await connectWithOwnTask();
    const otherCtx = ctxFor(other.db, other.userId);
    const { data: seen } = await other.db.from("external_items").select("id");
    expect(seen).toEqual([]);
    const { data: item } = await me.db.from("external_items").select("id").limit(1).single();
    await expect(refreshConnection(otherCtx, connectionId, { admin: a })).rejects.toThrow(/isn't yours/);
    await expect(setItemHidden(otherCtx, item!.id, true, { admin: a })).rejects.toThrow(/isn't yours/);
    await expect(disconnectFeed(otherCtx, connectionId, { removeImported: true }, { admin: a })).rejects.toThrow(/isn't yours/);
    // Direct writes through the API are refused too (read-only to signed-in users).
    await other.db.from("integration_connections").delete().eq("id", connectionId);
    await me.db.from("external_items").update({ title: "hacked" }).eq("id", item!.id);
    const { data: still } = await a.from("external_items").select("title").eq("id", item!.id).single();
    expect(still!.title).not.toBe("hacked");
    expect((await a.from("integration_connections").select("id").eq("id", connectionId)).data).toHaveLength(1);
  });

  it("rate-limits manual refresh", async () => {
    const { connectionId } = await connectWithOwnTask();
    await expect(refreshConnection(ctx, connectionId, deps())).rejects.toThrow(/less than a minute ago/);
  });

  it("disconnects: deletes the credential and imported data, never the person's own tasks", async () => {
    const { connectionId } = await connectWithOwnTask();
    const done = (await byTitle("Lab report 1"))!;
    await updateTask(ctx, done.id, { status: "done" });
    const r = await disconnectFeed(ctx, connectionId, { removeImported: true }, { admin: a });
    expect(r).toEqual({ removedTasks: 3, removedEvents: 6 });
    const left = await tasks();
    expect(left.map((t) => t.title).sort()).toEqual(["Lab report 1 [HIST 210 Modern Europe]", "Problem set 4"]);
    expect(left.every((t) => t.external_ref === null)).toBe(true);
    for (const t of ["integration_connections", "integration_secrets", "external_items", "external_courses", "integration_sync_runs"]) {
      const { count } = await a.from(t).select("*", { count: "exact", head: true }).eq("user_id", me.userId);
      expect(count, t).toBe(0);
    }
  });

  it("disconnect can keep imported items as ordinary, editable ones", async () => {
    const { connectionId } = await connectWithOwnTask();
    await disconnectFeed(ctx, connectionId, { removeImported: false }, { admin: a });
    const essay = (await byTitle("Essay 1"))!;
    expect(essay.external_ref).toBeNull();
    await updateTask(ctx, essay.id, { title: "Essay 1 (mine now)" });
    const { data: events } = await me.db.from("events").select("external_ref");
    expect(events!.length).toBe(6);
    expect(events!.every((e) => e.external_ref === null)).toBe(true);
  });

  it("the scheduled job syncs due connections only", async () => {
    const { connectionId } = await connectWithOwnTask();
    let calls = 0;
    const fetchFeed = async () => { calls++; return V1; };
    let r = await syncDueConnections(a, { fetchFeed });
    expect(calls).toBe(0); // just synced: next run in 6 hours
    await a.from("integration_connections").update({ next_sync_at: new Date(Date.now() - 1000).toISOString() }).eq("id", connectionId);
    r = await syncDueConnections(a, { fetchFeed });
    expect(calls).toBe(1);
    expect(r.synced).toBeGreaterThanOrEqual(1);
    const { data: conn } = await me.db.from("integration_connections").select("next_sync_at").single();
    expect(Date.parse(conn!.next_sync_at)).toBeGreaterThan(Date.now() + 5.9 * 3600_000);
  });
});
