import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { endFocus, startFocus, createTask } from "@/server/domain/tasks";
import { generateDayPlan, recoverPlan, recoveryOutcome, setBlockOutcome } from "@/server/planner/plan";
import { dayReview, weekInsights } from "@/server/domain/insights";
import { briefingUrl, buildBriefing, saveBriefing } from "@/server/jobs/briefings";
import { OUTCOMES, STOPPED_NO_REASON } from "@/lib/outcomes";
import type { Profile } from "@/lib/types";

// Accountability, recovery, reviews and briefings read from recorded events
// (gap audit, session 3). Times are built around "now" in a fixed-offset zone
// where it is currently around midday, so "earlier today" and "later today"
// always exist whatever time the suite runs.

let db: Awaited<ReturnType<typeof userClient>>["db"];
let userId = "";
const offset = 12 - new Date().getUTCHours();
const zone = offset === 0 ? "UTC" : `UTC${offset > 0 ? "+" : ""}${offset}`;
const ctx = () => ctxFor(db, userId, zone);
const now = () => DateTime.now().setZone(zone);
const today = () => now().toISODate()!;
const allDay = [{ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }];

async function setProfile(patch: Record<string, unknown>) {
  const { error } = await admin().from("profiles").update(patch).eq("id", userId);
  expect(error).toBeNull();
}
async function profile() {
  const { data } = await admin().from("profiles").select("*").eq("id", userId).single();
  return data as Profile;
}
async function block(title: string, start: DateTime, minutes: number, extra: Record<string, unknown> = {}) {
  const { data, error } = await db
    .from("plan_blocks")
    .insert({ user_id: userId, title, plan_date: start.toISODate(), starts_at: start.toISO(), ends_at: start.plus({ minutes }).toISO(), created_by: "navi", ...extra })
    .select()
    .single();
  expect(error).toBeNull();
  return data!;
}
const statusOf = async (id: string) => (await db.from("plan_blocks").select("status,outcome_reason").eq("id", id).single()).data!;

beforeEach(async () => {
  ({ db, userId } = await userClient("carol@navi.test"));
  await resetUser(userId);
  await setProfile({ timezone: zone, availability: allDay, onboarding_status: "completed" });
});

describe("focus sessions can't hide a block", () => {
  it("stopping without a reason counts as skipped; a reason the person gives excuses it", async () => {
    const t = await createTask(ctx(), { title: "Chem worksheet", estimate_minutes: 60 });
    const b1 = await block("Chem worksheet", now().minus({ minutes: 20 }), 60, { task_id: t.id });
    const s1 = await startFocus(ctx(), { task_id: t.id, block_id: b1.id });
    await endFocus(ctx(), s1.id, "abandoned");
    expect(await statusOf(b1.id)).toEqual({ status: "skipped", outcome_reason: STOPPED_NO_REASON });

    const b2 = await block("Chem worksheet", now().plus({ hours: 2 }), 30, { task_id: t.id });
    const s2 = await startFocus(ctx(), { task_id: t.id, block_id: b2.id });
    await endFocus(ctx(), s2.id, "abandoned", null, "estimate");
    expect((await statusOf(b2.id)).outcome_reason).toBe(OUTCOMES.estimate.reason);

    const b3 = await block("Chem worksheet", now().plus({ hours: 3 }), 30, { task_id: t.id });
    const s3 = await startFocus(ctx(), { task_id: t.id, block_id: b3.id });
    await endFocus(ctx(), s3.id, "abandoned", "headache", "rest");
    expect(await statusOf(b3.id)).toEqual({ status: "rest", outcome_reason: "Chose to rest: headache" });

    const r = await dayReview(db, userId, zone, today());
    expect(r.avoided).toBe(1); // the stop with no reason
    expect(r.overran).toBe(1);
    expect(r.rest).toBe(1);
    expect(r.completionRate).toBe(0); // only the unexcused stop counted
  });
});

describe("took longer than estimated", () => {
  it("is its own outcome: not avoidance, excluded from the rating, and said plainly", async () => {
    const a = await block("Essay draft", now().minus({ hours: 3 }), 60);
    const b = await block("Reading", now().minus({ hours: 2 }), 30);
    await setBlockOutcome(ctx(), a.id, OUTCOMES.estimate.status, `${OUTCOMES.estimate.reason}: intro took ages`);
    await setBlockOutcome(ctx(), b.id, "done");
    const r = await dayReview(db, userId, zone, today());
    expect(r.overran).toBe(1);
    expect(r.avoided).toBe(0);
    expect(r.completionRate).toBe(1);
    expect(r.explanation).toMatch(/1 block excluded \(rest, interruptions, missing info, took longer than estimated\)/);
    expect(r.findings.join(" ")).toMatch(/took longer than estimated/);
  });
});

describe("“my plan broke”", () => {
  it("maps each reason to a fair outcome", () => {
    expect(recoveryOutcome("rest", "tired")).toEqual({ status: "rest", reason: "Chose to rest: tired" });
    expect(recoveryOutcome("missing_info", "no rubric")).toEqual({ status: "skipped", reason: "Missing information: no rubric" });
    expect(recoveryOutcome("estimate", "lab ran long")).toEqual({ status: "skipped", reason: "Took longer than estimated: lab ran long" });
    for (const c of ["interruption", "external", "other"] as const) expect(recoveryOutcome(c, "x").status).toBe("interrupted");
  });

  it("marks only blocks in the disruption, leaves earlier ones for the review, and moves leftover work to tomorrow", async () => {
    const n = now();
    const tomorrowDow = n.plus({ days: 1 }).weekday % 7;
    // Today: free until 2 hours from now. Tomorrow: 9 to 5.
    await setProfile({ availability: [{ days: [n.weekday % 7], start: "00:00", end: n.plus({ hours: 2 }).toFormat("HH:mm") }, { days: [tomorrowDow], start: "09:00", end: "17:00" }] });
    const reading = await createTask(ctx(), { title: "Morning reading", estimate_minutes: 30 });
    const lab = await createTask(ctx(), { title: "Lab write-up", estimate_minutes: 60, priority: 1 });
    const pset = await createTask(ctx(), { title: "Problem set", estimate_minutes: 60, priority: 2 });
    const earlier = await block("Morning reading", n.minus({ hours: 3 }), 30, { task_id: reading.id });
    const current = await block("Lab write-up", n.minus({ minutes: 15 }), 60, { task_id: lab.id });
    const soon = await block("Problem set", n.plus({ minutes: 50 }), 60, { task_id: pset.id });

    const r = await recoverPlan(ctx(), { description: "lab ran long", category: "estimate", availableFrom: n.plus({ minutes: 90 }).toISO() });

    // Blocks in [now, free again] took the hit; the untouched morning block is still waiting to be marked.
    expect(await statusOf(current.id)).toEqual({ status: "skipped", outcome_reason: "Took longer than estimated: lab ran long" });
    expect(await statusOf(soon.id)).toEqual({ status: "skipped", outcome_reason: "Took longer than estimated: lab ran long" });
    const { data: morning } = await db.from("plan_blocks").select("status").eq("plan_date", n.toISODate()).eq("title", "Morning reading").eq("starts_at", earlier.starts_at);
    expect(morning).toEqual([{ status: "planned" }]);
    expect(r.summary).toMatch(/2 blocks marked as taking longer than estimated/);
    expect(r.summary).toMatch(/1 earlier block isn't marked yet/);

    // Nothing is placed before the person is free again.
    const { data: todays } = await db.from("plan_blocks").select("starts_at,status").eq("plan_date", n.toISODate()).eq("status", "planned").neq("starts_at", earlier.starts_at);
    expect(todays!.every((b) => Date.parse(b.starts_at) >= n.plus({ minutes: 90 }).toMillis())).toBe(true);

    // The hour-long tasks don't fit in what's left of today, so they're really planned tomorrow, and the summary says where.
    const tomorrow = n.plus({ days: 1 }).toISODate()!;
    const { data: next } = await db.from("plan_blocks").select("task_id,starts_at,reason").eq("plan_date", tomorrow);
    for (const t of [lab, pset]) {
      const nb = next!.find((b) => b.task_id === t.id);
      expect(nb, t.title).toBeTruthy();
      expect(nb!.reason).toMatch(/^Carried over from /);
      expect(r.summary).toContain(`“${t.title}” ${DateTime.fromISO(nb!.starts_at).setZone(zone).toFormat("h:mm a")}`);
    }
    expect(r.summary).toMatch(/Moved to tomorrow: /);

    // The disruption is read back by the reviews.
    const day = await dayReview(db, userId, zone, n.toISODate()!);
    expect(day.disruptions).toEqual({ estimate: 1 });
    expect(day.overran).toBe(2);
    expect(day.unmarked).toBeGreaterThanOrEqual(1);
    expect(day.findings.join(" ")).toMatch(/Your plan broke once today \(1 took longer than estimated\)/);
    const week = await weekInsights(db, userId, zone, n.toISODate()!);
    expect(week.disruptions).toEqual({ estimate: 1 });
    expect(week.findings.join(" ")).toMatch(/plan broke once this week/);
  });

  it("work that fits neither today nor tomorrow goes to the next free day, not just a note", async () => {
    const n = now();
    const t1 = n.plus({ days: 1 }).startOf("day");
    // The rest of today and all of tomorrow are taken by fixed commitments.
    for (const [title, s, e] of [["Shift", n, n.endOf("day")], ["Trip", t1, t1.endOf("day")]] as const) {
      const { error } = await db.from("events").insert({ user_id: userId, title, starts_at: s.toISO(), ends_at: e.toISO() });
      expect(error).toBeNull();
    }
    const essay = await createTask(ctx(), { title: "Essay draft", estimate_minutes: 60, due_at: n.plus({ days: 5 }).toISO() });
    const r = await recoverPlan(ctx(), { description: "called in to work", category: "external" });
    const day2 = n.plus({ days: 2 }).toISODate()!;
    const { data } = await db.from("plan_blocks").select("plan_date,starts_at,reason").eq("task_id", essay.id).eq("status", "planned");
    expect(data!.map((b) => b.plan_date)).toEqual([day2]);
    expect(data![0].reason).toMatch(/^Carried over from /);
    const label = DateTime.fromISO(data![0].starts_at).setZone(zone).toFormat("ccc h:mm a");
    expect(r.summary).toContain(`Moved to later days: “Essay draft” ${label}`);
    expect(r.summary).not.toMatch(/Not scheduled yet/);
  });

  it("with no 'free again' time, only the block running now is affected", async () => {
    const n = now();
    const earlier = await block("Earlier", n.minus({ hours: 2 }), 30);
    const current = await block("Current", n.minus({ minutes: 10 }), 30);
    const later = await block("Later", n.plus({ hours: 2 }), 30, { created_by: "user" });
    await recoverPlan(ctx(), { description: "fire drill", category: "external" });
    expect((await statusOf(current.id)).status).toBe("interrupted");
    expect((await statusOf(later.id)).status).toBe("planned");
    const { data } = await db.from("plan_blocks").select("status").eq("title", "Earlier").eq("starts_at", earlier.starts_at);
    expect(data).toEqual([{ status: "planned" }]);
  });
});

describe("re-planning", () => {
  it("keeps earlier blocks nobody marked instead of deleting them", async () => {
    const t = await createTask(ctx(), { title: "Flashcards", estimate_minutes: 30 });
    const past = await block("Flashcards", now().minus({ hours: 2 }), 30, { task_id: t.id, reason: "P3" });
    await generateDayPlan(ctx(), today());
    const { data } = await db.from("plan_blocks").select("title,status,starts_at,reason").eq("plan_date", today()).eq("starts_at", past.starts_at);
    expect(data).toEqual([{ title: "Flashcards", status: "planned", starts_at: past.starts_at, reason: "P3" }]);
    // The unworked block doesn't count as done work, so the task is planned again later today.
    const { data: later } = await db.from("plan_blocks").select("starts_at").eq("task_id", t.id).gt("starts_at", now().toISO()!);
    expect(later!.length).toBe(1);
    expect((await dayReview(db, userId, zone, today())).unmarked).toBe(2);
  });

  it("time in rest or interrupted blocks isn't counted as work done", async () => {
    const t = await createTask(ctx(), { title: "Slides", estimate_minutes: 60 });
    const b = await block("Slides", now().plus({ hours: 1 }), 60, { task_id: t.id });
    await setBlockOutcome(ctx(), b.id, "interrupted", "Interrupted");
    const plan = await generateDayPlan(ctx(), today());
    const minutes = plan.blocks.filter((x) => x.task_id === t.id).reduce((s, x) => s + (Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 60000, 0);
    expect(minutes).toBe(60);
  });
});

describe("stored reviews follow the record", () => {
  it("rebuilds the saved evening review after a block is marked", async () => {
    const b = await block("Essay outline", now().minus({ hours: 2 }), 45);
    const saved = await saveBriefing(admin(), await profile(), "evening", today());
    expect(saved!.body).toMatch(/1 wasn't marked; mark it/);
    expect(saved!.body).toMatch(/Open the evening review/);
    await setBlockOutcome(ctx(), b.id, "done");
    const { data } = await db.from("briefings").select("body").eq("id", saved!.id).single();
    expect(data!.body).toMatch(/1 done and 0 partly done out of 1 counted blocks/);
    expect(data!.body).not.toMatch(/wasn't marked/);
  });

  it("evening and weekly notifications lead to the review screens", () => {
    expect(briefingUrl("evening", "2026-11-02")).toBe("/review?date=2026-11-02");
    expect(briefingUrl("weekly", "2026-11-02")).toBe("/insights");
    expect(briefingUrl("morning", "2026-11-02")).toBe("/");
  });
});

describe("morning briefing", () => {
  it("lists hard deadlines in the next 3 days and work that won't fit before its deadline", async () => {
    const due = now().plus({ days: 2 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    const essay = await createTask(ctx(), { title: "History essay", estimate_minutes: 120, due_at: due.toISO(), due_is_hard: true });
    const later = await createTask(ctx(), { title: "Far deadline", due_at: now().plus({ days: 6 }).toISO(), due_is_hard: true });
    // 30 of the 120 minutes are planned before the deadline.
    await block("History essay", now().plus({ days: 1 }).set({ hour: 10, minute: 0 }), 30, { task_id: essay.id });
    const b = await buildBriefing(admin(), await profile(), "morning", today());
    expect(b.body).toContain(`Hard deadlines in the next 3 days: History essay (${due.toFormat("ccc h:mm a")})`);
    expect(b.body).not.toContain("Far deadline");
    expect(b.body).toMatch(/Won't fit before its deadline as planned: History essay \(due .*, hard\) needs about 90 min more than is planned before then/);
    expect((b.data as { atRisk: { task_id: string }[] }).atRisk.map((r) => r.task_id)).toEqual([essay.id]);
    expect(later.id).toBeTruthy();
  });

  it("judges deadline risk with the person's own track record of estimates", async () => {
    // Five finished tasks that each took 1.5× their estimate.
    for (let i = 0; i < 5; i++) {
      const t = await createTask(ctx(), { title: `Past ${i}`, estimate_minutes: 40 });
      await db.from("tasks").update({ status: "done", actual_minutes: 60, completed_at: now().minus({ days: i + 1 }).toISO() }).eq("id", t.id);
    }
    const due = now().plus({ days: 2 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    const report = await createTask(ctx(), { title: "Lab report", estimate_minutes: 60, due_at: due.toISO(), due_is_hard: true });
    // Exactly the raw estimate is planned: fine on paper, 30 min short by their history.
    await block("Lab report", now().plus({ days: 1 }).set({ hour: 10, minute: 0 }), 60, { task_id: report.id });
    const b = await buildBriefing(admin(), await profile(), "morning", today());
    expect(b.body).toMatch(/Lab report \(due .*, hard\) needs about 30 min more than is planned before then/);
    expect(b.body).toMatch(/your tasks have taken about 1\.5× their estimates/);
    const risk = (b.data as { atRisk: { task_id: string; needMinutes: number; estimateRatio: number }[] }).atRisk[0];
    expect(risk).toMatchObject({ task_id: report.id, needMinutes: 90, estimateRatio: 1.5 });
  });

  it("the scheduled morning plan's leftovers are in the briefing", async () => {
    const n = now();
    // Morning briefing due now; today is free only for the next hour.
    await setProfile({ morning_briefing_time: n.minus({ minutes: 5 }).toFormat("HH:mm"), evening_review_time: n.plus({ hours: 6 }).toFormat("HH:mm"), availability: [{ days: [n.weekday % 7], start: "00:00", end: n.plus({ hours: 1 }).toFormat("HH:mm") }] });
    await createTask(ctx(), { title: "Huge report", estimate_minutes: 600 });
    const { tickUser } = await import("@/server/jobs/tick");
    const res = await tickUser(admin(), await profile());
    expect(res).toContain("morning briefing");
    const { data } = await db.from("briefings").select("body").eq("kind", "morning").eq("local_date", today()).single();
    expect(data!.body).toMatch(/Didn't fit in today's plan: Huge report \(\d+ min\)/);
    const { data: blocks } = await db.from("plan_blocks").select("id").eq("plan_date", today());
    expect(blocks!.length).toBeGreaterThan(0);
  });
});

afterAll(async () => {
  await resetUser(userId);
  await db.auth.signOut();
});
