import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { runTool } from "@/server/ai/tools";
import { createTask } from "@/server/domain/tasks";
import { generateDayPlan } from "@/server/planner/plan";
import type { Ctx } from "@/server/context";

// Characterization of how plans are saved, undone and approved TODAY, before
// the constraint-first planning work (docs/navi-1.5/PLANNING_AUDIT.md).
// "ROOT CAUSE" tests pin behaviour the audit proposes to change; update them
// deliberately when that lands. The rest is behaviour to keep.

const zone = "America/New_York";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
let navi: Ctx;
const day = () => DateTime.now().setZone(zone).plus({ days: 3 }).toISODate()!;
const workHours = [{ days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "17:00" }];

beforeAll(async () => {
  me = await userClient("planning-audit@navi.test");
  user = ctxFor(me.db, me.userId, zone);
  navi = { ...user, actor: "navi" };
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {}, availability: workHours }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
});

async function blocksOn(d: string) {
  return (await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? [];
}

describe("saving and replacing a plan", () => {
  it("ROOT CAUSE: Navi's plan_day runs at once and leaves nothing to undo", async () => {
    await createTask(user, { title: "Chemistry review", estimate_minutes: 60 });
    const r = await runTool(navi, "plan_day", { date: day() });
    expect(r.ok).toBe(true);
    expect(r.actionId).toBeUndefined();
    expect(r.undo).toBeUndefined();
    expect((await blocksOn(day())).length).toBeGreaterThan(0);
    const { data: log } = await me.db.from("activity_log").select("action,reversible").eq("action", "plan_generated");
    expect(log).toEqual([{ action: "plan_generated", reversible: false }]);
  });

  it("ROOT CAUSE: re-planning deletes Navi's planned blocks and writes new rows; user-made and marked blocks are kept as they are", async () => {
    await createTask(user, { title: "Essay", estimate_minutes: 60 });
    await generateDayPlan(user, day());
    const first = await blocksOn(day());
    const mine = await me.db
      .from("plan_blocks")
      .insert({ user_id: me.userId, title: "My block", plan_date: day(), starts_at: DateTime.fromISO(`${day()}T15:00`, { zone }).toISO(), ends_at: DateTime.fromISO(`${day()}T15:30`, { zone }).toISO(), created_by: "user" })
      .select("id")
      .single();
    await generateDayPlan(user, day());
    const second = await blocksOn(day());
    const naviIds = (rows: typeof first) => rows.filter((b) => b.created_by === "navi").map((b) => b.id);
    expect(naviIds(second).length).toBe(naviIds(first).length);
    expect(naviIds(second).some((id) => naviIds(first).includes(id))).toBe(false); // same plan, new rows
    expect(second.map((b) => b.id)).toContain(mine.data!.id);
  });

  it("ROOT CAUSE: in 'ask me first' mode, planning still runs without a card", async () => {
    await admin().from("profiles").update({ preferences: { autonomy: "ask" } }).eq("id", me.userId);
    await createTask(user, { title: "Flashcards", estimate_minutes: 30 });
    const r = await runTool(navi, "plan_day", { date: day() });
    expect(r.actionId).toBeUndefined();
    expect((await blocksOn(day())).length).toBeGreaterThan(0);
  });
});

describe("approval boundaries for schedule changes", () => {
  it("Navi moves a flexible block on its own, with Undo; moving a fixed block waits for a tap", async () => {
    await createTask(user, { title: "Read chapter", estimate_minutes: 30 });
    await generateDayPlan(user, day());
    const [b] = await blocksOn(day());
    const later = (iso: string) => DateTime.fromISO(iso).plus({ hours: 1 }).toISO();
    const moved = await runTool(navi, "update_item", { table: "plan_blocks", id: b.id, patch: { starts_at: later(b.starts_at), ends_at: later(b.ends_at) } });
    expect(moved.actionId).toBeUndefined();
    expect(moved.undo).toHaveLength(1);

    await admin().from("plan_blocks").update({ is_flexible: false }).eq("id", b.id);
    const fixed = await runTool(navi, "update_item", { table: "plan_blocks", id: b.id, patch: { starts_at: b.starts_at, ends_at: b.ends_at } });
    expect(fixed.actionId).toBeDefined();
  });

  it("a timed routine not marked fixed changes at once; a fixed routine waits for a tap", async () => {
    const { data: dinner } = await me.db.from("routines").insert({ user_id: me.userId, title: "Dinner", days: [0, 1, 2, 3, 4, 5, 6], start_time: "18:00", duration_minutes: 60, is_fixed: false }).select("id").single();
    const { data: school } = await me.db.from("routines").insert({ user_id: me.userId, title: "School", days: [1, 2, 3, 4, 5], start_time: "08:00", duration_minutes: 420, is_fixed: true }).select("id").single();
    const a = await runTool(navi, "update_item", { table: "routines", id: dinner!.id, patch: { start_time: "19:00" } });
    expect(a.actionId).toBeUndefined();
    expect(a.undo).toHaveLength(1);
    const b = await runTool(navi, "update_item", { table: "routines", id: school!.id, patch: { start_time: "09:00" } });
    expect(b.actionId).toBeDefined();
  });

  it("ROOT CAUSE: cancelling tonight's karate means cancelling the weekly event itself, which waits for a tap", async () => {
    const start = DateTime.now().setZone(zone).startOf("day").set({ hour: 18 });
    const { data: ev } = await me.db
      .from("events")
      .insert({ user_id: me.userId, title: "Karate", starts_at: start.toISO(), ends_at: start.plus({ minutes: 90 }).toISO(), recurrence: { freq: "weekly", days: [start.weekday % 7] } })
      .select("id")
      .single();
    const r = await runTool(navi, "update_item", { table: "events", id: ev!.id, patch: { status: "cancelled" } });
    expect(r.actionId).toBeDefined();
    const { data: approval } = await me.db.from("approvals").select("details").eq("id", r.actionId!).single();
    expect(approval!.details).toMatchObject({ op: "update", table: "events", patch: { status: "cancelled" } });
  });

  it("ROOT CAUSE: changing availability through update_settings runs at once and can't be undone", async () => {
    const r = await runTool(navi, "update_settings", { availability: [{ days: [1, 2, 3, 4, 5], start: "16:00", end: "21:00" }] });
    expect(r.ok).toBe(true);
    expect(r.actionId).toBeUndefined();
    expect(r.undo).toBeUndefined();
    const { data } = await me.db.from("profiles").select("availability").eq("id", me.userId).single();
    expect(data!.availability).toEqual([{ days: [1, 2, 3, 4, 5], start: "16:00", end: "21:00" }]);
  });
});
