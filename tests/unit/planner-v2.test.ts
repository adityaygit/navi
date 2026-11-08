import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { buildDayModel, isWakeBedDefault, typicalHoursFor, windowOn, type DayModelInput } from "@/server/planner/day-model";
import { scheduleDayV2, type SchedulerV2Input } from "@/server/planner/scheduler-v2";
import { scheduleDay } from "@/server/planner/scheduler";
import { clarificationFor, shortfalls, tradeoffs } from "@/server/planner/horizon";
import type { AvailabilityWindow, CalendarEvent, DayException, Routine, Task } from "@/lib/types";

// The constraint-first planner (v2), pure parts: day model, scheduler,
// feasibility. Validation scenarios from docs/navi-1.5/PLANNING_AUDIT.md
// (Part 4) are named "Scenario N".

const zone = "America/New_York";
const MON = "2026-11-02";
const TUE = "2026-11-03";
const at = (date: string, hm: string) => DateTime.fromISO(`${date}T${hm}`, { zone });
const morning = at(MON, "07:00");
const hm = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("HH:mm");
const mins = (b: { starts_at: string; ends_at: string }) => DateTime.fromISO(b.ends_at).diff(DateTime.fromISO(b.starts_at), "minutes").minutes;

const task = (over: Partial<Task>): Task => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  workspace_id: null, project_id: null, goal_id: null, milestone_id: null, parent_task_id: null,
  title: over.id ?? "Task", notes: null, status: "todo", priority: 3, due_at: null, due_is_hard: false,
  estimate_minutes: 30, actual_minutes: 0, recurrence: null, blocker: null, source: "user",
  completed_at: null, created_at: "", updated_at: "", commitment: "normal", not_before: null, ...over,
});
const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: over.id ?? "e", workspace_id: null, title: "Event", starts_at: "", ends_at: "", recurrence: null,
  location: null, notes: null, source: "user", external_ref: null, status: "confirmed", ...over,
});
const routine = (over: Partial<Routine>): Routine => ({
  id: over.id ?? "r", workspace_id: null, goal_id: null, title: over.id ?? "Routine", days: [0, 1, 2, 3, 4, 5, 6], start_time: null,
  duration_minutes: 30, is_fixed: false, active: true, protection: null, kind: "other", window_start: null, window_end: null, ...over,
});
const wake7bed23 = { wake: "07:00", bed: "23:00" };

function model(over: Partial<DayModelInput> = {}) {
  return buildDayModel({
    date: MON, zone, wakeBed: wake7bed23, usualFree: [], usualFreeIsDefault: false, rules: [], exceptions: [], events: [], overrides: [], routines: [],
    assumeFreeTime: true, typicalHours: [], history: [], ...over,
  });
}
function plan(m: ReturnType<typeof model>, over: Partial<SchedulerV2Input> = {}) {
  return scheduleDayV2({ date: m.date, zone, now: morning, model: m, events: [], overrides: [], routines: [], tasks: [], keptBlocks: [], ...over });
}

describe("day model", () => {
  it("Scenario 1: a new user with no free-time windows gets assumed free time from wake-up to bedtime, never during sleep", () => {
    const m = model();
    expect(m.capacity).toEqual([expect.objectContaining({ basis: "inferred", reason: "you're awake and nothing else is on" })]);
    expect(hm(m.capacity[0].starts_at)).toBe("07:00");
    expect(hm(m.capacity[0].ends_at)).toBe("23:00");
    expect(m.minutes).toEqual({ confirmed: 0, inferred: 16 * 60, unknown: 0 });
    expect(m.clarification).toBeNull();
  });

  it("knows nothing without wake/bed or free times, and asks one question instead of planning", () => {
    const m = model({ wakeBed: null });
    expect(m.capacity).toEqual([]);
    expect(m.clarification).toMatch(/When are you usually free on Mondays\?/);
    const out = plan(m, { tasks: [task({ id: "a" })] });
    expect(out.blocks).toHaveLength(0);
    expect(out.unscheduled.map((u) => u.task_id)).toEqual(["a"]);
    expect(out.warnings).toContain(m.clarification);
  });

  it("D1 off: awake time with nothing recorded is unknown, not assumed", () => {
    const m = model({ assumeFreeTime: false, usualFree: [{ days: [1], start: "16:00", end: "18:00" }] });
    expect(m.capacity.map((c) => c.basis)).toEqual(["confirmed"]);
    expect(m.minutes.unknown).toBe(16 * 60 - 120);
  });

  it("Settings' free times are confirmed; the wake-to-bed default from setup is only an assumption", () => {
    const def: AvailabilityWindow[] = [{ days: [0, 1, 2, 3, 4, 5, 6], start: "07:00", end: "23:00" }];
    expect(isWakeBedDefault(def, wake7bed23)).toBe(true);
    expect(isWakeBedDefault([{ days: [1, 2, 3, 4, 5], start: "16:00", end: "21:00" }], wake7bed23)).toBe(false);
    expect(model({ usualFree: def, usualFreeIsDefault: true }).capacity.every((c) => c.basis === "inferred")).toBe(true);
    const m = model({ usualFree: [{ days: [1], start: "16:00", end: "21:00" }] });
    expect(m.capacity.map((c) => [hm(c.starts_at), hm(c.ends_at), c.basis])).toEqual([
      ["07:00", "16:00", "inferred"],
      ["16:00", "21:00", "confirmed"],
      ["21:00", "23:00", "inferred"],
    ]);
  });

  it("B1 fixed: a free window crossing midnight counts on both days", () => {
    const w = { days: [1], start: "22:00", end: "01:00" };
    expect(windowOn(w, MON, zone).map((i) => [hm(i.start!.toISO()!), i.length("minutes")])).toEqual([["22:00", 120]]);
    expect(windowOn(w, TUE, zone).map((i) => [hm(i.start!.toISO()!), i.length("minutes")])).toEqual([["00:00", 60]]);
    const m = model({ wakeBed: null, usualFree: [w] });
    expect(m.minutes.confirmed).toBe(120);
  });

  it("Scenario 2: weekday school hours with nothing recorded are unknown; recorded school makes the rest assumable", () => {
    const typical = typicalHoursFor(["School", "Karate"]);
    expect(typical).toEqual([{ start: "08:00", end: "15:00", label: "school hours" }]);
    const unknownDay = model({ typicalHours: typical });
    expect(unknownDay.unknown).toEqual([expect.objectContaining({ label: "school hours" })]);
    expect(unknownDay.minutes.unknown).toBe(7 * 60);
    const school = event({ id: "school", title: "School", starts_at: "2026-10-05T08:00:00-04:00", ends_at: "2026-10-05T15:15:00-04:00", recurrence: { freq: "weekly", days: [1, 2, 3, 4, 5] } });
    const known = model({ typicalHours: typical, events: [school] });
    expect(known.unknown).toEqual([]);
    // A weekend has no school hours.
    expect(model({ date: "2026-11-07", typicalHours: typical }).unknown).toEqual([]);
  });

  it("time the person worked in on 2+ recent same weekdays is assumed free again, with that reason", () => {
    const history = [
      { starts_at: at("2026-10-19", "10:00").toISO()!, ends_at: at("2026-10-19", "11:00").toISO()! },
      { starts_at: at("2026-10-26", "10:00").toISO()!, ends_at: at("2026-10-26", "11:00").toISO()! },
    ];
    const m = model({ typicalHours: [{ start: "08:00", end: "15:00", label: "school hours" }], history });
    const learned = m.capacity.find((c) => c.reason?.startsWith("you've worked then"));
    expect(learned && [hm(learned.starts_at), hm(learned.ends_at)]).toEqual(["10:00", "11:00"]);
    expect(m.minutes.unknown).toBe(6 * 60);
  });

  it("one-day facts: busy and free exceptions, and a capacity limit", () => {
    const ex = (over: Partial<DayException>): DayException => ({ id: "x", date: MON, kind: "busy", start_time: null, end_time: null, minutes: null, note: null, source: "chat", ...over });
    const m = model({
      usualFree: [{ days: [1], start: "16:00", end: "21:00" }],
      rules: [{ id: "r", days: [1], start_time: "12:00", end_time: "15:00", kind: "busy", basis: "confirmed", source: "chat", valid_from: null, valid_until: null, note: "Work" }],
      exceptions: [ex({ kind: "busy", start_time: "18:00", end_time: "19:30", note: "Karate" }), ex({ kind: "free", start_time: "13:00", end_time: "15:00" }), ex({ kind: "capacity", minutes: 120 })],
    });
    expect(m.busy.map((b) => [b.title, hm(b.starts_at), hm(b.ends_at)])).toEqual([["Karate", "18:00", "19:30"], ["Work", "12:00", "13:00"]]);
    expect(m.capacity.filter((c) => c.basis === "confirmed").map((c) => [hm(c.starts_at), hm(c.ends_at)])).toEqual([["13:00", "15:00"], ["16:00", "18:00"], ["19:30", "21:00"]]);
    expect(m.capacityLimitMinutes).toBe(120);
  });
});

describe("v2 scheduler", () => {
  it("matches v1 exactly with confirmed windows only, no new data and no load cap (engine parity)", () => {
    const availability = [{ days: [1, 2, 3, 4, 5], start: "16:00", end: "21:00" }];
    const events = [event({ title: "Practice", starts_at: `${MON}T16:25:00-05:00`, ends_at: `${MON}T19:00:00-05:00` })];
    const routines = [routine({ id: "gym", start_time: "20:00", duration_minutes: 30, is_fixed: true }), routine({ id: "read", duration_minutes: 20 })];
    const tasks = [task({ id: "a", priority: 1, estimate_minutes: 100 }), task({ id: "b", estimate_minutes: 45, due_at: `${TUE}T12:00:00-05:00` }), task({ id: "c", estimate_minutes: null })];
    const now = at(MON, "08:00");
    const v1 = scheduleDay({ date: MON, zone, now, availability, events, routines, tasks, keptBlocks: [] });
    const m = model({ wakeBed: null, usualFree: availability });
    const v2 = scheduleDayV2({ date: MON, zone, now, model: m, events, overrides: [], routines, tasks, keptBlocks: [], loadCap: 1, horizonEnd: now });
    const strip = (bs: { title: string; task_id: string | null; routine_id: string | null; starts_at: string; ends_at: string }[]) => bs.map((b) => [b.task_id ?? b.routine_id, hm(b.starts_at), hm(b.ends_at)]);
    expect(strip(v2.blocks)).toEqual(strip(v1.blocks));
    expect(v2.unscheduled.map((u) => [u.task_id, u.remaining_minutes])).toEqual(v1.unscheduled.map((u) => [u.task_id, u.remaining_minutes]));
    expect(v2.freeMinutes).toBe(v1.freeMinutes);
  });

  it("Scenario 1: plans a no-setup day in assumed time, says so (at most two assumptions), avoids sleep and events", () => {
    const m = model();
    const ev = event({ title: "Dentist", starts_at: `${MON}T09:00:00-05:00`, ends_at: `${MON}T10:00:00-05:00` });
    const out = plan(m, { events: [ev], tasks: [task({ id: "a", estimate_minutes: 60 }), task({ id: "b", estimate_minutes: 60 })], loadCap: 1 });
    expect(out.blocks.map((b) => [b.task_id, hm(b.starts_at), b.basis])).toEqual([["a", "07:00", "inferred"], ["b", "10:10", "inferred"]]);
    expect(out.assumptions.length).toBeGreaterThan(0);
    expect(out.assumptions.length).toBeLessThanOrEqual(2);
    expect(out.assumptions[0]).toMatch(/^I assumed you're free 7 AM–8 AM \(you're awake and nothing else is on\)\.$/);
    expect(out.blocks.every((b) => hm(b.starts_at) >= "07:00" && hm(b.ends_at) <= "23:00")).toBe(true);
  });

  it("uses confirmed time before assumed time", () => {
    const m = model({ usualFree: [{ days: [1], start: "16:00", end: "21:00" }] });
    const out = plan(m, { tasks: [task({ id: "a" })] });
    expect(out.blocks.map((b) => [hm(b.starts_at), b.basis])).toEqual([["16:00", "confirmed"]]);
    expect(out.assumptions).toEqual([]);
  });

  it("D7: keeps about 30% of free time open for flexible work, but not for must-complete work", () => {
    const m = model({ wakeBed: null, usualFree: [{ days: [1], start: "16:00", end: "20:00" }] }); // 240 free minutes
    const many = Array.from({ length: 6 }, (_, i) => task({ id: `t${i}`, estimate_minutes: 40 }));
    const out = plan(m, { tasks: many });
    const placed = out.blocks.reduce((s, b) => s + mins(b), 0);
    expect(placed).toBeLessThanOrEqual(Math.floor(240 * 0.7));
    expect(out.unscheduled.some((u) => u.why === "Kept free so the day isn't packed")).toBe(true);
    expect(out.heldBackMinutes).toBeGreaterThan(0);
    const musts = many.map((t) => ({ ...t, commitment: "must" as const }));
    expect(plan(m, { tasks: musts }).unscheduled.some((u) => u.why === "Kept free so the day isn't packed")).toBe(false);
  });

  it("'only 2 hours today' caps all work, must-complete first", () => {
    const m = model({ exceptions: [{ id: "x", date: MON, kind: "capacity", start_time: null, end_time: null, minutes: 120, note: null, source: "chat" }] });
    const out = plan(m, { tasks: [task({ id: "fun", priority: 1, estimate_minutes: 60 }), task({ id: "chem", commitment: "must", estimate_minutes: 90 }), task({ id: "apw", estimate_minutes: 60 })] });
    expect(out.blocks.reduce((s, b) => s + mins(b), 0)).toBeLessThanOrEqual(120);
    expect(out.blocks[0].task_id).toBe("chem");
    expect(out.unscheduled.find((u) => u.task_id === "fun")?.why).toMatch(/Over the 120 minutes you said you have today/);
  });

  it("Scenario 3: competing must-complete deadlines go earliest-deadline-first, ahead of higher-priority flexible work", () => {
    const m = model({ wakeBed: null, usualFree: [{ days: [1], start: "16:00", end: "20:00" }] });
    const tasks = [
      task({ id: "big-p1", priority: 1, estimate_minutes: 60 }),
      task({ id: "lab-thu", commitment: "must", estimate_minutes: 60, due_at: "2026-11-05T23:59:00-05:00" }),
      task({ id: "essay-tue", estimate_minutes: 60, due_at: `${TUE}T23:59:00-05:00`, due_is_hard: true }),
      task({ id: "quiz-wed", commitment: "must", estimate_minutes: 60, due_at: "2026-11-04T23:59:00-05:00", priority: 4 }),
    ];
    const out = plan(m, { tasks });
    expect(out.blocks.map((b) => b.task_id)).toEqual(["essay-tue", "quiz-wed", "lab-thu"]);
    expect(out.mustTaskIds.sort()).toEqual(["essay-tue", "lab-thu", "quiz-wed"]);
    expect(out.unscheduled.map((u) => u.task_id)).toEqual(["big-p1"]);
  });

  it("Scenario 6: not enough time: nothing is dropped, the shortfall is named with ≤3 tradeoffs and one question", () => {
    const typical = [{ start: "08:00", end: "15:00", label: "school hours" }];
    const m = model({ usualFree: [{ days: [1], start: "16:00", end: "18:00" }], wakeBed: { wake: "07:00", bed: "18:00" }, typicalHours: typical });
    const tasks = [
      task({ id: "apw", title: "AP World essay", commitment: "must", estimate_minutes: 300, due_at: `${MON}T23:59:00-05:00`, due_is_hard: true }),
      task({ id: "read", title: "Reading", estimate_minutes: 60 }),
    ];
    const out = plan(m, { tasks, loadCap: 0.7 });
    for (const t of tasks) {
      const placed = out.blocks.filter((b) => b.task_id === t.id).reduce((s, b) => s + mins(b), 0);
      const left = out.unscheduled.find((u) => u.task_id === t.id)?.remaining_minutes ?? 0;
      expect(placed + left, t.id).toBe(t.estimate_minutes);
    }
    const short = shortfalls(out, tasks, MON, zone, []);
    expect(short).toEqual([expect.objectContaining({ task_id: "apw", hard: true })]);
    const titles = new Map(tasks.map((t) => [t.id, { title: t.title, commitment: t.commitment }]));
    const opts = tradeoffs(short, out, m, zone, titles);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.length).toBeLessThanOrEqual(3);
    expect(opts.join(" ")).toMatch(/school hours|extension/);
    expect(clarificationFor(short, m, zone)).toMatch(/^Are you free between 8:00 AM and 3:00 PM on Monday\?/);
  });

  it("a deadline later in the week isn't a shortfall today if later days have room", () => {
    const out = { unscheduled: [{ task_id: "lab", title: "Lab", remaining_minutes: 60, due_at: "2026-11-05T23:59:00-05:00", why: "" }], mustTaskIds: ["lab"] };
    const tasks = [{ id: "lab", title: "Lab", due_at: "2026-11-05T23:59:00-05:00", due_is_hard: true }];
    expect(shortfalls(out, tasks, MON, zone, [{ date: TUE, minutes: 30 }, { date: "2026-11-04", minutes: 30 }])).toEqual([]);
    expect(shortfalls(out, tasks, MON, zone, [{ date: TUE, minutes: 30 }])[0].short_minutes).toBe(30);
  });

  it("Scenario 7: conflicting constraints are reported, never resolved by moving fixed things", () => {
    const a = event({ id: "a", title: "Recital", starts_at: `${MON}T17:00:00-05:00`, ends_at: `${MON}T19:00:00-05:00` });
    const b = event({ id: "b", title: "Team dinner", starts_at: `${MON}T18:00:00-05:00`, ends_at: `${MON}T20:00:00-05:00` });
    const dinner = routine({ id: "dinner", title: "Dinner", kind: "meal", start_time: "18:30", duration_minutes: 45 });
    const out = plan(model(), { events: [a, b], routines: [dinner] });
    expect(out.conflicts.some((c) => /“Recital” and “Team dinner” overlap/.test(c))).toBe(true);
    expect(out.unplacedRoutines).toEqual([expect.objectContaining({ routine_id: "dinner" })]);
    expect(out.fixed.filter((f) => f.kind === "event").map((f) => hm(f.starts_at))).toEqual(["17:00", "18:00"]);
  });

  it("D5: a meal moves at most 30 minutes to fit around fixed plans; a plain timed routine stays put (B3: same in text and planner)", () => {
    const dinner = routine({ id: "dinner", title: "Dinner", kind: "meal", start_time: "18:00", duration_minutes: 45 });
    const ev = event({ title: "Call", starts_at: `${MON}T17:30:00-05:00`, ends_at: `${MON}T18:15:00-05:00` });
    const out = plan(model(), { events: [ev], routines: [dinner] });
    expect(out.blocks.filter((b) => b.routine_id === "dinner").map((b) => hm(b.starts_at))).toEqual(["18:15"]);
    const quiet = routine({ id: "quiet", title: "Quiet time", start_time: "18:00", duration_minutes: 30 });
    const out2 = plan(model(), { events: [ev], routines: [quiet] });
    expect(out2.fixed.find((f) => f.title === "Quiet time")).toBeDefined();
    expect(out2.blocks).toHaveLength(0);
  });

  it("D5: sleep is never planned into; untimed protected exercise is reserved before tasks", () => {
    const gym = routine({ id: "gym", title: "Exercise", kind: "exercise", protection: "protected", duration_minutes: 45 });
    const m = model({ wakeBed: { wake: "07:00", bed: "08:00" } });
    const out = plan(m, { routines: [gym], tasks: [task({ id: "a", priority: 1, commitment: "must", estimate_minutes: 60 })] });
    expect(out.blocks.map((b) => b.routine_id ?? b.task_id)).toEqual(["gym"]);
    expect(out.unscheduled.map((u) => u.task_id)).toEqual(["a"]);
  });

  it("B9 fixed: routines and blocked tasks that aren't planned are reported", () => {
    const m = model({ wakeBed: null });
    const out = plan(m, { routines: [routine({ id: "walk", title: "Walk", protection: "flexible" })], tasks: [task({ id: "stuck", status: "blocked" })] });
    expect(out.unplacedRoutines.map((r) => r.routine_id)).toEqual(["walk"]);
    expect(out.blockedTasks.map((t) => t.task_id)).toEqual(["stuck"]);
  });

  it("dependencies and not_before: work starts after its prerequisite and not before its start date", () => {
    const m = model({ wakeBed: null, usualFree: [{ days: [1], start: "16:00", end: "20:00" }] });
    const outline = task({ id: "outline", estimate_minutes: 30, priority: 4 });
    const draft = task({ id: "draft", estimate_minutes: 30, priority: 1 });
    const out = plan(m, { tasks: [draft, outline], dependencies: { draft: ["outline"] }, loadCap: 1 });
    expect(out.blocks.map((b) => [b.task_id, hm(b.starts_at)])).toEqual([["outline", "16:00"], ["draft", "16:40"]]);
    const later = plan(m, { tasks: [task({ id: "x", not_before: `${TUE}T09:00:00-05:00` })] });
    expect(later.blocks).toHaveLength(0);
    expect(later.waiting).toEqual([expect.objectContaining({ task_id: "x", why: expect.stringMatching(/not before Tue/) })]);
    const evening = plan(m, { tasks: [task({ id: "y", not_before: `${MON}T18:00:00-05:00` })] });
    expect(hm(evening.blocks[0].starts_at)).toBe("18:00");
  });

  it("Scenario 4 (pure part): a cancelled session frees only that day; a moved session lands on its new time", () => {
    const karate = event({ id: "k", title: "Karate", starts_at: "2026-10-05T16:00:00-04:00", ends_at: "2026-10-05T18:00:00-04:00", recurrence: { freq: "weekly", days: [1] } });
    const m = model({ wakeBed: null, usualFree: [{ days: [1], start: "16:00", end: "20:00" }] });
    const before = plan(m, { events: [karate], tasks: [task({ id: "a" })] });
    expect(hm(before.blocks[0].starts_at)).toBe("18:10");
    const cancelled = plan(m, { events: [karate], overrides: [{ id: "o", event_id: "k", occurrence_date: MON, status: "cancelled", starts_at: null, ends_at: null }], tasks: [task({ id: "a" })] });
    expect(hm(cancelled.blocks[0].starts_at)).toBe("16:00");
    const nextWeek = model({ date: "2026-11-09", wakeBed: null, usualFree: [{ days: [1], start: "16:00", end: "20:00" }] });
    expect(scheduleDayV2({ date: "2026-11-09", zone, now: morning, model: nextWeek, events: [karate], overrides: [{ id: "o", event_id: "k", occurrence_date: MON, status: "cancelled", starts_at: null, ends_at: null }], routines: [], tasks: [], keptBlocks: [] }).fixed).toHaveLength(1);
    const moved = plan(m, { events: [karate], overrides: [{ id: "o", event_id: "k", occurrence_date: MON, status: "moved", starts_at: `${MON}T18:00:00-05:00`, ends_at: `${MON}T19:00:00-05:00` }], tasks: [task({ id: "a" })] });
    expect(moved.fixed.map((f) => hm(f.starts_at))).toEqual(["18:00"]);
    expect(hm(moved.blocks[0].starts_at)).toBe("16:00");
  });

  it("Scenario 5 (pure part): a task worked past its estimate but still open gets more time, not zero", () => {
    const m = model({ wakeBed: null, usualFree: [{ days: [1], start: "16:00", end: "20:00" }] });
    const out = plan(m, { tasks: [task({ id: "chem", estimate_minutes: 60, actual_minutes: 75 })] });
    expect(out.blocks.map((b) => [b.task_id, mins(b)])).toEqual([["chem", 30]]);
    expect(out.blocks[0].reason).toMatch(/took longer than its estimate; 30m more assumed/);
  });

  it("never schedules into unknown time", () => {
    const m = model({ typicalHours: [{ start: "08:00", end: "15:00", label: "school hours" }], wakeBed: { wake: "07:00", bed: "16:00" } });
    const out = plan(m, { now: at(MON, "08:00"), tasks: [task({ id: "a", estimate_minutes: 60, commitment: "must" })] });
    expect(out.blocks.map((b) => hm(b.starts_at))).toEqual(["15:00"]);
  });
});
