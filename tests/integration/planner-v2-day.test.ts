import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { createTask, endFocus, startFocus } from "@/server/domain/tasks";
import { revertActivities } from "@/server/domain/activity";
import { generateDayPlan } from "@/server/planner/plan";
import { fixedClash } from "@/server/planner/clash";
import { myDayV2 } from "@/server/planner/my-day-v2";
import { weekInsights } from "@/server/domain/insights";
import type { Ctx } from "@/server/context";
import type { PlanBlock } from "@/lib/types";

// Planner v2 on My day and after Focus: scenario 5 (a task takes longer than
// estimated), B5 ("Put it there" never overlaps fixed things), what My day
// shows (assumptions, unknown time, proposals) and Insights' free time.

const CANDIDATE_ZONES = ["Pacific/Kiritimati", "Pacific/Auckland", "Australia/Sydney", "Asia/Tokyo", "Asia/Shanghai", "Asia/Bangkok", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "Europe/Moscow", "Europe/Berlin", "Europe/London", "Atlantic/Azores", "America/Noronha", "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Pacific/Pago_Pago"];
const zone = CANDIDATE_ZONES.find((z) => { const h = DateTime.now().setZone(z).hour; return h >= 8 && h <= 10; }) ?? "UTC";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
const today = () => DateTime.now().setZone(zone).toISODate()!;
const tomorrow = () => DateTime.now().setZone(zone).plus({ days: 1 }).toISODate()!;
const at = (date: string, hm: string) => DateTime.fromISO(`${date}T${hm}`, { zone });

async function blocksOn(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}

beforeAll(async () => {
  me = await userClient("planner-v2-day@navi.test");
  user = ctxFor(me.db, me.userId, zone);
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ timezone: zone, availability: [], preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00", plan_load_cap: 1 } }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

describe("Scenario 5: a task taking longer than estimated", () => {
  it("“needs 40 more minutes” grows the estimate, keeps the task open, marks the block partly done and re-fits the rest of today (undoable)", async () => {
    const chem = await createTask(user, { title: "Chemistry lab", estimate_minutes: 60 });
    const other = await createTask(user, { title: "Reading", estimate_minutes: 30 });
    await generateDayPlan(user, today());
    const block = (await blocksOn(today())).find((b) => b.task_id === chem.id)!;
    await admin().from("tasks").update({ actual_minutes: 60 }).eq("id", chem.id); // the hour it already took
    const session = await startFocus(user, { task_id: chem.id, block_id: block.id, planned_minutes: 60 });
    const undo: string[] = [];
    await endFocus({ ...user, onActivity: (e) => e.reversible && undo.push(e.id) }, session.id, "progress", null, null, 40);
    const { data: t } = await me.db.from("tasks").select("status,estimate_minutes,actual_minutes").eq("id", chem.id).single();
    expect(t!.status).toBe("in_progress");
    expect(t!.estimate_minutes).toBe(t!.actual_minutes + 40); // time spent so far + what they said it still needs
    const { data: b } = await me.db.from("plan_blocks").select("status").eq("id", block.id).single();
    expect(b!.status).toBe("partial");
    const blocks = await blocksOn(today());
    const more = blocks.filter((x) => x.task_id === chem.id && x.status === "planned");
    expect(more.reduce((s, x) => s + (Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 60000, 0)).toBe(40);
    expect(blocks.some((x) => x.task_id === other.id)).toBe(true); // nothing dropped
    const { count } = await me.db.from("plan_changesets").select("id", { count: "exact", head: true }).eq("trigger", "overrun");
    expect(count).toBe(1);
    // Undo: the re-fit and the estimate change go back.
    await revertActivities(user, undo);
    const { data: t2 } = await me.db.from("tasks").select("estimate_minutes").eq("id", chem.id).single();
    expect(t2!.estimate_minutes).toBe(60);
  });

  it("is off for accounts without the new planner (old behaviour)", async () => {
    await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
    const chem = await createTask(user, { title: "Chemistry lab", estimate_minutes: 60 });
    const session = await startFocus(user, { task_id: chem.id, planned_minutes: 60 });
    await endFocus(user, session.id, "progress", null, null, 40);
    const { data: t } = await me.db.from("tasks").select("estimate_minutes").eq("id", chem.id).single();
    expect(t!.estimate_minutes).toBe(60);
    const { count } = await me.db.from("plan_changesets").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });
});

describe("B5: placing work never overlaps fixed things", () => {
  it("finds events, fixed routines and kept blocks, but not Navi's own open blocks", async () => {
    const d = tomorrow();
    await me.db.from("events").insert({ user_id: me.userId, title: "Dentist", starts_at: at(d, "10:00").toISO(), ends_at: at(d, "11:00").toISO() });
    await me.db.from("routines").insert({ user_id: me.userId, title: "Practice", days: [0, 1, 2, 3, 4, 5, 6], start_time: "16:00", duration_minutes: 60, is_fixed: true, protection: "fixed" });
    await me.db.from("plan_blocks").insert({ user_id: me.userId, title: "My block", plan_date: d, starts_at: at(d, "13:00").toISO(), ends_at: at(d, "13:30").toISO(), created_by: "user" });
    await me.db.from("plan_blocks").insert({ user_id: me.userId, title: "Navi block", plan_date: d, starts_at: at(d, "14:00").toISO(), ends_at: at(d, "14:30").toISO(), created_by: "navi" });
    expect(await fixedClash(user, d, at(d, "10:30"), at(d, "11:30"))).toBe("Dentist");
    expect(await fixedClash(user, d, at(d, "15:45"), at(d, "16:15"))).toBe("Practice");
    expect(await fixedClash(user, d, at(d, "13:15"), at(d, "13:45"))).toBe("My block");
    expect(await fixedClash(user, d, at(d, "14:00"), at(d, "14:30"))).toBeNull();
    expect(await fixedClash(user, d, at(d, "08:00"), at(d, "09:00"))).toBeNull();
  });
});

describe("My day (planner v2)", () => {
  it("shows the free time the planner uses, at most two assumptions, unknown school hours, and a waiting proposal", async () => {
    await me.db.from("workspaces").insert({ user_id: me.userId, name: "School" });
    await createTask(user, { title: "Essay", estimate_minutes: 90 });
    await createTask(user, { title: "Flashcards", estimate_minutes: 30 });
    const d = DateTime.now().setZone(zone).plus({ days: 1 });
    const date = d.weekday <= 5 ? d.toISODate()! : d.plus({ days: 8 - d.weekday }).toISODate()!; // a weekday
    await generateDayPlan(user, date);
    const blocks = await blocksOn(date);
    expect(blocks.every((b) => b.basis === "inferred")).toBe(true);
    const view = await myDayV2(user, date, blocks, 0);
    expect(view.assumptions.length).toBeGreaterThan(0);
    expect(view.assumptions.length).toBeLessThanOrEqual(2);
    expect(view.assumptions[0].label).toMatch(/\d(:\d\d)?(–| [AP]M–)\d/);
    expect(view.unknown).toEqual([{ text: "8–3 PM (school hours)".replace("8–3 PM", "8 AM–3 PM") }]);
    expect(view.capacity.length).toBeGreaterThan(0);
    // No work in unknown school hours.
    for (const b of blocks) {
      const s = DateTime.fromISO(b.starts_at).setZone(zone).toFormat("HH:mm");
      const e = DateTime.fromISO(b.ends_at).setZone(zone).toFormat("HH:mm");
      expect(e <= "08:00" || s >= "15:00").toBe(true);
    }
    await createTask(user, { title: "New thing", estimate_minutes: 30, priority: 1 });
    await generateDayPlan({ ...user, actor: "navi" }, date, { mode: "propose" });
    const again = await myDayV2(user, date, await blocksOn(date), 0);
    expect(again.proposals).toHaveLength(1);
    expect(again.proposals[0].lines.length).toBeGreaterThan(0);
  });
});

describe("Insights with planner v2", () => {
  it("counts next week's free time without saved free-time windows (the old “0m free”)", async () => {
    const w = await weekInsights(admin(), me.userId, zone, today());
    expect(w.nextWeek.freeMinutes).toBeGreaterThan(0);
  });
});
