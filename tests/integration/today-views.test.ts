import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { admin, ANON, resetUser, URL_, userClient } from "./helpers";
import type { MDay, MTaskGroups, MTriageResult } from "@/lib/mobile-api-types";

// Today on web and phone after the reliability release (2026-11-17): overdue
// imported (Canvas) work is ONE "needs a decision" entry, not a list of overdue
// work; it's not offered as needing a time; deciding removes it everywhere;
// work the person gave a time stays in their day. Through the real phone API
// (same loaders the web pages use) against the local database.

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { dispatch } = await import("@/server/mobile/router");
const { loadOpenWork } = await import("@/server/day-view");
const { ctxFor } = await import("./helpers");

const zone = "America/New_York";
const EMAIL = "today-views@navi.test";
const OTHER = "today-views-other@navi.test";
let me: Awaited<ReturnType<typeof userClient>>;
let other: Awaited<ReturnType<typeof userClient>>;
let token = "";
let otherToken = "";

async function accessToken(email: string) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: "test-password-123" });
  if (error) throw error;
  return data.session!.access_token;
}
async function call<T>(method: string, path: string, body?: unknown, auth = token) {
  const r = new Request(`http://localhost/api/m/${path}`, { method, headers: { "content-type": "application/json", origin: "capacitor://localhost", authorization: `Bearer ${auth}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await dispatch(r, path.split("?")[0].split("/"));
  return { status: res.status, body: (await res.json()) as T };
}

async function seed() {
  const now = DateTime.now();
  const canvas = (i: number, due: DateTime, extra: Record<string, unknown> = {}) => ({ user_id: me.userId, title: `Canvas ${i} [Chem]`, source: "external", external_ref: `ext:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, due_at: due.toISO(), due_is_hard: true, priority: 2, ...extra });
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => canvas(i, now.minus({ days: 3 + i }))), // overdue imports
    canvas(50, now.plus({ days: 5 })), // upcoming import
    { user_id: me.userId, title: "My own overdue essay", source: "user", external_ref: null, due_at: now.minus({ days: 2 }).toISO(), due_is_hard: false, priority: 2 },
    { user_id: me.userId, title: "Buy a birthday card", source: "user", external_ref: null, due_at: null, due_is_hard: false, priority: 3 },
  ];
  const { data, error } = await admin().from("tasks").insert(rows).select("id,title");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((t) => [t.title, t.id]));
}

beforeAll(async () => {
  me = await userClient(EMAIL);
  other = await userClient(OTHER);
  token = await accessToken(EMAIL);
  otherToken = await accessToken(OTHER);
});
beforeEach(async () => {
  await resetUser(me.userId);
  await resetUser(other.userId);
  await admin().from("profiles").update({ timezone: zone, preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00" }, availability: [] }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await resetUser(other.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

describe("Today: overdue imports are one decision, not a wall of overdue work", () => {
  it("phone Tasks: today holds the person's own overdue work; imports are only in needsDecision", async () => {
    const ids = await seed();
    const { body } = await call<MTaskGroups>("GET", "tasks");
    const titles = (xs: { title: string }[]) => xs.map((t) => t.title);
    expect(titles(body.today)).toEqual(["My own overdue essay"]);
    expect(body.needsDecision!.count).toBe(12);
    const everywhere = [...body.today, ...body.needsTime, ...body.later].map((t) => t.id);
    for (const t of body.needsDecision!.items) expect(everywhere).not.toContain(t.id);
    expect(titles(body.later).concat(titles(body.needsTime))).toEqual(expect.arrayContaining(["Canvas 50 [Chem]", "Buy a birthday card"]));
    expect(ids.size).toBe(15);
  });

  it("phone Day and web planner: imports aren't offered as needing a time; Day shows the decision count", async () => {
    await seed();
    const { body: day } = await call<MDay>("GET", "day");
    expect(day.needsDecision!.count).toBe(12);
    expect(day.needsTime.some((t) => t.title.startsWith("Canvas") && t.title !== "Canvas 50 [Chem]")).toBe(false);
    const work = await loadOpenWork(ctxFor(me.db, me.userId, zone), DateTime.now().setZone(zone).toISODate()!);
    expect(work.triage).toHaveLength(12);
    expect(work.openTasks.some((t) => work.triage.some((x) => x.id === t.id))).toBe(false);
  });

  it("an import the person gave a time stays in their day, not in the decision row", async () => {
    const ids = await seed();
    const id = ids.get("Canvas 0 [Chem]")!;
    const today = DateTime.now().setZone(zone);
    const start = today.endOf("day").minus({ minutes: 40 });
    await admin().from("plan_blocks").insert({ user_id: me.userId, plan_date: today.toISODate(), task_id: id, title: "Canvas 0 [Chem]", starts_at: start.toISO(), ends_at: start.plus({ minutes: 30 }).toISO(), is_flexible: true, created_by: "user", status: "planned" });
    const { body } = await call<MTaskGroups>("GET", "tasks");
    expect(body.needsDecision!.count).toBe(11);
    expect(body.today.map((t) => t.id)).toContain(id);
  });

  it("'all handed in' marks them done (read back), and they disappear from every view", async () => {
    await seed();
    const before = await call<MTaskGroups>("GET", "tasks");
    const r = await call<MTriageResult>("POST", "triage", { decision: "handed_in", ids: before.body.needsDecision!.items.map((t) => t.id) });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ changed: 12, notChanged: 0, remaining: 0 });
    const after = await call<MTaskGroups>("GET", "tasks");
    expect(after.body.needsDecision!.count).toBe(0);
    const { body: day } = await call<MDay>("GET", "day");
    expect(day.needsDecision!.count).toBe(0);
    const { count } = await me.db.from("tasks").select("id", { count: "exact", head: true }).eq("source", "external").eq("status", "done");
    expect(count).toBe(12);
    // The person's own work and the upcoming import are untouched.
    const { data: own } = await me.db.from("tasks").select("title,status").in("title", ["My own overdue essay", "Buy a birthday card", "Canvas 50 [Chem]"]);
    expect(own!.every((t) => t.status === "todo")).toBe(true);
  });

  it("someone else can't resolve my items through the phone API; bad input is a 400", async () => {
    await seed();
    const mine = (await call<MTaskGroups>("GET", "tasks")).body.needsDecision!.items.map((t) => t.id);
    const r = await call<MTriageResult>("POST", "triage", { decision: "handed_in", ids: mine }, otherToken);
    expect(r.body).toMatchObject({ changed: 0, notChanged: 12 });
    const { count } = await admin().from("tasks").select("id", { count: "exact", head: true }).eq("user_id", me.userId).eq("status", "done");
    expect(count).toBe(0);
    expect((await call("POST", "triage", { decision: "handed_in" })).status).toBe(400);
    expect((await call("POST", "triage", { decision: "delete_everything", all: true })).status).toBe(400);
  });
});
