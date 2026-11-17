import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { handleTurn } from "@/server/ai/chat";
import { runTool, toolsFor } from "@/server/ai/tools";
import { decideApproval } from "@/server/domain/approvals";
import { placeTask } from "@/server/planner/place";
import { generateDayPlan } from "@/server/planner/plan";
import type { Ctx } from "@/server/context";
import type { PlanBlock } from "@/lib/types";

// Planner reliability overhaul: the historical failures (R1–R14 from the
// planner audit handoff) end to end on the local database, through the chat
// turn (the development simulator stands in for the model) and the same tool
// registry chat and voice use, with planner_commands on. Before the overhaul
// each of these failed (commit 0178231 pinned that with it.fails).

const CANDIDATE_ZONES = ["Pacific/Kiritimati", "Pacific/Auckland", "Australia/Sydney", "Asia/Tokyo", "Asia/Shanghai", "Asia/Bangkok", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "Europe/Moscow", "Europe/Berlin", "Europe/London", "Atlantic/Azores", "America/Noronha", "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Pacific/Pago_Pago"];
const zone = CANDIDATE_ZONES.find((z) => { const h = DateTime.now().setZone(z).hour; return h >= 7 && h <= 10; }) ?? "UTC";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
let navi: Ctx;
const today = () => DateTime.now().setZone(zone).toISODate()!;
const at = (hm: string) => DateTime.fromISO(`${today()}T${hm}`, { zone });
const hm = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("HH:mm");
const mins = (b: PlanBlock) => (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;

async function blocksOn(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}
async function addTask(values: Record<string, unknown>) {
  const { data, error } = await me.db.from("tasks").insert({ user_id: me.userId, ...values }).select("id,title").single();
  if (error) throw error;
  return data as { id: string; title: string };
}
async function canvasBacklog(n = 40) {
  const now = DateTime.now();
  const rows = Array.from({ length: n }, (_, i) => ({ user_id: me.userId, title: `Canvas overdue ${i}`, source: "external", external_ref: `ext:old${i}`, due_is_hard: true, due_at: now.minus({ days: 1 + (i % 30) }).toISO(), status: "todo" }));
  const { error } = await me.db.from("tasks").insert(rows);
  if (error) throw error;
}
async function say(text: string, conversationId?: string) {
  return handleTurn(user, { kind: "chat", text, modality: "text", conversationId });
}
async function approvalsOpen() {
  const { count } = await me.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "proposed");
  return count ?? 0;
}

beforeAll(async () => {
  me = await userClient("planner-reliability@navi.test");
  user = ctxFor(me.db, me.userId, zone);
  navi = { ...user, actor: "navi", autonomy: "auto" };
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ timezone: zone, availability: [], preferences: { planner_v2: true, planner_commands: true, wake_time: "07:00", bed_time: "23:00", plan_load_cap: 1 } }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

describe("R1/R2: an explicit placement request ends with the work actually planned", () => {
  it("“Put Navi work at 2 PM” in chat saves it at 2 PM and the reply says only what was verified", async () => {
    await canvasBacklog();
    const nav = await addTask({ title: "Navi work block", estimate_minutes: 60 });
    const t = await say("Put Navi work at 2 PM");
    const b = (await blocksOn(today())).find((x) => x.task_id === nav.id)!;
    expect(hm(b.starts_at)).toBe("14:00");
    expect(t.assistantMessage.content).not.toMatch(/already works|nothing changed/i);
    expect(t.assistantMessage.tool_events.map((e) => e.name)).toContain("schedule_task");
    expect(t.assistantMessage.tool_events.map((e) => e.name)).not.toContain("update_task");
  });

  it("marking something must-do says plainly that it is not scheduled (must-do ≠ a time)", async () => {
    const nav = await addTask({ title: "Navi work block", estimate_minutes: 60 });
    const r = await runTool({ ...navi, userMessage: "Navi work is a must today" }, "update_task", { id: nav.id, commitment: "must" });
    expect(r.summary).toMatch(/no work block planned yet/);
    expect(r.summary).toMatch(/NOT placed at a time/);
  });

  it("“Put Navi work at 2pm and take Algebra off today” swaps them in one verified change", async () => {
    const algebra = await addTask({ title: "Algebra Unit 4 Quiz", estimate_minutes: 60, due_is_hard: true, due_at: DateTime.now().plus({ days: 5 }).toISO() });
    const nav = await addTask({ title: "Navi work block", estimate_minutes: 60 });
    await generateDayPlan(user, today(), { trigger: "button" });
    expect((await blocksOn(today())).some((b) => b.task_id === algebra.id)).toBe(true);
    await say("Put Navi work at 2pm and take Algebra off today");
    const blocks = await blocksOn(today());
    expect(hm(blocks.find((b) => b.task_id === nav.id)!.starts_at)).toBe("14:00");
    expect(blocks.some((b) => b.task_id === algebra.id)).toBe(false);
  });
});

describe("R3/R7: a recovery day plans only the chosen work; old Canvas items wait", () => {
  it("only the listed tasks are planned, nothing imported sneaks in, and the backlog isn't called 'didn't fit'", async () => {
    await canvasBacklog();
    const ela = await addTask({ title: "ELA PowerPoint", estimate_minutes: 45 });
    const chem = await addTask({ title: "Chemistry pamphlet", estimate_minutes: 45 });
    await addTask({ title: "Algebra Unit 4 Quiz", estimate_minutes: 60, due_is_hard: true, due_at: DateTime.now().plus({ days: 1 }).toISO() });
    const t = await say("Today is a recovery day: ELA PowerPoint, Chemistry pamphlet. Old Canvas stuff can wait.");
    const planned = new Set((await blocksOn(today())).map((b) => b.task_id));
    expect(planned).toEqual(new Set([ela.id, chem.id]));
    const leftover = t.assistantMessage.tool_events.flatMap((e) => (e.leftover ? [e.leftover.line] : []));
    expect(leftover.join(" ")).not.toMatch(/\b\d{2,} things didn't fit/);
  });
});

describe("R4: clearing the day", () => {
  it("13 'delete this block' calls are 13 unschedules with no cards, and the tasks stay", async () => {
    const rows = [];
    for (let i = 0; i < 13; i++) {
      const t = await addTask({ title: `Study ${i}`, estimate_minutes: 25 });
      const s = at("11:00").plus({ minutes: i * 30 });
      rows.push({ user_id: me.userId, task_id: t.id, title: `Study ${i}`, plan_date: today(), starts_at: s.toISO(), ends_at: s.plus({ minutes: 25 }).toISO(), is_flexible: true, created_by: "navi", status: "planned" });
    }
    const { data } = await me.db.from("plan_blocks").insert(rows).select("id");
    for (const b of data ?? []) await runTool(navi, "delete_item", { table: "plan_blocks", id: b.id });
    expect(await approvalsOpen()).toBe(0);
    expect(await blocksOn(today())).toHaveLength(0);
    const { count } = await me.db.from("tasks").select("id", { count: "exact", head: true }).eq("status", "todo");
    expect(count).toBe(13);
  });

  it("“clear my full schedule today” is one change; the event stays", async () => {
    for (let i = 0; i < 5; i++) {
      const t = await addTask({ title: `Study ${i}`, estimate_minutes: 25 });
      const s = at("11:00").plus({ minutes: i * 30 });
      await me.db.from("plan_blocks").insert({ user_id: me.userId, task_id: t.id, title: `Study ${i}`, plan_date: today(), starts_at: s.toISO(), ends_at: s.plus({ minutes: 25 }).toISO(), is_flexible: true, created_by: "navi", status: "planned" });
    }
    await me.db.from("events").insert({ user_id: me.userId, title: "Practice", starts_at: at("18:00").toISO(), ends_at: at("19:00").toISO() });
    const t = await say("clear my full schedule today");
    expect(t.assistantMessage.tool_events.filter((e) => e.name === "remove_work")).toHaveLength(1);
    expect(await approvalsOpen()).toBe(0);
    expect(await blocksOn(today())).toHaveLength(0);
    expect((await me.db.from("events").select("id")).data).toHaveLength(1);
  });
});

describe("R6: work taken off today stays off when the day is re-planned", () => {
  it("unplanned Algebra isn't brought back by Plan my day, chat re-plans or the morning tick", async () => {
    const algebra = await addTask({ title: "Algebra Unit 4 Quiz", estimate_minutes: 45, due_is_hard: true, due_at: DateTime.now().plus({ days: 3 }).toISO() });
    await runTool(navi, "plan", {});
    const block = (await blocksOn(today())).find((b) => b.task_id === algebra.id)!;
    await runTool(navi, "delete_item", { table: "plan_blocks", id: block.id });
    await runTool(navi, "plan", {});
    await generateDayPlan(user, today(), { trigger: "button" });
    await generateDayPlan({ ...user, actor: "system" }, today(), { trigger: "tick" });
    expect((await blocksOn(today())).some((b) => b.task_id === algebra.id)).toBe(false);
    expect((await me.db.from("tasks").select("status").eq("id", algebra.id).single()).data!.status).toBe("todo");
  });
});

describe("R8: explicit commands in a brain dump run; inferred items still go to the inbox", () => {
  it("create_task with a time adds the task and plans it, verified, with no card", async () => {
    const r = await runTool({ ...navi, userMessage: "add the chemistry pamphlet homework and schedule it at 4" }, "create_task", { title: "Chemistry pamphlet homework", estimate_minutes: 40, user_command: "add the chemistry pamphlet homework and schedule it at 4", schedule: { start: "16:00" } });
    expect(r.ok).toBe(true);
    expect(r.actionId).toBeUndefined();
    const b = (await blocksOn(today())).find((x) => x.title === "Chemistry pamphlet homework")!;
    expect(hm(b.starts_at)).toBe("16:00");
    expect(mins(b)).toBe(40);
  });
});

describe("R9: accountability challenges once and then respects the person", () => {
  it("one challenge, then “I know, move it anyway” takes it off, with no second challenge", async () => {
    const chem = await addTask({ title: "Chemistry Unit 3 review", estimate_minutes: 30 });
    const past = DateTime.now().setZone(zone).minus({ days: 3 });
    await me.db.from("plan_blocks").insert([1, 2, 3].map((i) => ({ user_id: me.userId, task_id: chem.id, title: "Chemistry Unit 3 review", plan_date: past.minus({ days: i }).toISODate(), starts_at: past.minus({ days: i }).toISO(), ends_at: past.minus({ days: i }).plus({ minutes: 30 }).toISO(), status: "skipped", outcome_reason: "Avoided it" })));
    await generateDayPlan(user, today(), { trigger: "button" });
    const first = await say("skip chemistry today");
    expect(first.assistantMessage.content).toMatch(/Before I do that/);
    expect((await blocksOn(today())).some((b) => b.task_id === chem.id)).toBe(true);
    const second = await say("I know, move it anyway", first.conversationId);
    expect(second.assistantMessage.content).not.toMatch(/Before I do that/);
    expect((await blocksOn(today())).some((b) => b.task_id === chem.id)).toBe(false);
  });
});

describe("R10: the impact is worked out before anything changes, and saved state is checked after", () => {
  it("placing work over Navi's own plan moves it, records the impact first, and verifies after", async () => {
    await addTask({ title: "Reading", estimate_minutes: 60 });
    await addTask({ title: "Spanish", estimate_minutes: 60 });
    await generateDayPlan(user, today(), { trigger: "button" });
    const first = (await blocksOn(today()))[0];
    const nav = await addTask({ title: "Navi work block", estimate_minutes: 60 });
    const r = await runTool(navi, "schedule_task", { task_id: nav.id, start: hm(first.starts_at) });
    const d = r.data as { status: string; change_id: string; consequences: { key: string }[]; checks: { ok: boolean }[] };
    expect(d.status).toBe("applied");
    expect(d.checks.every((c) => c.ok)).toBe(true);
    const { data: cs } = await me.db.from("plan_changesets").select("impact,verification,postconditions,base_version").eq("id", d.change_id).single();
    expect(cs!.impact).toBeTruthy();
    expect(cs!.base_version).toBeTruthy();
    expect((cs!.verification as { ok: boolean }).ok).toBe(true);
    // Navi's own blocks moved out of the way; nothing overlaps.
    const blocks = await blocksOn(today());
    const overlaps = blocks.some((a) => blocks.some((b) => a.id !== b.id && Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at)));
    expect(overlaps).toBe(false);
  });
});

describe("R11: a duration the person states is respected, for that task only", () => {
  it("“30 minutes is enough” sets that task to 30 (their estimate) even with a learned ratio of 1.5", async () => {
    // History: 5 finished tasks took 1.5× their estimate.
    await me.db.from("tasks").insert(Array.from({ length: 5 }, (_, i) => ({ user_id: me.userId, title: `Done ${i}`, status: "done", estimate_minutes: 60, actual_minutes: 90, completed_at: new Date().toISOString() })));
    const ela = await addTask({ title: "ELA presentation", estimate_minutes: 60 });
    const other = await addTask({ title: "History notes", estimate_minutes: 60 });
    await say("For the ELA presentation, 30 minutes is enough");
    const { data } = await me.db.from("tasks").select("id,estimate_minutes,estimate_source").in("id", [ela.id, other.id]);
    expect(data!.find((t) => t.id === ela.id)).toEqual(expect.objectContaining({ estimate_minutes: 30, estimate_source: "user" }));
    expect(data!.find((t) => t.id === other.id)!.estimate_minutes).toBe(60);
    await generateDayPlan(user, today(), { trigger: "button" });
    const blocks = await blocksOn(today());
    expect(blocks.filter((b) => b.task_id === ela.id).reduce((s, b) => s + mins(b), 0)).toBe(30);
    expect(blocks.filter((b) => b.task_id === other.id).reduce((s, b) => s + mins(b), 0)).toBe(90);
    expect((await me.db.from("planning_rules").select("id")).data).toHaveLength(0);
  });
});

describe("R13: a proposal approved after the person changed the day doesn't override that change", () => {
  it("approving a plan made before a manual change expires instead of overlapping it", async () => {
    await addTask({ title: "Essay", estimate_minutes: 45 });
    const own = await addTask({ title: "Piano", estimate_minutes: 30 });
    const proposed = await runTool({ ...navi, autonomy: "ask" }, "plan", {});
    expect(proposed.actionId).toBeTruthy();
    const { data: cs } = await me.db.from("plan_changesets").select("ops").eq("status", "proposed").single();
    const insert = (cs!.ops as { op: string; block?: { starts_at: string } }[]).find((o) => o.op === "insert")!;
    await placeTask(user, { taskId: own.id, startsAt: insert.block!.starts_at, minutes: 30 });
    const a = await decideApproval(user, proposed.actionId!, "approve");
    expect(a.status).toBe("expired");
    const blocks = await blocksOn(today());
    const overlaps = blocks.some((x) => blocks.some((y) => x.id !== y.id && Date.parse(x.starts_at) < Date.parse(y.ends_at) && Date.parse(y.starts_at) < Date.parse(x.ends_at)));
    expect(overlaps).toBe(false);
  });
});

describe("R14 and offers: manual placements are respected; “yes” resolves to the one shown offer", () => {
  it("a block the person placed by hand stays put through Navi's re-plans", async () => {
    const piano = await addTask({ title: "Piano", estimate_minutes: 30 });
    await addTask({ title: "Essay", estimate_minutes: 120 });
    await placeTask(user, { taskId: piano.id, startsAt: at("15:00").toISO()!, minutes: 30 });
    await runTool(navi, "plan", {});
    await generateDayPlan(user, today(), { trigger: "button" });
    const b = (await blocksOn(today())).find((x) => x.task_id === piano.id)!;
    expect(hm(b.starts_at)).toBe("15:00");
    expect(b.placement).toBe("manual");
  });

  it("“What if I put Bio notes at 4pm?” shows one card; “yes” in the next message applies exactly that", async () => {
    const bio = await addTask({ title: "Bio notes", estimate_minutes: 30 });
    const first = await say("What if I put Bio notes at 4pm?");
    expect(await approvalsOpen()).toBe(1);
    expect(await blocksOn(today())).toHaveLength(0);
    await say("yes", first.conversationId);
    const blocks = await blocksOn(today());
    expect(blocks.map((b) => [b.task_id, hm(b.starts_at)])).toEqual([[bio.id, "16:00"]]);
    expect(await approvalsOpen()).toBe(0);
  });

  it("the new tools exist only when the scheduling commands are on", () => {
    expect(toolsFor("chat", { plannerV2: true }).map((t) => t.name)).not.toContain("schedule_task");
    expect(toolsFor("chat", { plannerV2: true, plannerCommands: true }).map((t) => t.name)).toEqual(expect.arrayContaining(["schedule_task", "swap_work", "remove_work", "set_day_scope", "confirm_change", "group_session"]));
    expect(toolsFor("voice", { plannerV2: true, plannerCommands: true }).map((t) => t.name)).toContain("schedule_task");
  });
});
