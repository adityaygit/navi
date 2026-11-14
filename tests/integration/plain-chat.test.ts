import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { buildContext, handleTurn } from "@/server/ai/chat";
import { runTool } from "@/server/ai/tools";
import { createTask } from "@/server/domain/tasks";
import { revertActivities } from "@/server/domain/activity";
import { generateDayPlan } from "@/server/planner/plan";
import { planCard } from "@/lib/plan-card";
import { isPlanStep, plainProblems } from "@/lib/plain-text";
import { SIM_LABEL } from "@/server/ai/devsim";
import type { Ctx } from "@/server/context";
import type { Message, PlanBlock } from "@/lib/types";

// The owner's complaint (2026-11-08): chat replies full of field names,
// timestamps, one row and one Undo per moved block, lists of 18 titles, "I
// don't have a live clock", and Spanish items put back on tonight after "keep
// them off until Monday". Each turn here goes through the real chat turn with
// the development simulator standing in for the model, on both planners.
// The time zone is picked so it's late morning there now.

const CANDIDATE_ZONES = ["Pacific/Kiritimati", "Pacific/Auckland", "Australia/Sydney", "Asia/Tokyo", "Asia/Shanghai", "Asia/Bangkok", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "Europe/Moscow", "Europe/Berlin", "Europe/London", "Atlantic/Azores", "America/Noronha", "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Pacific/Pago_Pago"];
const zone = CANDIDATE_ZONES.find((z) => { const h = DateTime.now().setZone(z).hour; return h >= 8 && h <= 10; }) ?? "UTC";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
const now = () => DateTime.now().setZone(zone);
const today = () => now().toISODate()!;

async function blocksOn(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}
const say = (text: string) => handleTurn(user, { kind: "chat", text, modality: "text" });

/** Everything a person sees of a reply: its text (without the simulator label) and every step's lines. */
function expectPlain(m: Message) {
  const reply = m.content.replace(SIM_LABEL, "").trim();
  expect(plainProblems(reply, { maxLength: 300, maxQuoted: 3 }).filter((p) => p !== "clock time"), reply).toEqual([]);
  expect(reply.split(/(?<=[.!?])\s+/).length, reply).toBeLessThanOrEqual(3);
  for (const e of m.tool_events) {
    expect(e.display, `${e.name} has a display line`).toBeDefined();
    if (e.display) expect(plainProblems(e.display), `${e.name}: ${e.display}`).toEqual([]);
    for (const l of e.detail ?? []) expect(plainProblems(l, { detail: true }), `${e.name} detail: ${l}`).toEqual([]);
    if (e.leftover) {
      expect(plainProblems(e.leftover.line), e.leftover.line).toEqual([]);
      for (const o of e.leftover.options) expect(plainProblems(o, { detail: true, maxLength: 200 }), o).toEqual([]);
    }
  }
}

/** Four of Navi's planned items in a row from about now. */
async function fourBlocks() {
  // The next whole hour at least 20 minutes away, so every block is still ahead
  // whatever minute the test runs at (rounding down put the first one in the past).
  const start = now().plus({ minutes: 20 }).startOf("hour").plus({ hours: 1 });
  const titles = ["02.03a Heimler Video + Quiz (AP World)", "Finish LEQ paper (AP World)", "Course Check-in (Spanish)", "02.04 Vocabulary (Spanish)"];
  const rows = titles.map((title, i) => ({ user_id: me.userId, title, plan_date: today(), starts_at: start.plus({ minutes: 40 * i }).toISO(), ends_at: start.plus({ minutes: 40 * i + 30 }).toISO(), created_by: "navi", is_flexible: true, status: "planned" }));
  await me.db.from("plan_blocks").insert(rows);
  return start;
}

beforeAll(async () => {
  me = await userClient("plain-chat@navi.test");
  user = ctxFor(me.db, me.userId, zone);
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ timezone: zone, availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "07:00", end: "23:00" }], preferences: { wake_time: "07:00", bed_time: "23:00" } }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

for (const v2 of [false, true]) {
  describe(`${v2 ? "planner v2" : "old planner"}: plain replies`, () => {
    beforeEach(async () => {
      if (v2) await admin().from("profiles").update({ preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00" } }).eq("id", me.userId);
    });

    it("“leave an empty space from now till …”: one card, the moves behind the arrow, one Undo for all of it", async () => {
      const start = await fourBlocks();
      const until = start.plus({ minutes: 45 });
      const before = await blocksOn(today());
      const r = await say(`leave an empty space from now till ${until.toFormat("h:mm")}${until.hour >= 12 ? "pm" : "am"}`);
      expectPlain(r.assistantMessage);
      const steps = r.assistantMessage.tool_events;
      expect(steps.map((s) => s.name)).toEqual(["shift_blocks"]);
      expect(steps.every(isPlanStep)).toBe(true);
      const card = planCard(steps);
      expect(card.display).toBe("Cleared your time until then");
      expect(card.detail.length).toBeGreaterThanOrEqual(2);
      expect(card.detail[0]).toMatch(/^Heimler Video \+ Quiz → \d{1,2}:\d{2} [AP]M$/);
      expect(card.undo?.length).toBeGreaterThanOrEqual(2);
      const after = await blocksOn(today());
      expect(Date.parse(after[0].starts_at)).toBe(until.toMillis());
      // Nothing overlaps after the push, and the order is kept.
      for (let i = 1; i < after.length; i++) expect(Date.parse(after[i].starts_at)).toBeGreaterThanOrEqual(Date.parse(after[i - 1].ends_at));
      expect(after.map((b) => b.title)).toEqual(before.map((b) => b.title));

      // One Undo puts every move back.
      await revertActivities(user, card.undo!);
      expect((await blocksOn(today())).map((b) => Date.parse(b.starts_at))).toEqual(before.map((b) => Date.parse(b.starts_at)));
    });

    it("the whole-reply Undo refuses, changing nothing, if one of its moves was changed since", async () => {
      const start = await fourBlocks();
      const r = await say(`push everything 30 min`);
      expectPlain(r.assistantMessage);
      const card = planCard(r.assistantMessage.tool_events);
      expect(card.display).toMatch(/^Moved 4 things 30 min later$/);
      const moved = await blocksOn(today());
      await me.db.from("plan_blocks").update({ starts_at: start.plus({ hours: 5 }).toISO(), ends_at: start.plus({ hours: 5, minutes: 30 }).toISO() }).eq("id", moved[3].id);
      const snapshot = (await blocksOn(today())).map((b) => b.starts_at);
      await expect(revertActivities(user, card.undo!)).rejects.toThrow(/nothing was undone/);
      expect((await blocksOn(today())).map((b) => b.starts_at)).toEqual(snapshot);
    });

    it("“keep the Spanish items off until <day>” sticks: re-plans don't put them back before then", async () => {
      const day = now().plus({ days: 2 });
      const spanish = await Promise.all(["Module 3 reading (Spanish)", "Module 3 quiz (Spanish)"].map((title) => createTask(user, { title, estimate_minutes: 30, priority: 1 })));
      await createTask(user, { title: "LEQ paper", estimate_minutes: 30, priority: 2 });
      await generateDayPlan(user, today());
      expect((await blocksOn(today())).some((b) => spanish.some((s) => s.id === b.task_id))).toBe(true);

      const r = await say(`keep the module items off until ${day.toFormat("cccc")}`);
      expectPlain(r.assistantMessage);
      expect(r.assistantMessage.tool_events[0]).toMatchObject({ name: "keep_off_until", plan: true, display: `Kept 2 things off your plan until ${day.toFormat("cccc")}` });
      const { data: tasks } = await me.db.from("tasks").select("not_before").in("id", spanish.map((s) => s.id));
      for (const t of tasks ?? []) expect(Date.parse(t.not_before)).toBe(day.startOf("day").toMillis());
      // Gone from today right away, and a later re-plan of today and tomorrow keeps them off.
      expect((await blocksOn(today())).filter((b) => b.status === "planned").some((b) => spanish.some((s) => s.id === b.task_id))).toBe(false);
      const plan = await say("plan my day");
      expectPlain(plan.assistantMessage);
      await generateDayPlan(user, now().plus({ days: 1 }).toISODate()!);
      for (const d of [today(), now().plus({ days: 1 }).toISODate()!]) {
        expect((await blocksOn(d)).some((b) => spanish.some((s) => s.id === b.task_id))).toBe(false);
      }
      // On that day they can be planned again.
      const then = await generateDayPlan(user, day.toISODate()!);
      expect(then.blocks.some((b) => spanish.some((s) => s.id === b.task_id))).toBe(true);
    });

    it("an overloaded day is one line and a count, never a list of titles; other replies stay short and plain", async () => {
      for (let i = 0; i < 24; i++) await createTask(user, { title: `0${i % 9}.0${i % 7}a Spanish reading ${i} (Spanish)`, estimate_minutes: 60, due_at: now().endOf("day").toISO() });
      const r = await say(v2 ? "plan my day" : "plan my day");
      expectPlain(r.assistantMessage);
      const card = planCard(r.assistantMessage.tool_events.filter(isPlanStep));
      expect(card.display).toMatch(/^Planned (today|tonight): \d+ things$/);
      expect(card.leftover?.line).toMatch(/^\d+ things (didn't fit (today|tonight)|left for another day so (today|tonight) isn't packed)$/);
      expect(card.leftover?.options[0]).toMatch(/and \d+ more\. They stay on your list; nothing was dropped\.$/);
      for (const text of ["add a task to water the plants", "plan my week", "my plan broke, I got interrupted"]) expectPlain((await say(text)).assistantMessage);
    });
  });
}

describe("Navi always knows the time", () => {
  it("the context opens with the real current time", async () => {
    const ctx = await buildContext(user, "hi", "chat");
    const first = ctx.split("\n")[0];
    expect(first).toBe(`Now: ${now().toFormat("cccc LLL d, h:mm a")} (${zone}). This is the real current time; use it.`);
  });

  it("'start now' is resolved by code: the next thing starts at the current time (rounded up to 5 minutes)", async () => {
    await fourBlocks();
    const r = await runTool({ ...user, actor: "navi" }, "shift_blocks", { start_at: "now" });
    expect(r.ok).toBe(true);
    const first = (await blocksOn(today()))[0];
    const n = now();
    const expected = n.minute % 5 === 0 && n.second === 0 ? n.startOf("minute") : n.plus({ minutes: 5 - (n.minute % 5) }).startOf("minute");
    expect(Math.abs(Date.parse(first.starts_at) - expected.toMillis())).toBeLessThanOrEqual(5 * 60_000);
    expect(Date.parse(first.starts_at)).toBeGreaterThanOrEqual(n.minus({ minutes: 1 }).toMillis());
  });
});
