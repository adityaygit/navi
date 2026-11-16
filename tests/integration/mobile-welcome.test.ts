import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, ANON, ctxFor, resetUser, URL_, userClient } from "./helpers";
import type { MApiError, MOk } from "@/lib/mobile-api-types";
import type { MWelcome, MWelcomeCompleted, MWelcomeTalk } from "@/lib/mobile-api-welcome";

// Setup on the phone (M6 step 5) end to end against the local database: the
// same steps and rules as the web's /welcome, through the phone API.

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { dispatch } = await import("@/server/mobile/router");
const { createProposals } = await import("@/server/domain/proposals");
const { getOrCreateConversation } = await import("@/server/ai/chat");

const EMAIL = "mobile-welcome@navi.test";
let me: Awaited<ReturnType<typeof userClient>>;
let token: string;

async function call<T>(method: string, path: string, body?: unknown, auth: string | null = token): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${auth}`;
  const r = new Request(`http://localhost/api/m/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await dispatch(r, path.split("/"));
  return { status: res.status, body: (await res.json()) as T };
}

beforeAll(async () => {
  me = await userClient(EMAIL);
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: EMAIL, password: "test-password-123" });
  if (error) throw error;
  token = data.session!.access_token;
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {}, display_name: null }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
});

async function pickUp(titles: string[]) {
  const ctx = ctxFor(me.db, me.userId);
  const conversationId = await getOrCreateConversation(ctx, "onboarding");
  return createProposals(ctx, titles.map((t) => ({ kind: "task" as const, payload: { title: t }, origin: "stated" as const, confidence: 1, source_excerpt: t })), { conversationId, batch: "onboarding" });
}

describe("setup on the phone", () => {
  it("starts at hello, and Talk it through runs basics → talk → review → finish → stay in touch → first plan → home", async () => {
    let w = (await call<MWelcome>("GET", "welcome")).body;
    expect(w).toMatchObject({ step: "hello", status: "not_started", firstName: null, picked: 0 });

    w = (await call<MWelcome>("POST", "welcome/step", { step: "basics" })).body;
    expect(w.step).toBe("basics");

    w = (await call<MWelcome>("POST", "welcome/basics", { name: "Sam Lee", timezone: "Europe/London", wake: "07:30", bed: "23:30" })).body;
    expect(w).toMatchObject({ step: "talk", status: "in_progress", firstName: "Sam", basics: { name: "Sam Lee", timezone: "Europe/London", wake: "07:30", bed: "23:30" } });
    expect(w.checkIn).toMatchObject({ morning: "07:30", quietFrom: "23:30" });

    // Nothing picked up yet: the review can't open.
    expect((await call<MApiError>("POST", "welcome/talk-done")).status).toBe(400);

    const [a, b] = await pickUp(["Finish the history essay", "Email investors"]);
    const talk = (await call<MWelcomeTalk>("GET", "welcome/talk")).body;
    expect(talk.proposals.map((p) => p.title)).toEqual(["Finish the history essay", "Email investors"]);
    expect(Array.isArray(talk.messages)).toBe(true);
    expect((await call<MWelcome>("GET", "welcome")).body.picked).toBe(2);

    w = (await call<MWelcome>("POST", "welcome/talk-done")).body;
    expect(w).toMatchObject({ step: "review", status: "reviewing" });

    const done = await call<MWelcomeCompleted>("POST", "welcome/complete", { acceptIds: [a.id] });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ accepted: 1, failed: [] });
    const { data: left } = await admin().from("proposals").select("status,batch").eq("id", b.id).single();
    expect(left).toEqual({ status: "pending", batch: null }); // kept for Inbox, not lost
    const { data: tasks } = await admin().from("tasks").select("title").eq("user_id", me.userId);
    expect(tasks!.map((t) => t.title)).toEqual(["Finish the history essay"]);

    w = (await call<MWelcome>("GET", "welcome")).body;
    expect(w).toMatchObject({ step: "notify", status: "completed" });
    w = (await call<MWelcome>("POST", "welcome/step", { step: "plan" })).body;
    expect(w.step).toBe("plan");
    w = (await call<MWelcome>("POST", "welcome/step", { step: "done" })).body;
    expect(w.step).toBeNull();
  });

  it("quick setup: basics, then finish with nothing chosen", async () => {
    await call<MWelcome>("POST", "welcome/basics", { name: "Sam", timezone: "America/New_York", wake: "06:30", bed: "22:30" });
    const done = await call<MWelcomeCompleted>("POST", "welcome/complete", { acceptIds: [] });
    expect(done.body).toMatchObject({ accepted: 0, failed: [] });
    expect((await call<MWelcome>("GET", "welcome")).body).toMatchObject({ step: "notify", status: "completed" });
  });

  it("Later skips setup, and it picks up again at talk with what was picked up", async () => {
    await call("POST", "welcome/step", { step: "talk" });
    await pickUp(["Book a dentist"]);
    expect((await call<MOk>("POST", "welcome/skip", { step: "talk" })).body).toEqual({ ok: true });
    const { data: p } = await admin().from("profiles").select("onboarding_status").eq("id", me.userId).single();
    expect(p!.onboarding_status).toBe("skipped");
    const w = (await call<MWelcome>("POST", "welcome/restart")).body;
    expect(w).toMatchObject({ step: "talk", status: "in_progress", picked: 1 });
  });

  it("rejects a bad time zone or time, and needs a signed-in person", async () => {
    expect((await call<MApiError>("POST", "welcome/basics", { name: "Sam", timezone: "Mars/Base", wake: "07:00", bed: "23:00" })).status).toBe(400);
    expect((await call<MApiError>("POST", "welcome/basics", { name: "Sam", timezone: "UTC", wake: "7am", bed: "23:00" })).status).toBe(400);
    expect((await call<MApiError>("POST", "welcome/step", { step: "nowhere" })).status).toBe(400);
    expect((await call<MApiError>("GET", "welcome", undefined, null)).status).toBe(401);
  });
});
