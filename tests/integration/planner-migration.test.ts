import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { createTask } from "@/server/domain/tasks";
import { generateDayPlan } from "@/server/planner/plan";
import type { Ctx } from "@/server/context";
import type { PlanBlock } from "@/lib/types";

// Scenario 10: moving existing accounts to the new planner without
// disturbing their schedules. The flag is per account and off by default;
// turning it on changes nothing until the next plan; for an account with
// only saved free-time windows the first new plan keeps every block where it
// was (same ids); turning it off again goes back to the old planner.

const zone = "America/New_York";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
const day = () => DateTime.now().setZone(zone).plus({ days: 4 }).toISODate()!;
const windows = [{ days: [0, 1, 2, 3, 4, 5, 6], start: "16:00", end: "21:00" }];

async function blocksOn(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}
const shape = (bs: PlanBlock[]) => bs.map((b) => [b.id, b.task_id ?? b.routine_id, Date.parse(b.starts_at), Date.parse(b.ends_at)]);

beforeAll(async () => {
  me = await userClient("planner-migration@navi.test");
  user = ctxFor(me.db, me.userId, zone);
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ timezone: zone, availability: windows, preferences: {} }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

describe("Scenario 10: migrating existing accounts", () => {
  it("the flag is off by default: plans are made by the old planner, with no change sets", async () => {
    await createTask(user, { title: "Old-style task", estimate_minutes: 30 });
    const r = await generateDayPlan(user, day());
    expect(r.run).toBeUndefined();
    const blocks = await blocksOn(day());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].basis).toBeNull();
    expect((await me.db.from("plan_changesets").select("id")).data).toEqual([]);
  });

  it("turning it on moves nothing; the first new plan keeps an existing schedule exactly (same blocks, same ids)", async () => {
    await createTask(user, { title: "Essay", estimate_minutes: 100, priority: 1 });
    await createTask(user, { title: "Reading", estimate_minutes: 45 });
    await me.db.from("routines").insert({ user_id: me.userId, title: "Dinner", days: [0, 1, 2, 3, 4, 5, 6], start_time: "18:00", duration_minutes: 45, is_fixed: false });
    await generateDayPlan(user, day()); // old planner
    const before = await blocksOn(day());
    expect(before.length).toBeGreaterThan(1);

    await admin().from("profiles").update({ preferences: { planner_v2: true, plan_load_cap: 1 } }).eq("id", me.userId);
    expect(shape(await blocksOn(day()))).toEqual(shape(before)); // nothing moved by switching

    const r = await generateDayPlan(user, day());
    // Applied (blocks gain the v2 "confirmed" label) or unchanged, but never moved.
    expect(["applied", "unchanged"]).toContain(r.run?.status);
    expect(shape(await blocksOn(day()))).toEqual(shape(before));
    const after = await blocksOn(day());
    expect(after.every((b) => b.basis === "confirmed")).toBe(true);
    // A second plan is now a no-op.
    const again = await generateDayPlan(user, day());
    expect(again.run?.status).toBe("unchanged");
    // The timed routine that wasn't marked fixed still stays at its time (backfill semantics).
    expect(r.fixed.some((f) => f.title === "Dinner")).toBe(true);
  });

  it("with the approved defaults (D7: about 70% of free time), only work that's held back moves off the day; nothing else shifts", async () => {
    for (let i = 0; i < 5; i++) await createTask(user, { title: `Task ${i}`, estimate_minutes: 60, priority: 2 });
    await generateDayPlan(user, day());
    const before = await blocksOn(day());
    await admin().from("profiles").update({ preferences: { planner_v2: true } }).eq("id", me.userId);
    const r = await generateDayPlan(user, day());
    const after = await blocksOn(day());
    for (const b of after) {
      const was = before.find((x) => x.id === b.id);
      expect(was && Date.parse(was.starts_at)).toBe(Date.parse(b.starts_at));
    }
    expect(r.unscheduled.every((u) => u.why === "Kept free so the day isn't packed" || /fit/.test(u.why))).toBe(true);
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it("an account with the wake-to-bed setup default gets its plan labelled as assumed time", async () => {
    await admin().from("profiles").update({ availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "07:00", end: "23:00" }], preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00" } }).eq("id", me.userId);
    await createTask(user, { title: "Inferred", estimate_minutes: 30 });
    await generateDayPlan(user, day());
    expect((await blocksOn(day()))[0].basis).toBe("inferred");
  });

  it("turning it off again goes back to the old planner, which re-plans over the new planner's blocks", async () => {
    await createTask(user, { title: "Roundtrip", estimate_minutes: 30 });
    await admin().from("profiles").update({ preferences: { planner_v2: true } }).eq("id", me.userId);
    await generateDayPlan(user, day());
    expect((await blocksOn(day()))[0].changeset_id).not.toBeNull();
    await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
    const r = await generateDayPlan(user, day());
    expect(r.run).toBeUndefined();
    const blocks = await blocksOn(day());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].changeset_id).toBeNull();
  });
});
