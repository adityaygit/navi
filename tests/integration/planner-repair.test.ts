import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { runTool } from "@/server/ai/tools";
import { createTask } from "@/server/domain/tasks";
import { generateDayPlan } from "@/server/planner/plan";
import type { Ctx } from "@/server/context";
import type { PlanBlock } from "@/lib/types";

// Planner integration after the reliability repair (2026-11-16), against the
// local database. Reproduces the production session where a test moved to
// tomorrow came back tonight on the next re-plan, and old Canvas items were
// reported as "due today but doesn't fit".

const zone = "America/New_York";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
let navi: Ctx;
const D = () => DateTime.now().setZone(zone).plus({ days: 3 }).toISODate()!;
const next = (d: string) => DateTime.fromISO(d, { zone }).plus({ days: 1 }).toISODate()!;
const at = (d: string, hhmm: string) => DateTime.fromISO(`${d}T${hhmm}`, { zone }).toISO()!;

async function blocks(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}

beforeAll(async () => {
  me = await userClient("planner-repair@navi.test");
  user = ctxFor(me.db, me.userId, zone);
  navi = { ...user, actor: "navi" };
});
beforeEach(async () => {
  await resetUser(me.userId);
  await me.db.from("plan_changesets").delete().eq("user_id", me.userId);
  await me.db.from("day_exceptions").delete().eq("user_id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

describe.each([
  ["planner v2", { planner_v2: true, wake_time: "07:00", bed_time: "23:00" }, []],
  ["planner v1", {}, [{ days: [0, 1, 2, 3, 4, 5, 6], start: "16:00", end: "21:00" }]],
])("%s", (_name, preferences, availability) => {
  beforeEach(async () => {
    await admin().from("profiles").update({ preferences, availability, timezone: zone }).eq("id", me.userId);
  });

  it("work the person moved to a later day isn't planned again on the earlier day", async () => {
    const d = D();
    const t = await createTask(user, { title: "Los Deportes test", due_at: at(d, "23:59"), estimate_minutes: 30 });
    // The person put it on the next day themselves.
    await admin().from("plan_blocks").insert({ user_id: me.userId, plan_date: next(d), task_id: t.id, title: t.title, starts_at: at(next(d), "17:30"), ends_at: at(next(d), "18:00"), is_flexible: true, created_by: "user", status: "planned" });
    await generateDayPlan(user, d);
    expect((await blocks(d)).filter((b) => b.task_id === t.id)).toHaveLength(0);
    expect((await blocks(next(d))).filter((b) => b.task_id === t.id)).toHaveLength(1);
  });

  it("overdue Canvas work waits for a decision: not planned, not 'due today', the person's own work gets the time", async () => {
    const d = D();
    const old = Array.from({ length: 12 }, (_, i) => ({
      user_id: me.userId, title: `Old worksheet ${i} [Chem]`, source: "external", external_ref: `ext:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      due_at: DateTime.now().minus({ days: 2 + i }).toISO()!, due_is_hard: true, priority: 2,
    }));
    await admin().from("tasks").insert(old);
    const mine = await createTask(user, { title: "PBL Major", estimate_minutes: 60 });
    const r = await generateDayPlan(user, d);
    const planned = (await blocks(d)).map((b) => b.task_id);
    expect(planned).toContain(mine.id);
    const { data: oldRows } = await me.db.from("tasks").select("id,status").eq("source", "external");
    expect(oldRows!.every((t) => t.status === "todo")).toBe(true); // nothing completed or dropped
    expect(planned.some((id) => oldRows!.some((o) => o.id === id))).toBe(false);
    expect((r as { triage?: unknown[] }).triage).toHaveLength(12);
    expect(r.warnings.join(" ")).not.toMatch(/due today/);
  });
});

describe("chat changes to the plan persist (planner v2)", () => {
  beforeEach(async () => {
    await admin().from("profiles").update({ preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00" }, availability: [], timezone: zone }).eq("id", me.userId);
  });

  it("move_block to the next day, then a re-plan of the first day: the move sticks and the task isn't doubled", async () => {
    const d = D();
    const t = await createTask(user, { title: "Los Deportes test", due_at: at(d, "23:59"), estimate_minutes: 30 });
    await generateDayPlan(user, d);
    const [b] = (await blocks(d)).filter((x) => x.task_id === t.id);
    expect(b).toBeTruthy();
    const moved = await runTool(navi, "move_block", { moves: [{ block_id: b.id, start: at(next(d), "17:30") }] });
    expect(moved.ok).toBe(true);
    const r = await runTool(navi, "plan", { date: d });
    expect(r.ok).toBe(true);
    expect((await blocks(d)).filter((x) => x.task_id === t.id)).toHaveLength(0);
    const tomorrow = (await blocks(next(d))).filter((x) => x.task_id === t.id);
    expect(tomorrow).toHaveLength(1);
    expect(DateTime.fromISO(tomorrow[0].starts_at).setZone(zone).toFormat("HH:mm")).toBe("17:30");
  });

  it("'plan' says plainly when work the person asked for isn't on the plan, and reports no change as no change", async () => {
    const d = D();
    // A fixed event fills the waking day, so nothing fits.
    await me.db.from("events").insert({ user_id: me.userId, title: "All-day trip", starts_at: at(d, "07:00"), ends_at: at(d, "23:00"), source: "user", status: "confirmed" });
    const t = await createTask(user, { title: "Urban gardening project", estimate_minutes: 60 });
    const r = await runTool(navi, "plan", { date: d, focus_task_ids: [t.id] });
    expect(r.summary).toMatch(/NOT on the plan.*Urban gardening project/);
    expect(r.display).toMatch(/Couldn't fit/);
    expect(r.mutated).toBe(false);
  });
});
