import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { admin, ANON, ctxFor, resetUser, URL_, userClient } from "./helpers";
import type {
  MAcceptManyResult,
  MApiError,
  MChatCreated,
  MChatHistory,
  MChatList,
  MDay,
  MDecideResult,
  MFocusCurrent,
  MFocusResult,
  MInbox,
  MMe,
  MOk,
  MPlanResult,
  MProposalResult,
  MTaskChange,
  MTaskGroups,
  MTaskResult,
  MUndoResult,
  MWeek,
} from "@/lib/mobile-api-types";

// The phone app's JSON API end to end against the local database: a real
// Supabase access token in `Authorization: Bearer`, verified by getCtx, with
// RLS applying as that user. Route handlers are called directly; the request
// headers stand in for Next's request scope.

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { dispatch } = await import("@/server/mobile/router");
const chatRoute = await import("@/app/api/chat/route");
const captureRoute = await import("@/app/api/capture/route");
const mRoute = await import("@/app/api/m/[...path]/route");
const { requestApproval } = await import("@/server/domain/approvals");
const { createProposals } = await import("@/server/domain/proposals");

const zone = "America/New_York";
const EMAIL = "mobile-api@navi.test";
const OTHER = "mobile-api-other@navi.test";
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

function req(method: string, path: string, body?: unknown, auth: string | null = token): Request {
  const headers: Record<string, string> = { "content-type": "application/json", origin: "capacitor://localhost" };
  if (auth !== null) headers.authorization = auth.startsWith("Bearer") || auth.startsWith("Basic") ? auth : `Bearer ${auth}`;
  return new Request(`http://localhost/api/m/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function call<T>(method: string, path: string, body?: unknown, auth: string | null = token): Promise<{ status: number; body: T }> {
  const r = req(method, path, body, auth);
  const url = new URL(r.url);
  const res = await dispatch(r, url.pathname.replace(/^\/api\/m\//, "").split("/"));
  return { status: res.status, body: (await res.json()) as T };
}
const get = <T>(path: string, auth?: string | null) => call<T>("GET", path, undefined, auth);
const post = <T>(path: string, body?: unknown, auth?: string | null) => call<T>("POST", path, body, auth);

async function setPrefs(preferences: Record<string, unknown>) {
  await admin().from("profiles").update({ preferences }).eq("id", me.userId);
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
  await admin().from("profiles").update({ preferences: {}, timezone: zone, display_name: "Mo" }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await resetUser(other.userId);
  await admin().from("ai_usage").delete().eq("user_id", me.userId);
});

describe("bearer auth", () => {
  it("answers 401 without a token, with a junk token, with a forged token, and with the public key", async () => {
    expect((await get<MApiError>("me", null)).status).toBe(401);
    expect((await get<MApiError>("me", "Bearer junk")).status).toBe(401);
    const [h, p] = token.split(".");
    const forged = `${h}.${p}.${Buffer.from("not the signature").toString("base64url")}`;
    const r = await get<MApiError>("me", forged);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "Not signed in" });
    expect((await get<MApiError>("me", `Bearer ${ANON}`)).status).toBe(401);
  });

  it("an expired-looking or other user's token never falls back to a cookie, and a valid token is that user", async () => {
    const a = await get<MMe>("me");
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ id: me.userId, email: EMAIL, displayName: "Mo", timezone: zone, autonomy: "auto", plannerV2: false });
    expect(a.body.naviColor.key).toBe("mint");
    expect(a.body.onboarding).toEqual({ status: "not_started", done: false });
    const b = await get<MMe>("me", otherToken);
    expect(b.body.id).toBe(other.userId);
  });

  it("works through the route file too, and the existing /api/chat and /api/capture routes accept the token", async () => {
    const res = await mRoute.GET(new NextRequest("http://localhost/api/m/me", { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ path: ["me"] }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MMe).id).toBe(me.userId);

    requestHeaders = new Headers({ authorization: `Bearer ${token}`, "content-type": "application/json" });
    try {
      const chat = await chatRoute.POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: requestHeaders, body: JSON.stringify({ text: "add a task to buy oat milk" }) }));
      expect(chat.status).toBe(200);
      const turn = (await chat.json()) as { conversationId: string };
      const { data: conv } = await admin().from("conversations").select("user_id").eq("id", turn.conversationId).single();
      expect(conv!.user_id).toBe(me.userId);

      const cap = await captureRoute.POST(new NextRequest("http://localhost/api/capture", { method: "POST", headers: requestHeaders, body: JSON.stringify({ client_id: "mobile-test-capture-1", raw_text: "remember to return library books" }) }));
      expect(cap.status).toBe(200);
      const { data: row } = await admin().from("captures").select("user_id").eq("client_id", "mobile-test-capture-1").single();
      expect(row!.user_id).toBe(me.userId);

      requestHeaders = new Headers({ authorization: "Bearer not.a.token" });
      const refused = await chatRoute.POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: requestHeaders, body: JSON.stringify({ text: "hi" }) }));
      expect(refused.status).toBe(401);
    } finally {
      requestHeaders = new Headers();
    }
  });

  it("validates input (400), unknown routes (404), wrong methods (405) and ids (404)", async () => {
    expect((await post<MApiError>("tasks", { title: "" })).status).toBe(400);
    expect((await get<MApiError>("nope")).status).toBe(404);
    const m = await call<MApiError>("DELETE", "me");
    expect(m.status).toBe(405);
    expect((await post<MApiError>("tasks/not-a-uuid/complete")).status).toBe(404);
    expect((await get<MApiError>("day?date=2026-13-40")).status).toBe(400);
  });
});

describe("settings", () => {
  it("saves any subset, keeps other preferences, answers with the new me, and refuses bad input", async () => {
    await setPrefs({ planner_v2: true });
    const before = await get<MMe>("me");
    expect(before.body.colourFollowsDay).toBe(true);
    const r = await call<MMe>("PATCH", "settings", {
      displayName: "Mona", morning: "06:30", evening: "21:15", briefingsEnabled: false,
      quietHours: { start: "22:00", end: "07:00" }, wakeBed: { wake: "07:00", bed: "23:30" },
      autonomy: "ask", naviColor: "rose", colourFollowsDay: false, timezone: "Europe/London",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      displayName: "Mona", timezone: "Europe/London", autonomy: "ask", colourFollowsDay: false,
      briefings: { enabled: false, morning: "06:30", evening: "21:15" },
      quietHours: { start: "22:00", end: "07:00" }, wakeBed: { wake: "07:00", bed: "23:30" },
    });
    expect(r.body.naviColor.key).toBe("rose");
    const { data } = await admin().from("profiles").select("preferences").eq("id", me.userId).single();
    expect((data!.preferences as Record<string, unknown>).planner_v2).toBe(true);

    const cleared = await call<MMe>("PATCH", "settings", { quietHours: null, colourFollowsDay: true });
    expect(cleared.body.quietHours).toBeNull();
    expect(cleared.body.colourFollowsDay).toBe(true);
    expect(cleared.body.naviColor.key).toBe("rose");

    for (const bad of [{}, { naviColor: "neon" }, { morning: "25:00" }, { timezone: "Mars/Base" }, { user_id: me.userId }, { autonomy: "yolo" }]) {
      expect((await call("PATCH", "settings", bad)).status).toBe(400);
    }
    expect((await call("PATCH", "settings", { autonomy: "ask" }, null)).status).toBe(401);
    // Another person's settings are untouched.
    const theirs = await get<MMe>("me", otherToken);
    expect(theirs.body.naviColor.key).not.toBe("rose");
  });
});

describe("chats", () => {
  it("creates, lists, renames, reads and deletes; another person can't see it", async () => {
    const made = await post<MChatCreated>("chats");
    expect(made.status).toBe(200);
    const id = made.body.id;
    expect((await get<MChatList>("chats")).body.chats.map((c) => c.id)).toContain(id);
    expect((await call<MOk>("PATCH", `chats/${id}`, { title: "Week planning" })).body.ok).toBe(true);
    expect((await get<MChatList>("chats")).body.chats.find((c) => c.id === id)?.title).toBe("Week planning");

    // A reply with two plan steps, an ordinary step and an action card.
    const card = await requestApproval({ ...ctxFor(me.db, me.userId, zone), actor: "navi" }, { actionType: "external.gmail.send", summary: "Email Sam about the flat", details: { to: "sam@example.com" } });
    const inserted = await admin().from("messages").insert([
      { user_id: me.userId, conversation_id: id, role: "user", content: "plan my day and email Sam", modality: "text", tool_events: [], created_at: new Date(Date.now() - 1000).toISOString() },
      {
        user_id: me.userId,
        conversation_id: id,
        role: "assistant",
        content: "Done. Sam's email needs your OK.",
        modality: "text",
        tool_events: [
          { name: "create_task", ok: true, summary: "Created task", display: "Added “Reply to Sam”", undo: [] },
          { name: "plan_day", ok: true, summary: "Planned", display: "Planned today", plan: true },
          { name: "move_block", ok: true, summary: "Moved", display: "Moved run to 7", plan: true },
          { name: "send_email", ok: true, summary: "Asked", action_id: card.id },
        ],
        created_at: new Date().toISOString(),
      },
    ]);
    expect(inserted.error).toBeNull();
    const h = await get<MChatHistory>(`chats/${id}/messages`);
    expect(h.status).toBe(200);
    expect(h.body.title).toBe("Week planning");
    expect(h.body.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const reply = h.body.messages[1];
    expect(reply.receipts.map((r) => r.display)).toEqual(["Added “Reply to Sam”", "Updated your plan"]);
    expect(reply.receipts[1].detail).toEqual(["Planned today", "Moved run to 7"]);
    expect(reply.cardIds).toEqual([card.id]);
    expect(h.body.actions[card.id]).toMatchObject({ status: "proposed", external: true, revision: 1 });

    expect((await get<MApiError>(`chats/${id}/messages`, otherToken)).status).toBe(404);
    expect((await get<MChatList>("chats", otherToken)).body.chats).toEqual([]);
    expect((await call<MOk>("DELETE", `chats/${id}`)).status).toBe(200);
    expect((await get<MApiError>(`chats/${id}/messages`)).status).toBe(404);
  });
});

describe("tasks, day and week", () => {
  it("creates (idempotently), groups, updates, completes and uncompletes", async () => {
    const id = crypto.randomUUID();
    const dueToday = DateTime.now().setZone(zone).endOf("day").toISO()!;
    const a = await post<MTaskResult>("tasks", { id, title: "Essay intro", due_at: dueToday, estimate_minutes: 30 });
    expect(a.status).toBe(200);
    const again = await post<MTaskResult>("tasks", { id, title: "Essay intro", due_at: dueToday, estimate_minutes: 30 });
    expect(again.body.task.id).toBe(id);
    expect((await me.db.from("tasks").select("id").eq("title", "Essay intro")).data).toHaveLength(1);
    await post<MTaskResult>("tasks", { title: "Plan the Lisbon trip", estimate_minutes: 45 });
    await post<MTaskResult>("tasks", { title: "Learn the ukulele", priority: 4 });

    let g = (await get<MTaskGroups>("tasks")).body;
    expect(g.today.map((t) => t.title)).toEqual(["Essay intro"]);
    expect(g.needsTime.map((t) => t.title)).toEqual(["Plan the Lisbon trip"]);
    expect(g.later.map((t) => t.title)).toEqual(["Learn the ukulele"]);

    const upd = await call<MTaskChange>("PATCH", `tasks/${id}`, { title: "Essay intro (draft)" });
    expect(upd.body.result).toMatchObject({ kind: "updated", row: { title: "Essay intro (draft)" } });
    const done = await post<MTaskChange>(`tasks/${id}/complete`, { actualMinutes: 25 });
    expect(done.body.result).toMatchObject({ kind: "updated", row: { status: "done" } });
    g = (await get<MTaskGroups>("tasks")).body;
    expect(g.doneToday.map((t) => t.id)).toEqual([id]);
    expect(g.today).toEqual([]);
    const un = await post<MTaskChange>(`tasks/${id}/uncomplete`);
    expect(un.body.result).toMatchObject({ kind: "updated", row: { status: "todo", completed_at: null } });

    // The person cancelling it themselves goes through at once (only Navi needs an OK for that), as on the web.
    const cancel = await call<MTaskChange>("PATCH", `tasks/${id}`, { status: "cancelled" });
    expect(cancel.body.result.kind).toBe("updated");
  });

  it("places a task at a time, refuses an overlap, and the day shows it with free time, overlaps and what needs a time", async () => {
    const date = DateTime.now().setZone(zone).plus({ days: 1 }).toISODate()!;
    const at = (hhmm: string) => DateTime.fromISO(`${date}T${hhmm}`, { zone }).toISO()!;
    const lis = (await post<MTaskResult>("tasks", { title: "Plan the Lisbon trip", estimate_minutes: 45 })).body.task;
    const lib = (await post<MTaskResult>("tasks", { title: "Return library books", estimate_minutes: 20 })).body.task;
    await admin().from("events").insert([
      { user_id: me.userId, title: "Shift", starts_at: at("09:00"), ends_at: at("13:00"), source: "user" },
      { user_id: me.userId, title: "Call with Sam", starts_at: at("12:30"), ends_at: at("13:30"), source: "user" },
    ]);
    expect((await post<MOk>(`tasks/${lis.id}/place`, { startsAt: at("15:00"), minutes: 45 })).body).toEqual({ ok: true });
    const clash = await post<MApiError>(`tasks/${lib.id}/place`, { startsAt: at("15:30"), minutes: 20 });
    expect(clash.status).toBe(400);
    expect(clash.body.error).toBe("That time overlaps “Plan the Lisbon trip”.");
    expect((await post<MApiError>(`tasks/${lib.id}/place`, { startsAt: "tomorrow", minutes: 20 })).status).toBe(400);

    const day = (await get<MDay>(`day?date=${date}`)).body;
    expect(day).toMatchObject({ date, timezone: zone, isToday: false, isPast: false, earlier: null, focusSessionId: null, plan: null });
    expect(day.items.map((i) => [i.title, i.look, i.kind])).toEqual([
      ["Shift", "fixed", "event"],
      ["Call with Sam", "fixed", "event"],
      ["Plan the Lisbon trip", "flex", "block"],
    ]);
    const block = day.items[2];
    expect(block).toMatchObject({ status: "planned", open: true, taskId: lis.id, minutes: 45, reason: "You put it here." });
    expect(day.overlaps).toHaveLength(1);
    expect(day.overlaps[0]).toMatchObject({ titles: ["Shift", "Call with Sam"], minutes: 30 });
    expect(day.items[0].overlaps).toEqual([day.items[1].key]);
    expect(day.needsTime.map((t) => t.title)).toEqual(["Return library books"]);
    expect(day.free.some((f) => f.fits?.taskId === lib.id)).toBe(true);
    expect(day.headline.map((s) => s.text).join("")).not.toBe("");

    const week = (await get<MWeek>(`week?start=${date}`)).body;
    expect(week.days).toHaveLength(7);
    const d = week.days.find((x) => x.date === date)!;
    expect(d.items).toHaveLength(3);
    expect(d.overlaps).toBe(1);
    expect(d.plannedMinutes).toBe(4 * 60 + 30 + 45); // 9:00–13:30 once, plus the 45-minute block

    // Marking the block done.
    expect((await post<MOk>(`blocks/${block.id}/outcome`, { status: "done" })).status).toBe(200);
    const after = (await get<MDay>(`day?date=${date}`)).body;
    expect(after.items[2]).toMatchObject({ done: true, open: false });
  });

  it("plans a day and a week and says what it did in one sentence", async () => {
    await admin().from("profiles").update({ availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "22:00" }] }).eq("id", me.userId);
    await post<MTaskResult>("tasks", { title: "Read chapter 4", estimate_minutes: 40 });
    const date = DateTime.now().setZone(zone).plus({ days: 1 }).toISODate()!;
    const d = await post<MPlanResult>("plan/day", { date });
    expect(d.status).toBe(200);
    expect(d.body.message).toMatch(/\.$/);
    const w = await post<MPlanResult>("plan/week", { start: date });
    expect(w.status).toBe(200);
    expect(typeof w.body.message).toBe("string");
  });
});

describe("inbox, approvals and undo", () => {
  it("lists suggestions and cards, accepts, declines, defers, edits and approves", async () => {
    const ctx = ctxFor(me.db, me.userId, zone);
    const [p1, p2, p3] = await createProposals(ctx, [
      { kind: "task", payload: { title: "Call the dentist" }, origin: "stated", confidence: 1, source_excerpt: "call the dentist" },
      { kind: "task", payload: { title: "Buy a new kettle" }, origin: "inferred", confidence: 0.6 },
      { kind: "task", payload: { title: "Water the plants" }, origin: "stated", confidence: 1 },
    ], {});
    await setPrefs({ autonomy: "ask" });
    const { runTool } = await import("@/server/ai/tools");
    const asked = await runTool({ ...ctx, actor: "navi" }, "create_task", { title: "Pay rent", user_command: "add a task to pay rent" });
    expect(asked.actionId).toBeTruthy();

    let inbox = (await get<MInbox>("inbox")).body;
    expect(inbox.counts).toEqual({ proposals: 3, approvals: 1, stated: 2 });
    expect(inbox.groups.flatMap((g) => g.proposals.map((p) => p.title)).sort()).toEqual(["Buy a new kettle", "Call the dentist", "Water the plants"]);
    expect(inbox.approvals[0]).toMatchObject({ id: asked.actionId, status: "proposed" });
    expect((await get<MMe>("me")).body.waiting).toEqual({ proposals: 3, approvals: 1 });

    expect((await call<MOk>("PATCH", `proposals/${p1.id}`, { payload: { title: "Call the dentist at 9" } })).status).toBe(200);
    const acc = await post<MProposalResult>(`proposals/${p1.id}/accept`);
    expect(acc.body.proposal).toMatchObject({ status: "accepted", title: "Call the dentist at 9" });
    expect((await me.db.from("tasks").select("id").eq("title", "Call the dentist at 9")).data).toHaveLength(1);
    expect((await post<MOk>(`proposals/${p2.id}/status`, { status: "rejected" })).status).toBe(200);
    expect((await post<MOk>(`proposals/${p3.id}/status`, { status: "deferred" })).status).toBe(200);
    inbox = (await get<MInbox>("inbox")).body;
    expect(inbox.counts.proposals).toBe(0);
    expect(inbox.deferred.map((p) => p.id)).toEqual([p3.id]);
    const many = await post<MAcceptManyResult>("proposals/accept", { ids: [p3.id] });
    expect(many.body.results).toEqual([expect.objectContaining({ id: p3.id, ok: true })]);

    // A stale revision approves nothing; the right one runs it once.
    const stale = await post<MDecideResult>(`approvals/${asked.actionId}/decide`, { decision: "approve", revision: 9 });
    expect(stale.body.action.status).toBe("proposed");
    const ok = await post<MDecideResult>(`approvals/${asked.actionId}/decide`, { decision: "approve", revision: 1 });
    expect(ok.body.action.status).toBe("completed");
    expect((await me.db.from("tasks").select("id").eq("title", "Pay rent")).data).toHaveLength(1);
    // ...and can be undone.
    const undo = await post<MUndoResult>("undo", { activityIds: ok.body.action.undo });
    expect(undo.body.undone).toBeGreaterThan(0);
    expect((await me.db.from("tasks").select("id").eq("title", "Pay rent")).data).toHaveLength(0);

    // Someone else can't act on these.
    expect((await post<MApiError>(`proposals/${p3.id}/accept`, undefined, otherToken)).status).toBe(404);
    expect((await post<MDecideResult>(`approvals/${asked.actionId}/decide`, { decision: "decline" }, otherToken)).status).toBeGreaterThanOrEqual(400);
  });

  it("reverts one activity entry", async () => {
    const t = (await post<MTaskResult>("tasks", { title: "Throwaway" })).body.task;
    const { data: log } = await me.db.from("activity_log").select("id").eq("entity_id", t.id).single();
    const r = await post<MOk>(`activity/${log!.id}/revert`);
    expect(r.status).toBe(200);
    expect((await me.db.from("tasks").select("id").eq("id", t.id)).data).toHaveLength(0);
  });
});

describe("focus and briefings", () => {
  it("starts, pauses, resumes and ends a session; reports the current one", async () => {
    const t = (await post<MTaskResult>("tasks", { title: "Practise the new song", estimate_minutes: 20 })).body.task;
    expect((await get<MFocusCurrent>("focus")).body.session).toBeNull();
    const s = (await post<MFocusResult>("focus/start", { taskId: t.id, plannedMinutes: 20 })).body.session;
    expect(s).toMatchObject({ task_id: t.id, planned_minutes: 20, ended_at: null });
    const cur = (await get<MFocusCurrent>("focus")).body.session!;
    expect(cur).toMatchObject({ id: s.id, title: "Practise the new song" });
    expect(typeof cur.elapsedSeconds).toBe("number");
    expect((await post<MFocusResult>(`focus/${s.id}/pause`)).body.session.paused_at).not.toBeNull();
    expect((await post<MFocusResult>(`focus/${s.id}/resume`)).body.session.paused_at).toBeNull();
    // Another focus on something else is refused while this one runs.
    const other = (await post<MTaskResult>("tasks", { title: "Something else" })).body.task;
    expect((await post<MApiError>("focus/start", { taskId: other.id })).status).toBe(409);
    const end = (await post<MFocusResult>(`focus/${s.id}/end`, { outcome: "completed" })).body.session;
    expect(end.outcome).toBe("completed");
    expect((await me.db.from("tasks").select("status").eq("id", t.id).single()).data!.status).toBe("done");
    expect((await post<MApiError>(`focus/${s.id}/end`, { outcome: "nope" })).status).toBe(400);
    expect((await get<MFocusCurrent>("focus")).body.session).toBeNull();
  });

  it("generates a briefing, shows it on today's day, and marks it read", async () => {
    const g = await post<{ title: string; body: string }>("briefings/generate", { kind: "morning" });
    expect(g.status).toBe(200);
    expect(g.body.title).toBeTruthy();
    const day = (await get<MDay>("day")).body;
    expect(day.isToday).toBe(true);
    expect(day.earlier).not.toBeNull();
    expect(day.briefing).toMatchObject({ kind: "morning", title: g.body.title, read_at: null });
    expect((await post<MOk>(`briefings/${day.briefing!.id}/read`)).status).toBe(200);
    expect((await get<MDay>("day")).body.briefing).toBeNull();
    expect((await post<MApiError>("briefings/generate", { kind: "hourly" })).status).toBe(400);
  });
});
