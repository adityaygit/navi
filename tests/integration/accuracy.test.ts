import { beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { ctxFor, resetUser, userClient } from "./helpers";
import { jsonSchemaFor, runTool, toolsFor } from "@/server/ai/tools";
import { handleTurn } from "@/server/ai/chat";
import { CHAT_SYSTEM, ONBOARDING_SYSTEM } from "@/server/ai/prompts";
import { acceptMany, acceptProposal, createProposals } from "@/server/domain/proposals";
import { processCapture, saveCapture } from "@/server/domain/capture";

// Accuracy fixes from the first real-model run: Navi can read any day's plan,
// reads current state instead of trusting chat history, reports task dates
// exactly, records the user's name in onboarding, and accepted questions are
// kept rather than vanishing.

let db: Awaited<ReturnType<typeof userClient>>["db"];
let userId = "";
const zone = "America/New_York";
const ctx = () => ctxFor(db, userId, zone);
const now = () => DateTime.now().setZone(zone);

beforeAll(async () => {
  ({ db, userId } = await userClient("alice@navi.test"));
  await resetUser(userId);
});

describe("reading the plan for other days", () => {
  it("get_plan shows tomorrow's blocks, weekly events, routines and tasks due, and the overview shows tomorrow", async () => {
    const tomorrow = now().plus({ days: 1 }).startOf("day");
    const dow = tomorrow.weekday % 7;
    const at = (h: number, m = 0) => tomorrow.set({ hour: h, minute: m }).toISO()!;
    // A weekly event whose stored first occurrence was three weeks ago.
    const first = tomorrow.minus({ weeks: 3 }).set({ hour: 9 });
    await db.from("events").insert({ user_id: userId, title: "Piano lesson", starts_at: first.toISO(), ends_at: first.plus({ hours: 1 }).toISO(), recurrence: { freq: "weekly", days: [dow] } });
    await db.from("routines").insert({ user_id: userId, title: "Morning run", days: [dow], start_time: "07:00", duration_minutes: 30, is_fixed: false });
    await db.from("plan_blocks").insert({ user_id: userId, title: "Call mom", plan_date: tomorrow.toISODate(), starts_at: at(14), ends_at: at(14, 30), is_flexible: true, created_by: "navi" });
    await db.from("tasks").insert({ user_id: userId, title: "Return library books", due_at: tomorrow.endOf("day").set({ second: 0, millisecond: 0 }).toISO(), due_is_hard: false });
    await db.from("tasks").insert({ user_id: userId, title: "Due next week", due_at: tomorrow.plus({ days: 7 }).toISO() });

    const r = await runTool(ctx(), "get_plan", { date: "tomorrow" });
    expect(r.ok).toBe(true);
    const text = String(r.data);
    expect(text).toContain(`${tomorrow.toISODate()}, tomorrow`);
    expect(text).toMatch(/7:00 AM–7:30 AM Morning run \(routine, preferred time \(can move\)\)/);
    expect(text).toMatch(/9:00 AM–10:00 AM Piano lesson \(fixed event, weekly\)/);
    expect(text).toMatch(/2:00 PM–2:30 PM Call mom \(flexible plan block, planned\)/);
    expect(text).toContain("Return library books (P3, todo, due 11:59 PM, soft)");
    expect(text).not.toContain("Due next week");

    // A range, and an explicit date, work the same way.
    const range = String((await runTool(ctx(), "get_plan", { date: now().toISODate(), days: 3 })).data);
    expect(range.match(/^\w+day, \w{3} \d+ \d{4} \(/gm)).toHaveLength(3);
    expect(range).toContain("Call mom");
    expect((await runTool(ctx(), "get_plan", { date: "2026-02-31" })).ok).toBe(false);

    const overview = String((await runTool(ctx(), "get_overview", {})).data);
    expect(overview).toMatch(/Tomorrow's plan \([\d-]+\): .*Call mom/);
    expect(overview).toMatch(/Fixed events, next 7 days: .*Piano lesson/);
  });

  it("is offered to text chat and voice alike", () => {
    for (const mode of ["chat", "voice"] as const) {
      const names = toolsFor(mode).map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["get_plan", "get_inbox", "search_items"]));
    }
  });
});

describe("answering from current state", () => {
  it("get_inbox lists recent captures, what became of each item, and recent changes", async () => {
    const { capture } = await saveCapture(ctx(), { client_id: `acc-${Date.now()}`, raw_text: "buy groceries tomorrow. call the dentist on monday", source: "text" });
    await processCapture(ctx(), capture.id);
    const { data: items } = await db.from("proposals").select("*").eq("capture_id", capture.id).order("created_at");
    expect(items!.length).toBe(2);
    const groceries = items!.find((p) => /groceries/i.test(p.payload.title))!;
    await acceptProposal(ctx(), groceries.id);

    const text = String((await runTool(ctx(), "get_inbox", {})).data);
    expect(text).toContain("“buy groceries tomorrow. call the dentist on monday”");
    expect(text).toMatch(/task “Buy groceries”.* — accepted → task “Buy groceries” \(now todo\)/);
    expect(text).toMatch(/Review inbox \(pending\/deferred, newest first\): \n  - task “Call the dentist”/);
    expect(text).not.toMatch(/Review inbox[^\n]*\n  - task “Buy groceries”/);
    expect(text).toMatch(/Recent activity[\s\S]*Accepted task from inbox: “Buy groceries”/);

    // search_items sees both the accepted task and the still-pending inbox item.
    const found = (await runTool(ctx(), "search_items", { query: "dentist" })).data as { tasks: unknown[]; inbox_items_not_yet_accepted: { title: string; status: string }[] };
    expect(found.tasks).toEqual([]);
    expect(found.inbox_items_not_yet_accepted).toEqual([expect.objectContaining({ title: "Call the dentist", status: "pending" })]);

    // The chat path answers "what did I just capture?" from a fresh read (simulator mirrors the tool use).
    const turn = await handleTurn(ctx(), { kind: "chat", text: "what did I just capture?", modality: "text" });
    expect(turn.assistantMessage.content).toContain("buy groceries tomorrow");
    expect(turn.assistantMessage.content).toMatch(/accepted → task “Buy groceries”/);
  });

  it("tells the model to check tools for current state instead of chat history", () => {
    expect(CHAT_SYSTEM).toMatch(/Check, don't recall/);
    expect(CHAT_SYSTEM).toMatch(/quick captures and dashboard edits never appear in chat history/);
    expect(CHAT_SYSTEM).toMatch(/get_plan for a date or range/);
    expect(CHAT_SYSTEM).toMatch(/Before create_task, check search_items/);
    expect(CHAT_SYSTEM).toMatch(/When history and a tool result disagree, the tool result is right/);
  });
});

describe("create_task says exactly what was set", () => {
  it("reports a soft due date as a due date, not a scheduled time", async () => {
    const sunday = now().plus({ days: ((7 - now().weekday) % 7) || 7 }).endOf("day").set({ second: 0, millisecond: 0 });
    const r = await runTool({ ...ctx(), actor: "navi" }, "create_task", { title: "Call mom", due_at: sunday.toISO(), due_is_hard: false, user_command: "add a task to call mom on Sunday" });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe(`Created task “Call mom”: soft due date ${sunday.toFormat("cccc LLL d")}. It is not scheduled at a set time; tasks have no do-date, only a due date (plan_day can place it in that day's free time)`);
    const { data } = await db.from("tasks").select("due_at,due_is_hard,notes").eq("title", "Call mom").single();
    expect(data).toMatchObject({ due_is_hard: false, notes: null });
    expect(Date.parse(data!.due_at)).toBe(sunday.toMillis());
  });

  it("an update to a task's due date says exactly what's set and what's already planned", async () => {
    const { data: t } = await db.from("tasks").insert({ user_id: userId, title: "Call grandpa" }).select("id").single();
    const sat = now().plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    await db.from("plan_blocks").insert({ user_id: userId, task_id: t!.id, title: "Call grandpa", plan_date: sat.toISODate(), starts_at: sat.toISO(), ends_at: sat.plus({ minutes: 15 }).toISO(), is_flexible: true, created_by: "navi" });
    const sunday = now().plus({ days: 2 }).endOf("day").set({ second: 0, millisecond: 0 });
    const r = await runTool({ ...ctx(), actor: "navi" }, "update_task", { id: t!.id, due_at: sunday.toISO(), due_is_hard: false });
    expect(r.summary).toBe(`Updated task “Call grandpa”: soft due date ${sunday.toFormat("cccc LLL d")}; work already planned in blocks at ${sat.toFormat("ccc LLL d h:mm a")}`);
  });

  it("flags a day the user named when no date was set", async () => {
    const r = await runTool({ ...ctx(), actor: "navi" }, "create_task", { title: "Water plants", user_command: "add a task to water the plants on Sunday" });
    expect(r.summary).toContain("no due date. The request mentions “Sunday” but no date was set, so don't say it's on Sunday");
    const plain = await runTool({ ...ctx(), actor: "navi" }, "create_task", { title: "Fix bike", user_command: "add a task to fix my bike" });
    expect(plain.summary).toBe("Created task “Fix bike”: no due date");
  });
});

describe("onboarding records the user's name", () => {
  it("asks for it, proposes it with the setup, and saves it on accept", async () => {
    expect(ONBOARDING_SYSTEM).toMatch(/What they'd like to be called/);
    expect(ONBOARDING_SYSTEM).toMatch(/include display_name in the preference item/);
    const prefDoc = JSON.stringify(jsonSchemaFor(toolsFor("onboarding").find((t) => t.name === "propose_items")!));
    expect(prefDoc).toContain("preference:{display_name");

    await resetUser(userId);
    const c = ctx();
    await handleTurn(c, { kind: "onboarding", text: "hi", modality: "text" });
    await handleTurn(c, { kind: "onboarding", text: "I'm Alex. I'm in school and I need to finish my history essay by friday.", modality: "voice" });
    await handleTurn(c, { kind: "onboarding", text: "I'm free after 6pm on weekdays. Quiet 10pm to 7am. That's it.", modality: "text" });
    const { data: proposals } = await db.from("proposals").select("*").eq("batch", "onboarding").eq("status", "pending");
    const pref = proposals!.find((p) => p.kind === "preference")!;
    expect(pref.payload.display_name).toBe("Alex");
    await acceptMany(c, [pref.id]);
    const { data: profile } = await db.from("profiles").select("display_name").eq("id", userId).single();
    expect(profile!.display_name).toBe("Alex");
  });
});

describe("accepted questions are kept", () => {
  it("saves an accepted question to memory instead of dropping it", async () => {
    const [q] = await createProposals(ctx(), [{ kind: "question", payload: { question: "Should I drop AP chemistry?" }, source_excerpt: "should i drop ap chem??", origin: "stated", confidence: 0.9 }], {});
    const accepted = await acceptProposal(ctx(), q.id);
    expect(accepted).toMatchObject({ status: "accepted", result_table: "memories" });
    const { data: mem } = await db.from("memories").select("kind,content,origin").eq("id", accepted.result_id!).single();
    expect(mem).toEqual({ kind: "episodic", content: "Open question: Should I drop AP chemistry?", origin: "stated" });
    // And Navi can read where it went.
    const { data: again } = await db.from("proposals").select("status").eq("id", q.id).single();
    expect(again!.status).toBe("accepted");
  });
});

describe("captures don't invent a time of day", () => {
  it("tells the model the rule", () => {
    expect(CHAT_SYSTEM).toMatch(/Never invent a time of day the user didn't say/);
    expect(CHAT_SYSTEM).toMatch(/\("on Friday" said on a Friday\) is ambiguous/);
  });

  it("moves an invented time to the end of the named day, keeps stated times, and explains it", async () => {
    const raw = "call mom on thursday. dentist thursday. pick up suit thursday at 3pm";
    const { capture } = await saveCapture(ctx(), { client_id: crypto.randomUUID(), raw_text: raw, source: "text" });
    const thu = now().plus({ days: 1 }).startOf("day"); // any date works: only the time of day is checked
    const at = (h: number) => thu.set({ hour: h }).toISO()!;
    const r = await runTool({ ...ctx(), actor: "navi", captureId: capture.id }, "propose_items", {
      items: [
        { kind: "task", payload: { title: "Call mom", due_at: at(18) }, source_excerpt: "call mom on thursday", origin: "stated", confidence: 0.9 },
        { kind: "event", payload: { title: "Dentist", starts_at: at(18), ends_at: at(19) }, source_excerpt: "dentist thursday", origin: "stated", confidence: 0.8 },
        { kind: "event", payload: { title: "Pick up suit", starts_at: at(15), ends_at: at(16) }, source_excerpt: "pick up suit thursday at 3pm", origin: "stated", confidence: 0.9 },
      ],
    });
    expect(r.ok).toBe(true);
    const { data } = await db.from("proposals").select("kind,payload,rationale").eq("capture_id", capture.id).order("created_at");
    const byTitle = Object.fromEntries((data ?? []).map((p) => [p.payload.title, p]));
    const local = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("yyyy-LL-dd HH:mm");
    expect(local(byTitle["Call mom"].payload.due_at)).toBe(`${thu.toISODate()} 23:59`);
    expect(byTitle["Call mom"].rationale).toMatch(/No time of day was given/);
    expect(byTitle["Dentist"].kind).toBe("task");
    expect(local(byTitle["Dentist"].payload.due_at)).toBe(`${thu.toISODate()} 23:59`);
    expect(byTitle["Pick up suit"]).toMatchObject({ kind: "event", payload: { starts_at: at(15) } });
  });
});

describe("notes are findable", () => {
  it("search_items finds a saved note by its title or its text", async () => {
    await db.from("notes").insert({ user_id: userId, title: "Passport", body: "Renewal form is in the blue folder" });
    await db.from("notes").insert({ user_id: userId, body: "Locker combination hint: birthday backwards" });
    const byTitle = await runTool(ctx(), "search_items", { query: "passport" });
    const notes = (byTitle.data as { notes: { title: string | null; text: string }[] }).notes;
    expect(notes).toEqual([expect.objectContaining({ title: "Passport", text: "Renewal form is in the blue folder" })]);
    const byText = await runTool(ctx(), "search_items", { query: "locker" });
    expect((byText.data as { notes: { text: string }[] }).notes.map((n) => n.text)).toEqual(["Locker combination hint: birthday backwards"]);
  });
});

describe("proposing memories", () => {
  it("accepts a memory whose origin is given on the item rather than in the payload", async () => {
    // Gemini Live sent this shape and retried a dozen times against the old check.
    const r = await runTool({ ...ctx(), actor: "navi" }, "propose_items", {
      items: [{ kind: "memory", payload: { content: "Studies biology at college" }, origin: "stated", confidence: 1 }],
    });
    expect(r).toMatchObject({ ok: true, summary: "Added 1 item to the review inbox" });
    const { data: p } = await db.from("proposals").select("id,payload").eq("kind", "memory").order("created_at", { ascending: false }).limit(1).single();
    expect(p!.payload).toEqual({ kind: "profile", content: "Studies biology at college", origin: "stated" });
    const accepted = await acceptProposal(ctx(), p!.id);
    expect(accepted.result_table).toBe("memories");
  });

  it("names the broken item by its content when a problem is reported", async () => {
    const r = await runTool({ ...ctx(), actor: "navi" }, "propose_items", {
      items: [{ kind: "memory", payload: { kind: "nonsense", content: "Likes mornings" }, origin: "stated", confidence: 1 }],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toContain("item 1 (memory “Likes mornings”)");
  });
});

describe("weekday numbering in proposals", () => {
  it("corrects a batch that counted Monday as 0, using the events' own dates", async () => {
    await resetUser(userId);
    // The shape Gemini Live sent in the real voice-onboarding run.
    const r = await runTool({ ...ctx(), actor: "navi" }, "propose_items", {
      batch: "onboarding",
      items: [
        { kind: "event", payload: { title: "Coffee shop job", starts_at: "2026-11-07T08:00:00-05:00", ends_at: "2026-11-07T14:00:00-05:00", recurrence: { freq: "weekly", days: [5] } }, origin: "stated", confidence: 1 },
        { kind: "preference", payload: { display_name: "Sam", availability: [{ days: [0, 1, 2, 3, 4], start: "19:00", end: "22:00" }] }, origin: "stated", confidence: 1 },
      ],
    });
    expect(r.ok).toBe(true);
    const { data } = await db.from("proposals").select("kind,payload,rationale").eq("batch", "onboarding").order("created_at");
    const ev = data!.find((p) => p.kind === "event")!;
    const pref = data!.find((p) => p.kind === "preference")!;
    expect(ev.payload.recurrence.days).toEqual([6]);
    expect(pref.payload.availability[0].days).toEqual([1, 2, 3, 4, 5]);
    expect(ev.rationale).toMatch(/off by one/);
  });

  it("tells the model the numbering and the UTC offset to use", async () => {
    expect(CHAT_SYSTEM).toMatch(/Weekday numbers are 0 = Sunday, 1 = Monday \.\.\. 6 = Saturday/);
    expect(CHAT_SYSTEM).toMatch(/never "Z" unless their time zone is UTC/);
    const overview = String((await runTool(ctx(), "get_overview", {})).data);
    expect(overview).toMatch(/\(America\/New_York, UTC offset [+-]\d\d:\d\d/);
  });
});
