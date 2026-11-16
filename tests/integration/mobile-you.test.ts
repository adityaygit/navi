import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { admin, ANON, resetUser, URL_, userClient } from "./helpers";
import type { MApiError, MOk } from "@/lib/mobile-api-types";
import type { MActivityList, MMemoryList, MNote, MNoteList, MProgress, MSpaceList } from "@/lib/mobile-api-you";

// Progress and the You screens of the phone API (M6 step 4) end to end against
// the local database, with a real access token and RLS applying as that user.

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { dispatch } = await import("@/server/mobile/router");

const zone = "America/New_York";
const EMAIL = "mobile-you@navi.test";
const OTHER = "mobile-you-other@navi.test";
let me: Awaited<ReturnType<typeof userClient>>;
let other: Awaited<ReturnType<typeof userClient>>;
let token: string;
let otherToken: string;

async function accessToken(email: string): Promise<string> {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: "test-password-123" });
  if (error) throw error;
  return data.session!.access_token;
}
async function call<T>(method: string, path: string, body?: unknown, auth: string | null = token): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${auth}`;
  const r = new Request(`http://localhost/api/m/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await dispatch(r, path.split("/"));
  return { status: res.status, body: (await res.json()) as T };
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
  await admin().from("profiles").update({ timezone: zone }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await resetUser(other.userId);
});

describe("GET /api/m/progress", () => {
  it("is empty and honest with nothing planned", async () => {
    const r = await call<MProgress>("GET", "progress");
    expect(r.status).toBe(200);
    expect(r.body.kept).toBeNull();
    expect(r.body.hours).toEqual([]);
    expect(r.body.headline.b).toBe("yet");
    expect(r.body.week.length).toBeGreaterThanOrEqual(2);
  });

  it("counts kept blocks fairly, hours by space, focus and slipping", async () => {
    const db = admin();
    const { data: ws } = await db.from("workspaces").insert({ user_id: me.userId, name: "School", color: "#EE7A5C" }).select().single();
    const { data: task } = await db.from("tasks").insert({ user_id: me.userId, title: "Essay", workspace_id: ws!.id }).select().single();
    const { data: due } = await db.from("tasks").insert({ user_id: me.userId, title: "Problem set", due_at: DateTime.now().plus({ hours: 20 }).toISO(), due_is_hard: true }).select().single();
    const day = DateTime.now().setZone(zone).minus({ days: 1 }).startOf("day");
    const block = (h: number, status: string, extra: Record<string, unknown> = {}) => ({
      user_id: me.userId,
      task_id: task!.id,
      title: "Essay",
      plan_date: day.toISODate(),
      starts_at: day.set({ hour: h }).toISO(),
      ends_at: day.set({ hour: h + 1 }).toISO(),
      status,
      ...extra,
    });
    // 2 done, 1 partly done, 1 skipped (counts), 1 rest (doesn't count against you).
    await db.from("plan_blocks").insert([block(9, "done"), block(11, "done"), block(13, "partial"), block(15, "skipped"), block(17, "rest", { outcome_reason: "rest" })]);
    await db.from("focus_sessions").insert({ user_id: me.userId, task_id: task!.id, started_at: day.set({ hour: 9 }).toISO(), ended_at: day.set({ hour: 10 }).toISO(), planned_minutes: 50, actual_minutes: 45, outcome: "completed" });

    const r = await call<MProgress>("GET", "progress");
    expect(r.status).toBe(200);
    expect(r.body.kept).toEqual({ done: 2, of: 4 });
    expect(r.body.focusedMinutes).toBe(45);
    // 2 h done + half of 1 h partly done.
    expect(r.body.hours).toEqual([{ name: "School", color: "#EE7A5C", minutes: 150 }]);
    expect(r.body.slipping.map((s) => s.id)).toContain(due!.id);
    expect(r.body.week[0]).toEqual({ a: "You kept ", b: "2 of 4", c: " things you planned." });

    // The other person sees none of it.
    const o = await call<MProgress>("GET", "progress", undefined, otherToken);
    expect(o.body.kept).toBeNull();
    expect(o.body.hours).toEqual([]);
  });

  it("needs a signed-in person", async () => {
    expect((await call<MApiError>("GET", "progress", undefined, null)).status).toBe(401);
  });
});

describe("memory", () => {
  it("adds, confirms a guess, corrects, rejects and deletes", async () => {
    const add = await call<MMemoryList>("POST", "memory", { content: "Not a morning person" });
    expect(add.status).toBe(200);
    expect(add.body.known.map((m) => m.content)).toEqual(["Not a morning person"]);
    expect(add.body.known[0].source).toMatch(/^You said this · /);

    const { data: guess } = await admin().from("memories").insert({ user_id: me.userId, kind: "behavioral", content: "Focuses best before noon", origin: "inferred", confidence: 0.5 }).select().single();
    let list = (await call<MMemoryList>("GET", "memory")).body;
    expect(list.guesses.map((m) => m.id)).toEqual([guess!.id]);

    list = (await call<MMemoryList>("POST", `memory/${guess!.id}/confirm`)).body;
    expect(list.guesses).toEqual([]);
    expect(list.known.find((m) => m.id === guess!.id)?.source).toMatch(/^You (said|confirmed) this/);

    const old = list.known.find((m) => m.content === "Not a morning person")!;
    list = (await call<MMemoryList>("PATCH", `memory/${old.id}`, { content: "Not a morning person on weekdays" })).body;
    expect(list.known.map((m) => m.content)).toContain("Not a morning person on weekdays");
    expect(list.known.map((m) => m.id)).not.toContain(old.id);

    const fixed = list.known.find((m) => m.content === "Not a morning person on weekdays")!;
    list = (await call<MMemoryList>("POST", `memory/${fixed.id}/reject`)).body;
    expect(list.known.map((m) => m.id)).not.toContain(fixed.id);

    list = (await call<MMemoryList>("DELETE", `memory/${guess!.id}`)).body;
    expect(list.known).toEqual([]);
    const { count } = await admin().from("memories").select("id", { count: "exact", head: true }).eq("id", guess!.id);
    expect(count).toBe(0);
  });

  it("rejects empty text and can't touch someone else's memory", async () => {
    expect((await call<MApiError>("POST", "memory", { content: "  " })).status).toBe(400);
    const { data: theirs } = await admin().from("memories").insert({ user_id: other.userId, kind: "profile", content: "Theirs", origin: "stated", confidence: 1 }).select().single();
    await call("DELETE", `memory/${theirs!.id}`);
    const { count } = await admin().from("memories").select("id", { count: "exact", head: true }).eq("id", theirs!.id);
    expect(count).toBe(1);
  });
});

describe("notes and activity", () => {
  it("creates (idempotently), edits with Undo from Activity, and deletes for good", async () => {
    const id = crypto.randomUUID();
    const a = await call<MNote>("POST", "notes", { id, title: "Essay ideas", body: "Start with 2008" });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ id, title: "Essay ideas", body: "Start with 2008" });
    await call<MNote>("POST", "notes", { id, title: "Essay ideas", body: "Start with 2008" });
    expect((await call<MNoteList>("GET", "notes")).body.notes).toHaveLength(1);

    expect((await call<MOk>("PATCH", `notes/${id}`, { title: null, body: "Start with 2008, then compare" })).status).toBe(200);
    expect((await call<MNoteList>("GET", "notes")).body.notes[0]).toMatchObject({ title: null, body: "Start with 2008, then compare" });

    // An edit shows in Activity and can be undone there.
    const act = (await call<MActivityList>("GET", "activity")).body;
    expect(act.days[0].label).toBe("Today");
    const edit = act.days[0].entries.find((e) => /updated|changed|edited/i.test(e.summary));
    expect(edit).toMatchObject({ who: "You", canUndo: true, undone: false });
    expect((await call<MOk>("POST", `activity/${edit!.id}/revert`)).status).toBe(200);
    expect((await call<MNoteList>("GET", "notes")).body.notes[0]).toMatchObject({ title: "Essay ideas", body: "Start with 2008" });
    const after = (await call<MActivityList>("GET", "activity")).body;
    expect(after.days[0].entries.find((e) => e.id === edit!.id)).toMatchObject({ canUndo: false, undone: true });

    // Deleting is for good: logged, but not offered as Undo.
    expect((await call<MOk>("DELETE", `notes/${id}`)).status).toBe(200);
    expect((await call<MNoteList>("GET", "notes")).body.notes).toEqual([]);
    const del = (await call<MActivityList>("GET", "activity")).body.days[0].entries.find((e) => /deleted note/i.test(e.summary));
    expect(del).toMatchObject({ who: "You", canUndo: false });
  });

  it("keeps each person's notes and activity to themselves", async () => {
    await call<MNote>("POST", "notes", { body: "Mine" });
    expect((await call<MNoteList>("GET", "notes", undefined, otherToken)).body.notes).toEqual([]);
    expect((await call<MActivityList>("GET", "activity", undefined, otherToken)).body.days).toEqual([]);
  });
});

describe("spaces", () => {
  it("lists spaces with open tasks and projects, and renames or recolours one", async () => {
    const db = admin();
    const { data: ws } = await db.from("workspaces").insert({ user_id: me.userId, name: "School", color: "#EE7A5C" }).select().single();
    await db.from("tasks").insert([
      { user_id: me.userId, title: "A", workspace_id: ws!.id, status: "todo" },
      { user_id: me.userId, title: "B", workspace_id: ws!.id, status: "in_progress" },
      { user_id: me.userId, title: "C", workspace_id: ws!.id, status: "done" },
    ]);
    await db.from("projects").insert({ user_id: me.userId, name: "Econ essay", workspace_id: ws!.id });
    const list = (await call<MSpaceList>("GET", "spaces")).body.spaces;
    expect(list).toEqual([{ id: ws!.id, name: "School", color: "#EE7A5C", openTasks: 2, projects: ["Econ essay"] }]);

    expect((await call<MOk>("PATCH", `spaces/${ws!.id}`, { name: "Uni", color: "#9A7BE0" })).status).toBe(200);
    expect((await call<MSpaceList>("GET", "spaces")).body.spaces[0]).toMatchObject({ name: "Uni", color: "#9A7BE0" });
    expect((await call<MApiError>("PATCH", `spaces/${ws!.id}`, { color: "purple" })).status).toBe(400);
    expect((await call<MApiError>("PATCH", `spaces/${ws!.id}`, {})).status).toBe(400);

    // Someone else can't rename it.
    const r = await call<MApiError>("PATCH", `spaces/${ws!.id}`, { name: "Mine now" }, otherToken);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await call<MSpaceList>("GET", "spaces")).body.spaces[0].name).toBe("Uni");
  });
});
