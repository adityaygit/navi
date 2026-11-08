import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { runTool } from "@/server/ai/tools";
import { createTask } from "@/server/domain/tasks";
import { decideApproval } from "@/server/domain/approvals";
import { revertActivities } from "@/server/domain/activity";
import { updateEntity } from "@/server/domain/entities";
import { generateDayPlan, generateWeekPlan, recoverPlan } from "@/server/planner/plan";
import { tickUser } from "@/server/jobs/tick";
import type { Ctx } from "@/server/context";
import type { PlanBlock, Profile } from "@/lib/types";

// Planner v2 against the local database: change sets (apply, propose, undo),
// stable block ids, pinned blocks, "ask me first", concurrency, recovery and
// the morning tick. Validation scenarios 1, 9 and parts of 4/5/10 from
// docs/navi-1.5/PLANNING_AUDIT.md.

const zone = "America/New_York";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
let navi: Ctx;
const day = () => DateTime.now().setZone(zone).plus({ days: 3 }).toISODate()!;
const V2 = { planner_v2: true, wake_time: "07:00", bed_time: "23:00" };

async function prefs(extra: Record<string, unknown> = {}) {
  await admin().from("profiles").update({ preferences: { ...V2, ...extra }, availability: [], timezone: zone }).eq("id", me.userId);
}
async function blocksOn(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}

beforeAll(async () => {
  me = await userClient("planner-v2@navi.test");
  user = ctxFor(me.db, me.userId, zone);
  navi = { ...user, actor: "navi" };
});
beforeEach(async () => {
  await resetUser(me.userId);
  await me.db.from("plan_changesets").delete().eq("user_id", me.userId);
  await me.db.from("day_exceptions").delete().eq("user_id", me.userId);
  await me.db.from("availability_rules").delete().eq("user_id", me.userId);
  await prefs();
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

describe("planner v2: saving plans as change sets", () => {
  it("Scenario 1: with no free-time windows, Navi plans in assumed time, says so, and the run can be undone", async () => {
    await createTask(user, { title: "Chemistry review", estimate_minutes: 60 });
    const r = await runTool(navi, "plan_day", { date: day() });
    expect(r.ok).toBe(true);
    expect(r.actionId).toBeUndefined();
    expect(r.undo).toHaveLength(1);
    expect(r.summary).toMatch(/I assumed you're free/);
    const blocks = await blocksOn(day());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ basis: "inferred", created_by: "navi" });
    expect(DateTime.fromISO(blocks[0].starts_at).setZone(zone).hour).toBeGreaterThanOrEqual(7);
  });

  it("re-planning keeps block ids when nothing changed (B7), and only moves what changed", async () => {
    await createTask(user, { title: "Essay", estimate_minutes: 60 });
    const first = await generateDayPlan(user, day());
    expect(first.run?.status).toBe("applied");
    const ids = (await blocksOn(day())).map((b) => b.id);
    const again = await generateDayPlan(user, day());
    expect(again.run?.status).toBe("unchanged");
    expect((await blocksOn(day())).map((b) => b.id)).toEqual(ids);
    // A new fixed event where the block was: the same block moves (same id).
    const b = (await blocksOn(day()))[0];
    await me.db.from("events").insert({ user_id: me.userId, title: "Dentist", starts_at: b.starts_at, ends_at: b.ends_at });
    const third = await generateDayPlan(user, day());
    expect(third.moved).toBe(1);
    const after = await blocksOn(day());
    expect(after.map((x) => x.id)).toEqual(ids);
    expect(after[0].starts_at).not.toBe(b.starts_at);
  });

  it("Scenario 9: Undo restores the previous plan exactly, once, and refuses if a block was edited since", async () => {
    await createTask(user, { title: "Flashcards", estimate_minutes: 30 });
    await generateDayPlan(user, day());
    const before = await blocksOn(day());
    await me.db.from("events").insert({ user_id: me.userId, title: "Call", starts_at: before[0].starts_at, ends_at: before[0].ends_at });
    const r = await runTool(navi, "plan_day", { date: day() });
    const moved = await blocksOn(day());
    expect(moved[0].starts_at).not.toBe(before[0].starts_at);
    const [a, b] = await Promise.all([revertActivities(user, r.undo!), revertActivities(user, r.undo!)]);
    expect(a.undone + b.undone).toBe(1);
    const restored = await blocksOn(day());
    expect(restored.map((x) => [x.id, Date.parse(x.starts_at)])).toEqual(before.map((x) => [x.id, Date.parse(x.starts_at)]));

    // Edited since: the undo is refused instead of throwing the edit away.
    const r2 = await runTool(navi, "plan_day", { date: day() });
    const blk = (await blocksOn(day()))[0];
    await updateEntity(user, "plan_blocks", blk.id, { title: "Flashcards (with Sam)" });
    await me.db.from("plan_blocks").update({ status: "done" }).eq("id", blk.id);
    await expect(revertActivities(user, r2.undo!)).rejects.toThrow(/changed (again )?since/);
  });

  it("B2: a pinned block stays where it is through re-plans", async () => {
    const t = await createTask(user, { title: "Practice piano", estimate_minutes: 30 });
    await generateDayPlan(user, day());
    const [b] = await blocksOn(day());
    const at = DateTime.fromISO(`${day()}T20:00`, { zone });
    await me.db.from("plan_blocks").update({ starts_at: at.toISO(), ends_at: at.plus({ minutes: 30 }).toISO(), pinned: true }).eq("id", b.id);
    await createTask(user, { title: "Other", estimate_minutes: 30, priority: 1 });
    await generateDayPlan(user, day());
    const after = await blocksOn(day());
    expect(after.find((x) => x.id === b.id)).toMatchObject({ pinned: true, task_id: t.id });
    expect(Date.parse(after.find((x) => x.id === b.id)!.starts_at)).toBe(at.toMillis());
    expect(after.filter((x) => x.task_id === t.id)).toHaveLength(1); // not booked twice
  });

  it("two planning runs at once don't double-book the day", async () => {
    await createTask(user, { title: "Draft cover letter", estimate_minutes: 45 });
    await Promise.all([generateDayPlan(user, day()), generateDayPlan(user, day())]);
    const blocks = await blocksOn(day());
    expect(blocks.reduce((m, b) => m + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000, 0)).toBe(45);
  });

  it("a week plan is one change set with one Undo", async () => {
    for (let i = 0; i < 3; i++) await createTask(user, { title: `Week task ${i}`, estimate_minutes: 60 });
    const days = await generateWeekPlan(navi, day());
    expect(new Set(days.map((d) => d.run?.changesetId)).size).toBe(1);
    const undo = days[0].run!.undo;
    expect(undo).toHaveLength(1);
    await revertActivities(user, undo);
    const { count } = await me.db.from("plan_blocks").select("id", { count: "exact", head: true }).gte("plan_date", day());
    expect(count).toBe(0);
  });
});

describe("planner v2: proposals and approvals", () => {
  it("D8/B8: in 'ask me first' mode a plan is a proposal card; nothing changes until approved, then it can be undone", async () => {
    await prefs({ autonomy: "ask" });
    await createTask(user, { title: "Lab report", estimate_minutes: 60 });
    const r = await runTool(navi, "plan_day", { date: day() });
    expect(r.actionId).toBeDefined();
    expect(r.summary).toMatch(/^Proposed, nothing changed yet/);
    expect(await blocksOn(day())).toHaveLength(0);
    const { data: card } = await me.db.from("approvals").select("action_type,details").eq("id", r.actionId!).single();
    expect(card!.action_type).toBe("internal.plan.apply");
    expect((card!.details as { lines: unknown[] }).lines.length).toBeGreaterThan(0);
    const done = await decideApproval(user, r.actionId!, "approve", admin());
    expect(done.status).toBe("completed");
    expect(await blocksOn(day())).toHaveLength(1);
    const undo = (done.result as { undo: string[] }).undo;
    expect(undo).toHaveLength(1);
    await revertActivities(user, undo);
    expect(await blocksOn(day())).toHaveLength(0);
  });

  it("a proposal made out of date by a newer plan expires instead of overwriting it", async () => {
    await createTask(user, { title: "Read ch. 4", estimate_minutes: 30 });
    const proposal = await generateDayPlan(navi, day(), { mode: "propose" });
    await generateDayPlan(user, day()); // applied directly
    const result = await decideApproval(user, proposal.run!.actionId!, "approve", admin());
    expect(result.status).toBe("expired");
    expect(await blocksOn(day())).toHaveLength(1);
  });

  it("declining a proposal leaves the plan untouched", async () => {
    await createTask(user, { title: "Vocab", estimate_minutes: 30 });
    const proposal = await generateDayPlan(navi, day(), { mode: "propose" });
    const declined = await decideApproval(user, proposal.run!.actionId!, "reject", admin());
    expect(declined.status).toBe("declined");
    expect(await blocksOn(day())).toHaveLength(0);
    const { data: cs } = await me.db.from("plan_changesets").select("status").eq("id", proposal.run!.changesetId!).single();
    expect(cs!.status).toBe("expired");
  });
});

describe("planner v2: recovery and the morning tick", () => {
  it("recovery marks, re-plans and carries over in one change set that undoes as a whole", async () => {
    const now = DateTime.now().setZone(zone);
    const today = now.toISODate()!;
    await prefs({ wake_time: "00:00", bed_time: "23:59" });
    const t = await createTask(user, { title: "Recovery task", estimate_minutes: 30, priority: 1 });
    const start = now.minus({ minutes: 10 });
    const { data: blk } = await me.db
      .from("plan_blocks")
      .insert({ user_id: me.userId, task_id: t.id, title: t.title, plan_date: today, starts_at: start.toISO(), ends_at: start.plus({ minutes: 30 }).toISO(), created_by: "navi" })
      .select("id")
      .single();
    const undo: string[] = [];
    const r = await recoverPlan({ ...user, onActivity: (e) => e.reversible && undo.push(e.id) }, { description: "Fire drill", category: "interruption" });
    expect(r.affected).toBe(1);
    expect(r.summary).toMatch(/You can undo this/);
    const { data: marked } = await me.db.from("plan_blocks").select("status").eq("id", blk!.id).single();
    expect(marked!.status).toBe("interrupted");
    expect(undo).toHaveLength(1);
    await revertActivities(user, undo);
    const { data: back } = await me.db.from("plan_blocks").select("status").eq("id", blk!.id).single();
    expect(back!.status).toBe("planned");
    const { count: open } = await me.db.from("tasks").select("id", { count: "exact", head: true }).eq("id", t.id).eq("status", "todo");
    expect(open).toBe(1);
  });

  it("B11: the morning tick plans the day even with no saved free times", async () => {
    const now = DateTime.now().setZone(zone);
    await admin().from("profiles").update({ morning_briefing_time: now.minus({ minutes: 5 }).toFormat("HH:mm"), briefings_enabled: true }).eq("id", me.userId);
    await prefs({ wake_time: "00:00", bed_time: "23:59" });
    await createTask(user, { title: "Tick task", estimate_minutes: 15 });
    const { data: profile } = await admin().from("profiles").select("*").eq("id", me.userId).single();
    await tickUser(admin(), profile as Profile, DateTime.now());
    const { data: briefing } = await me.db.from("briefings").select("body").eq("kind", "morning").eq("local_date", now.toISODate()!).maybeSingle();
    expect(briefing?.body ?? "").not.toMatch(/doesn't know your availability/);
    const { count } = await me.db.from("plan_changesets").select("id", { count: "exact", head: true }).eq("trigger", "tick");
    expect(count).toBe(1);
  });
});
