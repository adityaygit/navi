import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import type { Ctx } from "@/server/context";

// Races and retries against the local database: double taps, two devices,
// a dropped connection that makes the client send the same thing again.
// Each must leave exactly one result behind and never report false success.

let current: Ctx;
vi.mock("@/server/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/context")>();
  return { ...actual, requireApiCtx: async () => current, getCtx: async () => current };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { startFocus, endFocus, pauseFocus, resumeFocus } = await import("@/server/domain/tasks");
const { focusElapsedSeconds } = await import("@/lib/focus");
const { saveCapture, processCapture } = await import("@/server/domain/capture");
const { createProposals, mergeProposalIntoTask } = await import("@/server/domain/proposals");
const actions = await import("@/app/(app)/actions");
const { handleTurn } = await import("@/server/ai/chat");
const captureRoute = await import("@/app/api/capture/route");
const voiceTurnRoute = await import("@/app/api/voice/turn/route");
const chatRoute = await import("@/app/api/chat/route");

let me: Awaited<ReturnType<typeof userClient>>;
const zone = "America/New_York";

beforeAll(async () => {
  me = await userClient("reliability@navi.test");
  current = ctxFor(me.db, me.userId, zone);
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("ai_usage").delete().eq("user_id", me.userId);
});

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function newTask(title: string) {
  const { data, error } = await me.db.from("tasks").insert({ user_id: me.userId, title }).select().single();
  if (error) throw error;
  return data as { id: string; actual_minutes: number };
}
async function openSessions() {
  return (await me.db.from("focus_sessions").select("*").is("ended_at", null)).data ?? [];
}
/** Move a session's clock back so minutes are measurable without waiting. */
async function backdate(id: string, fields: Record<string, number>) {
  const patch = Object.fromEntries(Object.entries(fields).map(([k, minAgo]) => [k, new Date(Date.now() - minAgo * 60_000).toISOString()]));
  await admin().from("focus_sessions").update(patch).eq("id", id);
}

describe("focus", () => {
  it("two simultaneous starts leave one open session, and both get it", async () => {
    const task = await newTask("Write the report");
    const [a, b] = await Promise.all([startFocus(current, { task_id: task.id }), startFocus(current, { task_id: task.id })]);
    expect(a.id).toBe(b.id);
    expect(await openSessions()).toHaveLength(1);
  });

  it("refuses a second session for something else while one is open", async () => {
    const one = await newTask("One");
    const two = await newTask("Two");
    await startFocus(current, { task_id: one.id });
    await expect(startFocus(current, { task_id: two.id })).rejects.toThrow(/already running/);
    expect(await openSessions()).toHaveLength(1);
  });

  it("a double end adds the minutes to the task once", async () => {
    const task = await newTask("Deep work");
    const s = await startFocus(current, { task_id: task.id });
    await backdate(s.id, { started_at: 30 });
    const [a, b] = await Promise.all([endFocus(current, s.id, "progress"), endFocus(current, s.id, "progress")]);
    expect(a.id).toBe(b.id);
    await endFocus(current, s.id, "progress"); // and a late retry
    const { data: t } = await me.db.from("tasks").select("actual_minutes").eq("id", task.id).single();
    expect(t!.actual_minutes).toBe(30);
    const { data: ended } = await me.db.from("focus_sessions").select("*").eq("id", s.id).single();
    expect(ended!.actual_minutes).toBe(30);
    const { count } = await me.db.from("activity_log").select("id", { count: "exact", head: true }).eq("action", "focus_ended");
    expect(count).toBe(1);
  });

  it("pause and resume: paused time doesn't count", async () => {
    const task = await newTask("Paused work");
    const s = await startFocus(current, { task_id: task.id });
    await backdate(s.id, { started_at: 40 });
    const paused = await pauseFocus(current, s.id);
    expect(paused.paused_at).toBeTruthy();
    // Pausing twice changes nothing.
    expect((await pauseFocus(current, s.id)).paused_at).toBe(paused.paused_at);
    await backdate(s.id, { paused_at: 10 }); // paused for the last 10 minutes
    const whilePaused = (await me.db.from("focus_sessions").select("*").eq("id", s.id).single()).data!;
    expect(Math.round(focusElapsedSeconds(whilePaused, Date.now()) / 60)).toBe(30);
    const resumed = await resumeFocus(current, s.id);
    expect(resumed.paused_at).toBeNull();
    expect(Math.round(resumed.paused_seconds / 60)).toBe(10);
    expect(Math.round(focusElapsedSeconds(resumed, Date.now()) / 60)).toBe(30);
    // A paused session ending also leaves its current pause out.
    await pauseFocus(current, s.id);
    await backdate(s.id, { paused_at: 5 });
    const ended = await endFocus(current, s.id, "progress");
    expect(ended.actual_minutes).toBe(25);
    const { data: t } = await me.db.from("tasks").select("actual_minutes").eq("id", task.id).single();
    expect(t!.actual_minutes).toBe(25);
  });

  it("pure elapsed math", () => {
    const start = Date.parse("2026-11-06T10:00:00Z");
    const s = { started_at: new Date(start).toISOString(), paused_seconds: 120, paused_at: null };
    expect(focusElapsedSeconds(s, start + 600_000)).toBe(480);
    const p = { ...s, paused_at: new Date(start + 300_000).toISOString() };
    expect(focusElapsedSeconds(p, start + 600_000)).toBe(180);
  });
});

describe("capture", () => {
  const TEXT = "Buy stamps tomorrow and call the dentist on Friday";

  it("processing the same capture twice at once creates one set of proposals", async () => {
    const reference = await saveCapture(current, { client_id: "capture-reference-1", raw_text: TEXT, source: "text" });
    await processCapture(current, reference.capture.id);
    const expected = (await me.db.from("proposals").select("id").eq("capture_id", reference.capture.id)).data!.length;
    expect(expected).toBeGreaterThan(0);

    const { capture } = await saveCapture(current, { client_id: "capture-race-1", raw_text: TEXT, source: "text" });
    const results = await Promise.all([processCapture(current, capture.id), processCapture(current, capture.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["processed", "processing"]);
    const { data: proposals } = await me.db.from("proposals").select("id").eq("capture_id", capture.id);
    expect(proposals).toHaveLength(expected);
    const { data: cap } = await me.db.from("captures").select("status").eq("id", capture.id).single();
    expect(cap!.status).toBe("processed");
  });

  it("the capture endpoint, retried concurrently with one client id, stores and splits it once", async () => {
    const body = { client_id: "capture-route-race-1", raw_text: TEXT, source: "offline" };
    const responses = await Promise.all([captureRoute.POST(post("/api/capture", body)), captureRoute.POST(post("/api/capture", body))]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const { data: caps } = await me.db.from("captures").select("id").eq("client_id", body.client_id);
    expect(caps).toHaveLength(1);
    const again = await captureRoute.POST(post("/api/capture", body));
    expect((await again.json()).duplicate).toBe(true);
    const { data: proposals } = await me.db.from("proposals").select("id,payload").eq("capture_id", caps![0].id);
    const titles = proposals!.map((p) => (p.payload as { title?: string }).title).filter(Boolean);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("a claim left behind by a crashed request is taken over, without re-running if proposals exist", async () => {
    const { capture } = await saveCapture(current, { client_id: "capture-stale-1", raw_text: TEXT, source: "text" });
    await admin().from("captures").update({ status: "processing", claimed_at: new Date(Date.now() - 10 * 60_000).toISOString() }).eq("id", capture.id);
    const r = await processCapture(current, capture.id);
    expect(r.status).toBe("processed");
    expect((await me.db.from("proposals").select("id").eq("capture_id", capture.id)).data!.length).toBeGreaterThan(0);
  });
});

describe("review inbox", () => {
  it("accept all with an item that can't be accepted reports it, and still accepts the rest", async () => {
    const [good, bad] = await createProposals(current, [
      { kind: "task", payload: { title: "Renew passport" }, origin: "stated", confidence: 1 },
      { kind: "task", payload: { notes: "no title here" }, origin: "stated", confidence: 1 },
    ], {});
    const r = await actions.acceptManyAction([good.id, bad.id]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Accepted 1 of 2/);
    expect(r.error).toMatch(/needs fixing/);
    expect(r).toMatchObject({ changed: true });
    const { data: rows } = await me.db.from("proposals").select("id,status").in("id", [good.id, bad.id]);
    expect(Object.fromEntries(rows!.map((p) => [p.id, p.status]))).toEqual({ [good.id]: "accepted", [bad.id]: "pending" });

    const ok = await actions.acceptManyAction([]);
    expect(ok.ok).toBe(true);
  });

  it("reports ids that no longer exist instead of skipping them", async () => {
    const r = await actions.acceptManyAction(["00000000-0000-4000-8000-000000000000"]);
    expect(r.ok).toBe(false);
  });

  it("a double merge changes the task once", async () => {
    const task = await newTask("Dentist");
    const [p] = await createProposals(current, [{ kind: "task", payload: { title: "Call the dentist" }, origin: "stated", confidence: 1 }], {});
    const results = await Promise.allSettled([mergeProposalIntoTask(current, p.id, task.id), mergeProposalIntoTask(current, p.id, task.id)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const { data: t } = await me.db.from("tasks").select("notes").eq("id", task.id).single();
    expect((t!.notes as string).match(/Merged from inbox/g)).toHaveLength(1);
    const { data: after } = await me.db.from("proposals").select("status,result_id").eq("id", p.id).single();
    expect(after).toEqual({ status: "merged", result_id: task.id });
  });
});

describe("task create", () => {
  it("a retry with the same client id returns the same task instead of a second one", async () => {
    const id = crypto.randomUUID();
    const [a, b] = await Promise.all([actions.createTaskAction({ id, title: "Pay rent" }), actions.createTaskAction({ id, title: "Pay rent" })]);
    const c = await actions.createTaskAction({ id, title: "Pay rent" });
    for (const r of [a, b, c]) {
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.data as { id: string }).id).toBe(id);
    }
    const { data: rows } = await me.db.from("tasks").select("id").eq("title", "Pay rent");
    expect(rows).toHaveLength(1);
    // Without an id it still works as before.
    const d = await actions.createTaskAction({ title: "No id" });
    expect(d.ok).toBe(true);
  });

  it("can't take over someone else's id", async () => {
    const other = await userClient("reliability-other@navi.test");
    await resetUser(other.userId);
    const { data: theirs } = await other.db.from("tasks").insert({ user_id: other.userId, title: "Theirs" }).select().single();
    const r = await actions.createTaskAction({ id: theirs!.id, title: "Mine" });
    expect(r.ok).toBe(false);
    const { data: still } = await other.db.from("tasks").select("title").eq("id", theirs!.id).single();
    expect(still!.title).toBe("Theirs");
    await resetUser(other.userId);
  });
});

describe("chat turn idempotency", () => {
  async function tasksTitled(title: string) {
    return (await me.db.from("tasks").select("id").eq("title", title)).data ?? [];
  }

  it("the same message sent again doesn't run Navi again, and returns the saved reply", async () => {
    const clientMessageId = crypto.randomUUID();
    const input = { kind: "chat" as const, text: "add a task to water the ferns", modality: "text" as const, clientMessageId };
    const first = await handleTurn(current, input);
    expect(await tasksTitled("water the ferns")).toHaveLength(1);
    const again = await handleTurn(current, { ...input, conversationId: null });
    expect(again.replayed).toBe(true);
    expect(again.conversationId).toBe(first.conversationId);
    expect(again.userMessage.id).toBe(first.userMessage.id);
    expect(again.assistantMessage.id).toBe(first.assistantMessage.id);
    expect(await tasksTitled("water the ferns")).toHaveLength(1);
    const { count: convs } = await me.db.from("conversations").select("id", { count: "exact", head: true }).eq("kind", "chat");
    expect(convs).toBe(1);
    const { data: msgs } = await me.db.from("messages").select("role").eq("conversation_id", first.conversationId);
    expect(msgs!.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("two simultaneous sends of one message: one runs, the other is told it's in progress or gets the same reply", async () => {
    const clientMessageId = crypto.randomUUID();
    const input = { kind: "chat" as const, text: "add a task to sort the mail", modality: "text" as const, clientMessageId };
    const results = await Promise.allSettled([handleTurn(current, input), handleTurn(current, input)]);
    const done = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof handleTurn>>> => r.status === "fulfilled");
    expect(done.length).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === "rejected") expect((r.reason as { status?: number }).status).toBe(409);
    expect(await tasksTitled("sort the mail")).toHaveLength(1);
    const { data: msgs } = await me.db.from("messages").select("role");
    expect(msgs!.filter((m) => m.role === "user")).toHaveLength(1);
    expect(msgs!.filter((m) => m.role === "assistant")).toHaveLength(1);
    // No empty chat left behind by the request that lost.
    const { count: convs } = await me.db.from("conversations").select("id", { count: "exact", head: true }).eq("kind", "chat");
    expect(convs).toBe(1);
    // And once it's done, a retry gets the saved reply.
    const later = await handleTurn(current, input);
    expect(later.replayed).toBe(true);
    expect(later.assistantMessage.id).toBe(done[0].value.assistantMessage.id);
  });

  it("the chat endpoint passes clientMessageId through and says 409 while a turn is still running", async () => {
    const clientMessageId = crypto.randomUUID();
    const first = await chatRoute.POST(post("/api/chat", { text: "add a task to fix the gate", clientMessageId }));
    expect(first.status).toBe(200);
    const a = await first.json();
    const second = await chatRoute.POST(post("/api/chat", { text: "add a task to fix the gate", clientMessageId }));
    const b = await second.json();
    expect(b.replayed).toBe(true);
    expect(b.assistantMessage.id).toBe(a.assistantMessage.id);
    expect(await tasksTitled("fix the gate")).toHaveLength(1);

    // A message whose reply isn't saved yet (still being answered).
    const pendingId = crypto.randomUUID();
    await me.db.from("messages").insert({ user_id: me.userId, conversation_id: a.conversationId, role: "user", content: "still thinking", client_id: pendingId });
    const busy = await chatRoute.POST(post("/api/chat", { text: "still thinking", clientMessageId: pendingId }));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: "turn_in_progress", conversationId: a.conversationId });
  });
});

describe("voice turn idempotency", () => {
  it("a retried voice turn is saved once; a retry carrying more words updates it", async () => {
    const conv = (await me.db.from("conversations").insert({ user_id: me.userId, kind: "chat", title: "New chat" }).select("id").single()).data!.id;
    const clientTurnId = crypto.randomUUID();
    const body = { conversationId: conv, clientTurnId, userText: "what's on today", assistantText: "Two blocks." };
    const r1 = await voiceTurnRoute.POST(post("/api/voice/turn", body));
    const r2 = await voiceTurnRoute.POST(post("/api/voice/turn", body));
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect((await r2.json()).duplicate).toBe(true);
    let { data: msgs } = await me.db.from("messages").select("role,content").eq("conversation_id", conv).order("created_at");
    expect(msgs).toEqual([{ role: "user", content: "what's on today" }, { role: "assistant", content: "Two blocks." }]);

    // The client keeps an unsaved turn and sends it again with what came after.
    const r3 = await voiceTurnRoute.POST(post("/api/voice/turn", { ...body, userText: "what's on today and tomorrow", assistantText: "Two blocks. Tomorrow is free." }));
    expect(r3.status).toBe(200);
    ({ data: msgs } = await me.db.from("messages").select("role,content").eq("conversation_id", conv).order("created_at"));
    expect(msgs).toEqual([{ role: "user", content: "what's on today and tomorrow" }, { role: "assistant", content: "Two blocks. Tomorrow is free." }]);

    // Without an id it saves as before.
    await voiceTurnRoute.POST(post("/api/voice/turn", { conversationId: conv, userText: "thanks" }));
    ({ data: msgs } = await me.db.from("messages").select("role,content").eq("conversation_id", conv));
    expect(msgs).toHaveLength(3);
  });

  it("concurrent retries of one voice turn leave one pair of messages", async () => {
    const conv = (await me.db.from("conversations").insert({ user_id: me.userId, kind: "chat", title: "New chat" }).select("id").single()).data!.id;
    const body = { conversationId: conv, clientTurnId: crypto.randomUUID(), userText: "remind me later", assistantText: "Okay." };
    const rs = await Promise.all([voiceTurnRoute.POST(post("/api/voice/turn", body)), voiceTurnRoute.POST(post("/api/voice/turn", body))]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    const { data: msgs } = await me.db.from("messages").select("role").eq("conversation_id", conv);
    expect(msgs).toHaveLength(2);
  });
});
