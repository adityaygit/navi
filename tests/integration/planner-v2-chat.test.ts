import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { handleTurn } from "@/server/ai/chat";
import { runTool, toolsFor } from "@/server/ai/tools";
import { createTask } from "@/server/domain/tasks";
import { revertActivities } from "@/server/domain/activity";
import { generateDayPlan } from "@/server/planner/plan";
import { buildDayAgenda } from "@/server/planner/agenda";
import type { Ctx } from "@/server/context";
import type { CalendarEvent, OccurrenceOverride, PlanBlock } from "@/lib/types";

// Scenario 8 (changing the schedule by talking) and scenario 4 (a cancelled
// commitment) end to end through the chat turn, with the development
// simulator standing in for the model. Plus the v2 tools' approval
// boundaries. The person's time zone is picked so it's late morning there
// now, so "today" always has room.

const CANDIDATE_ZONES = ["Pacific/Kiritimati", "Pacific/Auckland", "Australia/Sydney", "Asia/Tokyo", "Asia/Shanghai", "Asia/Bangkok", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "Europe/Moscow", "Europe/Berlin", "Europe/London", "Atlantic/Azores", "America/Noronha", "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Pacific/Pago_Pago"];
const zone = CANDIDATE_ZONES.find((z) => { const h = DateTime.now().setZone(z).hour; return h >= 8 && h <= 10; }) ?? "UTC";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
let navi: Ctx;
const today = () => DateTime.now().setZone(zone).toISODate()!;
const tomorrow = () => DateTime.now().setZone(zone).plus({ days: 1 }).toISODate()!;
const at = (date: string, hm: string) => DateTime.fromISO(`${date}T${hm}`, { zone });
const hm = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("HH:mm");

async function blocksOn(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}
async function say(text: string, conversationId?: string) {
  return handleTurn(user, { kind: "chat", text, modality: "text", conversationId });
}
async function weekly(title: string, start: string, end: string) {
  const dow = DateTime.now().setZone(zone).weekday % 7;
  const { data } = await me.db
    .from("events")
    .insert({ user_id: me.userId, title, starts_at: at(DateTime.now().setZone(zone).minus({ weeks: 2 }).toISODate()!, start).toISO(), ends_at: at(DateTime.now().setZone(zone).minus({ weeks: 2 }).toISODate()!, end).toISO(), recurrence: { freq: "weekly", days: [dow] } })
    .select("*")
    .single();
  return data as CalendarEvent;
}

beforeAll(async () => {
  me = await userClient("planner-v2-chat@navi.test");
  user = ctxFor(me.db, me.userId, zone);
  navi = { ...user, actor: "navi" };
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ timezone: zone, availability: [], preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00", plan_load_cap: 1 } }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

describe("Scenario 8: changing the schedule by talking", () => {
  it("“These are my non-negotiables…” marks them must-complete and plans everything else around them", async () => {
    const chem = await createTask(user, { title: "Chemistry lab", estimate_minutes: 90 });
    const apw = await createTask(user, { title: "AP World essay", estimate_minutes: 60 });
    const read = await createTask(user, { title: "Reading log", estimate_minutes: 60, priority: 1 });
    const r = await say("These are my non-negotiables: Chemistry lab and AP World essay. Plan everything else around them.");
    expect(r.assistantMessage.content).toMatch(/must-dos?/);
    const { data: tasks } = await me.db.from("tasks").select("id,commitment").in("id", [chem.id, apw.id, read.id]);
    expect(Object.fromEntries((tasks ?? []).map((t) => [t.id, t.commitment]))).toEqual({ [chem.id]: "must", [apw.id]: "must", [read.id]: "normal" });
    const blocks = await blocksOn(today());
    const firstOf = (id: string) => Math.min(...blocks.filter((b) => b.task_id === id).map((b) => Date.parse(b.starts_at)));
    expect(firstOf(chem.id)).toBeLessThan(firstOf(read.id));
    expect(firstOf(apw.id)).toBeLessThan(firstOf(read.id));
  });

  it("“I have karate tonight, but I need to finish Chemistry” keeps karate and puts Chemistry first", async () => {
    await weekly("Karate", "18:00", "19:30");
    const chem = await createTask(user, { title: "Chemistry problem set", estimate_minutes: 60, priority: 4 });
    await createTask(user, { title: "Guitar", estimate_minutes: 60, priority: 1 });
    const r = await say("I have karate tonight, but I need to finish Chemistry.");
    expect(r.assistantMessage.content).toMatch(/“Karate” stays where it is/);
    const blocks = await blocksOn(today());
    expect(blocks[0].task_id).toBe(chem.id);
    for (const b of blocks) expect(hm(b.ends_at) <= "18:00" || hm(b.starts_at) >= "19:30").toBe(true);
  });

  it("asks the one missing fact (karate's time) instead of guessing, and changes nothing", async () => {
    await createTask(user, { title: "Chemistry problem set", estimate_minutes: 60 });
    const r = await say("I have karate tonight, but I need to finish Chemistry.");
    expect(r.assistantMessage.content).toMatch(/What time is karate tonight\?/);
    expect(r.mutated).toBe(false);
    expect(await blocksOn(today())).toHaveLength(0);
  });

  it("a one-off time stated for tonight is saved for today only", async () => {
    await createTask(user, { title: "Chemistry problem set", estimate_minutes: 60 });
    await say("I have karate tonight 6-7:30, but I need to finish Chemistry.");
    const { data: ex } = await me.db.from("day_exceptions").select("date,kind,start_time,end_time");
    expect(ex).toEqual([{ date: today(), kind: "busy", start_time: "18:00:00", end_time: "19:30:00" }]);
    const { data: prof } = await me.db.from("profiles").select("availability").eq("id", me.userId).single();
    expect(prof!.availability).toEqual([]); // usual settings untouched
  });

  it("“My afternoon opened up. Move my studying earlier.” moves the same study block earlier", async () => {
    await me.db.from("availability_rules").insert({ user_id: me.userId, days: [0, 1, 2, 3, 4, 5, 6], start_time: "07:00", end_time: "17:00", kind: "busy", basis: "confirmed", source: "chat", note: "School and work" });
    const study = await createTask(user, { title: "Study for biology", estimate_minutes: 60 });
    await generateDayPlan(user, today());
    const [before] = await blocksOn(today());
    expect(hm(before.starts_at) >= "17:00").toBe(true);
    await say("My afternoon opened up. Move my studying earlier.");
    const after = (await blocksOn(today())).find((b) => b.task_id === study.id)!;
    expect(after.id).toBe(before.id);
    expect(hm(after.starts_at) < "17:00").toBe(true);
    expect(hm(after.starts_at) >= "12:00").toBe(true);
  });

  it("“I only have two hours today. What should I prioritize?” plans at most two hours, must-complete first", async () => {
    const must = await createTask(user, { title: "Lab writeup", estimate_minutes: 60, commitment: "must" });
    for (const [i, p] of [1, 2, 3].entries()) await createTask(user, { title: `Option ${i}`, estimate_minutes: 60, priority: p });
    const r = await say("I only have two hours today. What should I prioritize?");
    expect(r.assistantMessage.content).toMatch(/With 2 hours, prioritise “Lab writeup”/);
    const blocks = await blocksOn(today());
    expect(blocks.reduce((s, b) => s + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000, 0)).toBeLessThanOrEqual(120);
    expect(blocks[0].task_id).toBe(must.id);
  });

  it("“I'm behind on AP World. Rework the rest of my day.” puts AP World first without logging a disruption", async () => {
    await createTask(user, { title: "Math worksheet", estimate_minutes: 60, priority: 1 });
    const apw = await createTask(user, { title: "AP World reading", estimate_minutes: 60, priority: 4 });
    await generateDayPlan(user, today());
    expect((await blocksOn(today()))[0].task_id).not.toBe(apw.id);
    await say("I'm behind on AP World. Rework the rest of my day.");
    expect((await blocksOn(today()))[0].task_id).toBe(apw.id);
    const { count } = await me.db.from("plan_disruptions").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("“Build my schedule for tomorrow based on what you know” plans tomorrow with no setup, states assumptions, and “undo that” takes it back", async () => {
    await createTask(user, { title: "Essay outline", estimate_minutes: 45 });
    const r = await say("Build my schedule for tomorrow based on what you know.");
    expect(r.assistantMessage.content).toMatch(/I assumed you're free/);
    expect(await blocksOn(tomorrow())).toHaveLength(1);
    await say("undo that", r.conversationId);
    expect(await blocksOn(tomorrow())).toHaveLength(0);
  });
});

describe("Scenario 4: a cancelled fixed commitment", () => {
  it("cancels only tonight's session (no card), frees the time, and Undo brings it back", async () => {
    const karate = await weekly("Karate", "15:00", "18:00");
    await me.db.from("availability_rules").insert({ user_id: me.userId, days: [0, 1, 2, 3, 4, 5, 6], start_time: "07:00", end_time: "15:00", kind: "busy", basis: "confirmed", source: "chat", note: "School" });
    await createTask(user, { title: "Read chapter 5", estimate_minutes: 60 });
    await generateDayPlan(user, today());
    expect(hm((await blocksOn(today()))[0].starts_at) >= "18:00").toBe(true);
    const r = await say("Karate is cancelled tonight.");
    expect(r.actions ?? {}).toEqual({});
    expect(r.assistantMessage.content).toMatch(/Cancelled just .* “Karate”; the weekly one stays/);
    expect(hm((await blocksOn(today()))[0].starts_at)).toBe("15:10"); // right after school (+10 min buffer), where karate was
    const { data: ov } = await me.db.from("event_occurrence_overrides").select("*");
    const overrides = (ov ?? []) as OccurrenceOverride[];
    const agenda = (d: string) => buildDayAgenda({ date: d, zone, events: [karate], routines: [], blocks: [], tasks: [], overrides });
    expect(agenda(today()).entries).toHaveLength(0);
    expect(agenda(DateTime.fromISO(today()).plus({ weeks: 1 }).toISODate()!).entries).toHaveLength(1);
    // Undo the session change.
    const { data: log } = await me.db.from("activity_log").select("id").eq("entity_type", "event_occurrence_overrides").eq("reversible", true);
    await revertActivities(user, log!.map((l) => l.id));
    expect((await me.db.from("event_occurrence_overrides").select("id")).data).toHaveLength(0);
  });

  it("cancelling the whole series still waits for a tap", async () => {
    const karate = await weekly("Karate", "15:00", "18:00");
    const r = await runTool(navi, "update_item", { table: "events", id: karate.id, patch: { status: "cancelled" } });
    expect(r.actionId).toBeDefined();
  });
});

describe("planner v2 tools", () => {
  it("are offered only when the flag is on, and refuse to run otherwise", async () => {
    expect(toolsFor("chat").map((t) => t.name)).not.toContain("plan");
    expect(toolsFor("chat", { plannerV2: true }).map((t) => t.name)).toEqual(expect.arrayContaining(["plan", "skip_occurrence", "move_block", "undo_plan", "set_usual_time", "set_day_exception"]));
    await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
    const r = await runTool(navi, "plan", {});
    expect(r).toMatchObject({ ok: false, summary: expect.stringMatching(/isn't available/) });
  });

  it("move_block pins the block, re-fits the rest, and refuses to overlap a fixed event", async () => {
    const a = await createTask(user, { title: "Alpha", estimate_minutes: 30 });
    await createTask(user, { title: "Beta", estimate_minutes: 30 });
    await generateDayPlan(user, tomorrow());
    const blk = (await blocksOn(tomorrow())).find((b) => b.task_id === a.id)!;
    const target = at(tomorrow(), "20:00");
    const r = await runTool(navi, "move_block", { moves: [{ block_id: blk.id, start: target.toISO() }] });
    expect(r.ok).toBe(true);
    expect(r.undo!.length).toBeGreaterThanOrEqual(1);
    const moved = (await blocksOn(tomorrow())).find((b) => b.id === blk.id)!;
    expect(moved).toMatchObject({ pinned: true });
    expect(Date.parse(moved.starts_at)).toBe(target.toMillis());
    await generateDayPlan(user, tomorrow());
    expect(Date.parse((await blocksOn(tomorrow())).find((b) => b.id === blk.id)!.starts_at)).toBe(target.toMillis());

    await me.db.from("events").insert({ user_id: me.userId, title: "Dentist", starts_at: at(tomorrow(), "21:00").toISO(), ends_at: at(tomorrow(), "22:00").toISO() });
    const clash = await runTool(navi, "move_block", { moves: [{ block_id: blk.id, start: at(tomorrow(), "21:15").toISO() }] });
    expect(clash.ok).toBe(false);
    expect(clash.summary).toMatch(/would overlap “Dentist”/);
  });

  it("D6: Navi can mark a task must-complete on its own, but lowering it waits for a tap", async () => {
    const t = await createTask(user, { title: "Physics test prep", estimate_minutes: 60 });
    const up = await runTool(navi, "update_task", { id: t.id, commitment: "must" });
    expect(up.actionId).toBeUndefined();
    const down = await runTool(navi, "update_task", { id: t.id, commitment: "normal" });
    expect(down.actionId).toBeDefined();
  });

  it("B6: changing usual free times can be undone; usual times stay separate from one-day facts", async () => {
    const r = await runTool(navi, "update_settings", { availability: [{ days: [1, 2, 3, 4, 5], start: "16:00", end: "21:00" }] });
    expect(r.undo).toHaveLength(1);
    await revertActivities(user, r.undo!);
    const { data } = await me.db.from("profiles").select("availability").eq("id", me.userId).single();
    expect(data!.availability).toEqual([]);
    const usual = await runTool(navi, "set_usual_time", { days: [6], start: "09:00", end: "13:00", free: false, note: "Work" });
    expect(usual.summary).toMatch(/Usually busy Sat 09:00–13:00/);
    expect((await me.db.from("availability_rules").select("kind,basis,source")).data).toEqual([{ kind: "busy", basis: "confirmed", source: "chat" }]);
  });

  it("dependencies: a task waits for its prerequisite; loops are refused", async () => {
    const outline = await createTask(user, { title: "Outline", estimate_minutes: 30, priority: 4 });
    const draft = await createTask(user, { title: "Draft", estimate_minutes: 30, priority: 1 });
    const r = await runTool(navi, "update_task", { id: draft.id, depends_on: [outline.id] });
    expect(r.summary).toMatch(/waits for “Outline”/);
    const loop = await runTool(navi, "update_task", { id: outline.id, depends_on: [draft.id] });
    expect(loop.summary).toMatch(/loop/);
    await generateDayPlan(user, tomorrow());
    const blocks = await blocksOn(tomorrow());
    expect(blocks.map((b) => b.task_id)).toEqual([outline.id, draft.id]);
  });
});
