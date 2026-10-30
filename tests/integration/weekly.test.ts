import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { weekInsights, type WeekInsights } from "@/server/domain/insights";
import { confidenceFrom, learnFromWeek, weekPatterns } from "@/server/domain/patterns";
import { saveBriefing } from "@/server/jobs/briefings";
import { OUTCOMES } from "@/lib/outcomes";
import type { Profile } from "@/lib/types";

// Weekly review: trends only with enough evidence, progress, planned vs done
// time, disruptions, next week's load; and behavioral memory saved from that
// evidence, strengthened or overturned by later weeks, under the user's control.

let db: Awaited<ReturnType<typeof userClient>>["db"];
let userId = "";
const zone = "UTC";
const today = () => DateTime.now().setZone(zone).startOf("day");
const day = (ago: number) => today().minus({ days: ago });

async function block(title: string, date: DateTime, hour: number, status: string, extra: Record<string, unknown> = {}) {
  const start = date.set({ hour });
  const { data, error } = await admin()
    .from("plan_blocks")
    .insert({ user_id: userId, title, plan_date: date.toISODate(), starts_at: start.toISO(), ends_at: start.plus({ minutes: 60 }).toISO(), status, ...extra })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}
async function task(values: Record<string, unknown>) {
  const { data, error } = await admin().from("tasks").insert({ user_id: userId, ...values }).select("id").single();
  expect(error).toBeNull();
  return data!.id as string;
}
const doneTask = (estimate: number, actual: number, extra: Record<string, unknown> = {}) =>
  task({ title: `Done ${estimate}/${actual}`, status: "done", estimate_minutes: estimate, actual_minutes: actual, completed_at: day(1).set({ hour: 12 }).toISO(), ...extra });

beforeEach(async () => {
  ({ db, userId } = await userClient("dave@navi.test"));
  await resetUser(userId);
  await admin().from("profiles").update({ timezone: zone, availability: [], onboarding_status: "completed" }).eq("id", userId);
});

describe("weekInsights", () => {
  it("reports trends only with enough evidence (3 rated days and 6 planned blocks)", async () => {
    // Two rated days, six blocks: not enough days.
    for (const d of [1, 2]) for (const h of [9, 10, 11]) await block("Work", day(d), h, "done");
    let w = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w.enoughData).toBe(false);
    expect(w.findings[0]).toMatch(/Not enough recorded days yet/);
    // Three rated days but only five blocks: still not enough.
    await admin().from("plan_blocks").delete().eq("user_id", userId);
    for (const [d, n] of [[1, 2], [2, 2], [3, 1]]) for (let i = 0; i < n; i++) await block("Work", day(d), 9 + i, "done");
    w = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w.enoughData).toBe(false);
    // Three rated days and six blocks: trends are shown.
    await block("Work", day(3), 14, "partial");
    w = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w.enoughData).toBe(true);
    expect(w.avgCompletion).toBeCloseTo((1 + 1 + 0.75) / 3);
    expect(w.findings.join(" ")).toMatch(/Average completion of counted blocks: 92% across 3 days/);
  });

  it("flags work skipped 3 times without an outside reason, not work blocked or overrun", async () => {
    const id = await task({ title: "Tax forms" });
    const other = await task({ title: "Blocked thing" });
    for (const d of [1, 3, 5]) await block("Tax forms", day(d), 9, "skipped", { task_id: id, outcome_reason: OUTCOMES.avoided.reason });
    for (const d of [1, 2, 3]) await block("Blocked thing", day(d), 11, "skipped", { task_id: other, outcome_reason: d === 2 ? OUTCOMES.estimate.reason : OUTCOMES.missing_info.reason });
    const w = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w.repeatedlyAvoided).toEqual([{ task_id: id, title: "Tax forms", times: 3 }]);
    expect(w.findings.join(" ")).toMatch(/“Tax forms” has been skipped 3 times without an outside reason/);
    expect(w.overran).toBe(1);
  });

  it("uses the median actual/estimate ratio, only from 5+ finished tasks", async () => {
    for (const [e, a] of [[30, 30], [30, 45], [60, 120], [20, 40]]) await doneTask(e, a);
    let w = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w.estimate).toEqual({ samples: 4, medianRatio: null });
    await doneTask(10, 30); // ratios 1, 1.5, 2, 2, 3 → median 2
    w = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w.estimate).toEqual({ samples: 5, medianRatio: 2 });
    expect(w.findings.join(" ")).toMatch(/Tasks take about 2\.0× your estimates \(5 tasks\)/);
    await doneTask(10, 10); // 1, 1, 1.5, 2, 2, 3 → median (1.5 + 2) / 2
    w = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w.estimate.medianRatio).toBeCloseTo(1.75);
  });

  it("adds project/goal progress, planned vs done minutes, disruptions and next week's load", async () => {
    const { data: goal } = await admin().from("goals").insert({ user_id: userId, title: "Get an A in chemistry" }).select("id").single();
    const { data: proj } = await admin().from("projects").insert({ user_id: userId, name: "Tally app" }).select("id").single();
    const { data: idle } = await admin().from("projects").insert({ user_id: userId, name: "Garden" }).select("id").single();
    await doneTask(30, 30, { project_id: proj!.id });
    await doneTask(30, 30, { project_id: proj!.id, goal_id: goal!.id });
    await task({ title: "Tally landing page", project_id: proj!.id });
    await task({ title: "Plant bulbs", project_id: idle!.id });
    await block("Work", day(1), 9, "done");
    await block("Work", day(1), 10, "partial");
    await block("Work", day(2), 9, "skipped", { outcome_reason: OUTCOMES.avoided.reason });
    await admin().from("focus_sessions").insert({ user_id: userId, started_at: day(1).set({ hour: 9 }).toISO(), ended_at: day(1).set({ hour: 9, minute: 40 }).toISO(), actual_minutes: 40, outcome: "completed" });
    for (const [c, ago] of [["interruption", 1], ["interruption", 2], ["missing_info", 3], ["rest", 9]] as const) {
      await admin().from("plan_disruptions").insert({ user_id: userId, category: c, description: "x", occurred_at: day(ago).set({ hour: 12 }).toISO() });
    }
    // Next week: 90 + 30 (no estimate) minutes due; free time 2 h/day × 7.
    const due1 = today().plus({ days: 2 }).set({ hour: 17 });
    await task({ title: "Lab report", estimate_minutes: 90, due_at: due1.toISO(), due_is_hard: true });
    await task({ title: "Reply to coach", due_at: today().plus({ days: 5 }).set({ hour: 12 }).toISO() });
    await task({ title: "Far away", estimate_minutes: 600, due_at: today().plus({ days: 20 }).toISO() });
    await admin().from("profiles").update({ availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "18:00", end: "20:00" }] }).eq("id", userId);

    const w = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w.progress).toEqual([
      { kind: "project", id: proj!.id, name: "Tally app", completed: 2, open: 1 },
      { kind: "goal", id: goal!.id, name: "Get an A in chemistry", completed: 1, open: 0 },
      { kind: "project", id: idle!.id, name: "Garden", completed: 0, open: 1 },
    ]);
    expect(w.minutes).toEqual({ planned: 180, done: 60, partial: 60, focus: 40 });
    expect(w.disruptions).toEqual({ interruption: 2, missing_info: 1 });
    expect(w.nextWeek.deadlines.map((d) => [d.title, d.due_is_hard])).toEqual([["Lab report", true], ["Reply to coach", false]]);
    expect(w.nextWeek.loadMinutes).toBe(120);
    expect(w.nextWeek.unestimated).toBe(1);
    expect(w.nextWeek.freeMinutes).toBe(7 * 120);
    expect(w.nextWeek.overloaded).toBe(false);
    const text = w.findings.join(" ");
    expect(text).toMatch(/Your plan broke 3 times this week \(2 interruption, 1 missing information\)/);
    expect(text).toMatch(/Planned 3 h of work blocks; blocks marked done cover 60 min \(\+60 min partly done\); 40 min measured in focus sessions/);
    expect(text).toMatch(/No tasks finished this week for “Garden” \(1 open\)/);
    expect(text).toMatch(/Next 7 days: 2 deadlines \(1 hard\); work due needs about 2 h \(1 without an estimate, 30 min assumed\) and you have about 14 h free/);

    // More due than free time is called out.
    await task({ title: "Huge thing", estimate_minutes: 1000, due_at: today().plus({ days: 3 }).toISO() });
    const w2 = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w2.nextWeek.overloaded).toBe(true);
    expect(w2.findings.join(" ")).toMatch(/That's more than your free time/);

    // The weekly briefing carries it.
    const { data: profile } = await admin().from("profiles").select("*").eq("id", userId).single();
    const b = await saveBriefing(admin(), profile as Profile, "weekly", today().toISODate()!);
    expect(b!.body).toMatch(/Progress: Tally app 2 done, 1 open; Get an A in chemistry 1 done/);
    expect(b!.body).toMatch(/Deadlines next week: Lab report \([^)]*, hard\); /);
    expect(b!.body).toMatch(/Deadlines next week: .*Reply to coach \(/);
    expect(b!.body).toMatch(/Your plan broke 3 times this week/);
  });

  it("finds interruptions that cluster at one time of day", async () => {
    for (const d of [1, 4, 8]) await block("Work", day(d), 15, "interrupted");
    for (const d of [1, 2, 3]) for (const h of [9, 10]) await block("Work", day(d), h, "done");
    const w = await weekInsights(db, userId, zone, today().toISODate()!);
    expect(w.interruptionsByPart).toEqual([{ part: "afternoon", count: 3 }]);
    expect(w.findings.join(" ")).toMatch(/Interruptions cluster in the afternoon \(noon–5 PM\): 3 interrupted blocks in 3 weeks/);
  });
});

// A WeekInsights with nothing in it, for driving the pattern learner directly.
function emptyWeek(end: string, over: Partial<WeekInsights> = {}): WeekInsights {
  return {
    start: end, end, days: [], avgCompletion: null, focusMinutes: 0, tasksCompleted: 0,
    estimate: { samples: 0, medianRatio: null }, repeatedlyAvoided: [], interruptionsByPart: [], lateCompletions: 0,
    overran: 0, disruptions: {}, minutes: { planned: 0, done: 0, partial: 0, focus: 0 }, progress: [],
    nextWeek: { from: end, to: end, deadlines: [], loadMinutes: 0, unestimated: 0, freeMinutes: 0, overloaded: false },
    findings: [], enoughData: false, ...over,
  };
}

describe("behavioral memory from evidence", () => {
  const behavioral = async () => (await db.from("memories").select("*").eq("kind", "behavioral").order("created_at")).data!;

  it("saves an observed pattern with its evidence once, then strengthens it, and later evidence overturns it", async () => {
    const id = await task({ title: "Tax forms" });
    const w1 = emptyWeek("2026-10-25", { repeatedlyAvoided: [{ task_id: id, title: "Tax forms", times: 3 }] });
    await learnFromWeek(admin(), userId, w1);
    await learnFromWeek(admin(), userId, w1); // the same review run twice changes nothing
    let mems = await behavioral();
    expect(mems).toHaveLength(1);
    expect(mems[0]).toMatchObject({ origin: "observed", status: "active", confidence: 0.6, content: "Tends to put off “Tax forms”: skipped 3 times in 3 weeks without an outside reason." });
    expect(mems[0].evidence).toEqual([{ pattern: `avoid:${id}`, week_end: "2026-10-25", supports: true, summary: "skipped 3 times without an outside reason (3 weeks to 2026-10-25)" }]);

    await learnFromWeek(admin(), userId, emptyWeek("2026-11-01", { repeatedlyAvoided: [{ task_id: id, title: "Tax forms", times: 4 }] }));
    mems = await behavioral();
    expect(mems).toHaveLength(1);
    expect(mems[0].confidence).toBeCloseTo(0.7);
    expect(mems[0].content).toMatch(/skipped 4 times/);

    // The task got done: evidence against, twice → overturned (kept, marked superseded, not deleted).
    await admin().from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", id);
    await learnFromWeek(admin(), userId, emptyWeek("2026-11-08"));
    mems = await behavioral();
    expect(mems[0]).toMatchObject({ status: "active" });
    expect(mems[0].confidence).toBeCloseTo(0.5);
    await learnFromWeek(admin(), userId, emptyWeek("2026-11-15"));
    mems = await behavioral();
    expect(mems[0].status).toBe("superseded");
    expect(mems[0].confidence).toBeCloseTo(0.3);
    expect(mems[0].evidence.at(-1)).toMatchObject({ supports: false, summary: "the task was finished" });
  });

  it("keeps rejected patterns rejected and confirmed ones in the person's words", async () => {
    const tooLong = emptyWeek("2026-10-25", { estimate: { samples: 6, medianRatio: 1.6 } });
    await learnFromWeek(admin(), userId, tooLong);
    let [m] = await behavioral();
    expect(m.content).toBe("Tasks usually take longer than estimated: about 1.6× the estimate.");
    await admin().from("memories").update({ status: "rejected" }).eq("id", m.id);
    await learnFromWeek(admin(), userId, emptyWeek("2026-11-01", { estimate: { samples: 7, medianRatio: 1.7 } }));
    const all = await behavioral();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("rejected");

    // Confirmed by the person: wording and confidence stay theirs; evidence is still recorded.
    await admin().from("memories").update({ status: "active", origin: "stated", confidence: 1, content: "I underestimate everything" }).eq("id", m.id);
    await learnFromWeek(admin(), userId, emptyWeek("2026-11-08", { estimate: { samples: 8, medianRatio: 1.0 } }));
    [m] = await behavioral();
    expect(m).toMatchObject({ status: "active", origin: "stated", confidence: 1, content: "I underestimate everything" });
  });

  it("an estimate pattern is weakened by a week of accurate estimates; confidence follows the evidence", async () => {
    await learnFromWeek(admin(), userId, emptyWeek("2026-10-25", { estimate: { samples: 5, medianRatio: 1.5 } }));
    await learnFromWeek(admin(), userId, emptyWeek("2026-11-01", { estimate: { samples: 3, medianRatio: null } })); // no evidence either way
    let [m] = await behavioral();
    expect(m.confidence).toBeCloseTo(0.6);
    await learnFromWeek(admin(), userId, emptyWeek("2026-11-08", { estimate: { samples: 6, medianRatio: 1.05 } }));
    [m] = await behavioral();
    expect(m.confidence).toBeCloseTo(0.4);
    expect(m.status).toBe("active");
    expect(confidenceFrom([])).toBe(0.5);
    expect(weekPatterns(emptyWeek("x", { enoughData: true, interruptionsByPart: [{ part: "evening", count: 4 }] })).found.map((f) => f.key)).toEqual(["interruptions:evening"]);
  });

  it("the weekly review saves what it found", async () => {
    const id = await task({ title: "Practice piano" });
    for (const d of [1, 2, 3]) await block("Practice piano", day(d), 9, "skipped", { task_id: id, outcome_reason: OUTCOMES.avoided.reason });
    const { data: profile } = await admin().from("profiles").select("*").eq("id", userId).single();
    await saveBriefing(admin(), profile as Profile, "weekly", today().toISODate()!);
    const mems = await behavioral();
    expect(mems.map((m) => m.content)).toEqual(["Tends to put off “Practice piano”: skipped 3 times in 3 weeks without an outside reason."]);
    // Navi uses it: active behavioral memories go into the conversation context.
    const { relevantMemories } = await import("@/server/domain/memory");
    expect((await relevantMemories(ctxFor(db, userId, zone), "anything")).map((m) => m.content)).toContain(mems[0].content);
  });
});

afterAll(async () => {
  await resetUser(userId);
  await db.auth.signOut();
});
