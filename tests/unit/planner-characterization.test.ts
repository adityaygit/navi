import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { eventOccurrence, scheduleDay, taskScore, type SchedulerInput } from "@/server/planner/scheduler";
import { buildDayAgenda, describeDayAgenda } from "@/server/planner/agenda";
import type { AvailabilityWindow, CalendarEvent, Routine, Task } from "@/lib/types";

// Characterization tests for the planner AS IT IS TODAY (Navi 1.5, Nov 2026).
// They pin current behaviour before the constraint-first planning work
// (docs/navi-1.5/PLANNING_AUDIT.md), so any change to it is deliberate and
// visible. Tests marked "ROOT CAUSE" pin behaviour the audit proposes to
// change; when that work lands, update them on purpose (don't just delete).
// Everything else is behaviour the plan keeps (regression guard).

const zone = "America/New_York";
const MON = "2026-11-02"; // a Monday (EST, after DST ended Nov 1)
const morning = DateTime.fromISO(`${MON}T08:00`, { zone });
const theNightBefore = DateTime.fromISO("2026-11-01T22:00", { zone });

const task = (over: Partial<Task>): Task => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  workspace_id: null, project_id: null, goal_id: null, milestone_id: null, parent_task_id: null,
  title: "Task", notes: null, status: "todo", priority: 3, due_at: null, due_is_hard: false,
  estimate_minutes: 30, actual_minutes: 0, recurrence: null, blocker: null, source: "user",
  completed_at: null, created_at: "", updated_at: "", ...over,
});
const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: over.id ?? "e", workspace_id: null, title: "Event", starts_at: "", ends_at: "", recurrence: null,
  location: null, notes: null, source: "user", external_ref: null, status: "confirmed", ...over,
});
const routine = (over: Partial<Routine>): Routine => ({
  id: over.id ?? "r", workspace_id: null, goal_id: null, title: "Routine", days: [0, 1, 2, 3, 4, 5, 6], start_time: null,
  duration_minutes: 30, is_fixed: false, active: true, ...over,
});
const afterSchool: AvailabilityWindow[] = [{ days: [1, 2, 3, 4, 5], start: "16:00", end: "21:00" }];

function plan(over: Partial<SchedulerInput>) {
  return scheduleDay({ date: MON, zone, now: morning, availability: afterSchool, events: [], routines: [], tasks: [], keptBlocks: [], ...over });
}
const hm = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("HH:mm");
const mins = (b: { starts_at: string; ends_at: string }) => DateTime.fromISO(b.ends_at).diff(DateTime.fromISO(b.starts_at), "minutes").minutes;

describe("availability model today", () => {
  it("ROOT CAUSE: with no availability windows, nothing flexible is planned even on an empty day", () => {
    const out = plan({ availability: [], tasks: [task({ id: "chem", title: "Chemistry", priority: 1, due_at: `${MON}T23:59:00-05:00`, due_is_hard: true })] });
    expect(out.blocks).toHaveLength(0);
    expect(out.freeMinutes).toBe(0);
    expect(out.unscheduled.map((u) => u.task_id)).toEqual(["chem"]);
    expect(out.warnings[0]).toMatch(/No availability is set/);
  });

  it("ROOT CAUSE: flexible routines (meals, exercise with no set time) are not placed without availability either", () => {
    const out = plan({ availability: [], routines: [routine({ id: "walk", title: "Walk" })] });
    expect(out.blocks).toHaveLength(0);
    // A routine that doesn't fit isn't reported anywhere: `unscheduled` lists tasks only.
    expect(out.unscheduled).toHaveLength(0);
  });

  it("ROOT CAUSE: a weekday with no window gets only fixed items, with a warning", () => {
    const out = plan({ availability: [{ days: [6], start: "10:00", end: "12:00" }], tasks: [task({ id: "a" })] });
    expect(out.blocks).toHaveLength(0);
    expect(out.warnings).toContain("You have no availability on this day, so only fixed commitments are shown.");
  });

  it("ROOT CAUSE: a window that crosses midnight (22:00–01:00) is silently ignored, with no warning", () => {
    const out = plan({ availability: [{ days: [1], start: "22:00", end: "01:00" }], tasks: [task({ id: "a" })] });
    expect(out.blocks).toHaveLength(0);
    expect(out.freeMinutes).toBe(0);
    expect(out.warnings).toEqual([]);
  });

  it("ROOT CAUSE: availability is the only protection for sleep: a 00:00–23:59 window books work at midnight", () => {
    const out = plan({ now: theNightBefore, availability: [{ days: [1], start: "00:00", end: "23:59" }], tasks: [task({ id: "a" })] });
    expect(hm(out.blocks[0].starts_at)).toBe("00:00");
  });

  it("availability is all-or-nothing: no confirmed / inferred / unknown distinction in the output", () => {
    const out = plan({ tasks: [task({ id: "a" })] });
    // A block carries no notion of whether its time was confirmed or assumed.
    expect(Object.keys(out.blocks[0]).sort()).toEqual(["ends_at", "is_flexible", "reason", "routine_id", "starts_at", "task_id", "title"]);
  });
});

describe("how commitments are represented today", () => {
  it("ROOT CAUSE: a timed routine NOT marked fixed is still treated as immovable by the scheduler, while the AI is told it 'can move'", () => {
    const dinner = routine({ id: "dinner", title: "Dinner", days: [1], start_time: "18:00", duration_minutes: 60, is_fixed: false });
    const out = plan({ routines: [dinner], tasks: [task({ id: "a", estimate_minutes: 60 })] });
    expect(out.fixed).toEqual([expect.objectContaining({ title: "Dinner", kind: "routine" })]);
    expect(out.blocks.every((b) => b.routine_id !== "dinner")).toBe(true);
    const text = describeDayAgenda(buildDayAgenda({ date: MON, zone, events: [], routines: [dinner], blocks: [], tasks: [] }), zone, MON);
    expect(text).toMatch(/Dinner \(routine, preferred time \(can move\)\)/);
  });

  it("a tentative event blocks time exactly like a confirmed one", () => {
    const maybe = event({ title: "Maybe hangout", status: "tentative", starts_at: `${MON}T16:00:00-05:00`, ends_at: `${MON}T18:00:00-05:00` });
    const out = plan({ events: [maybe], tasks: [task({ id: "a" })] });
    expect(out.fixed.map((f) => f.title)).toEqual(["Maybe hangout"]);
    expect(hm(out.blocks[0].starts_at)).toBe("18:10");
  });

  it("a cancelled event frees its time", () => {
    const karate = event({ title: "Karate", status: "cancelled", starts_at: `${MON}T16:00:00-05:00`, ends_at: `${MON}T18:00:00-05:00` });
    const out = plan({ events: [karate], tasks: [task({ id: "a" })] });
    expect(out.fixed).toHaveLength(0);
    expect(hm(out.blocks[0].starts_at)).toBe("16:00");
  });

  it("ROOT CAUSE: a weekly event has no single-date exception: cancelling it cancels every week", () => {
    const karate = event({ title: "Karate", starts_at: "2026-10-05T17:00:00-04:00", ends_at: "2026-10-05T18:30:00-04:00", recurrence: { freq: "weekly", days: [1] } });
    expect(eventOccurrence(karate, MON, zone)).not.toBeNull();
    const cancelled = { ...karate, status: "cancelled" as const };
    expect(eventOccurrence(cancelled, MON, zone)).toBeNull();
    expect(eventOccurrence(cancelled, "2026-11-09", zone)).toBeNull(); // next Monday is gone too
  });

  it("blocked tasks are never scheduled", () => {
    const out = plan({ tasks: [task({ id: "b", status: "blocked" }), task({ id: "a" })] });
    expect(out.blocks.map((b) => b.task_id)).toEqual(["a"]);
    expect(out.unscheduled).toHaveLength(0);
  });

  it("a user-made block is busy time; flexible work routes around it with the 10-minute buffer", () => {
    const kept = [{ starts_at: `${MON}T16:00:00-05:00`, ends_at: `${MON}T17:00:00-05:00`, task_id: null, routine_id: null, status: "planned" as const, title: "Mine" }];
    const out = plan({ keptBlocks: kept, tasks: [task({ id: "a" })] });
    expect(hm(out.blocks[0].starts_at)).toBe("17:10");
  });
});

describe("priority, deadlines and must-complete work today", () => {
  it("ROOT CAUSE: there is no 'must-complete' flag; urgency is one additive score of priority + due date + hard flag", () => {
    const now = morning;
    // P1 with no deadline (40) < P4 due in 10h (10 + 35) < P3 with a hard deadline in 30h (20 + 20 + 10).
    const important = task({ id: "important", priority: 1 });
    const soonButMinor = task({ id: "minor", priority: 4, due_at: now.plus({ hours: 10 }).toISO()! });
    const hard = task({ id: "hard", priority: 3, due_at: now.plus({ hours: 30 }).toISO()!, due_is_hard: true });
    expect([taskScore(important, now), taskScore(soonButMinor, now), taskScore(hard, now)]).toEqual([40, 45, 50]);
    const out = plan({ tasks: [important, soonButMinor, hard] });
    expect(out.blocks.map((b) => b.task_id)).toEqual(["hard", "minor", "important"]);
  });

  it("overload never drops work: placed + unscheduled minutes equal the total, and due-today shortfalls are warned", () => {
    const tasks = [
      task({ id: "apworld", title: "AP World essay", priority: 1, estimate_minutes: 180, due_at: `${MON}T23:59:00-05:00`, due_is_hard: true }),
      task({ id: "chem", title: "Chemistry problem set", priority: 1, estimate_minutes: 120, due_at: `${MON}T23:59:00-05:00`, due_is_hard: true }),
      task({ id: "read", title: "Reading", priority: 3, estimate_minutes: 60 }),
    ];
    const out = plan({ tasks }); // 16:00–21:00 = 300 minutes of window, buffers eat some
    const placed = (id: string) => out.blocks.filter((b) => b.task_id === id).reduce((s, b) => s + mins(b), 0);
    const left = (id: string) => out.unscheduled.find((u) => u.task_id === id)?.remaining_minutes ?? 0;
    for (const t of tasks) expect(placed(t.id) + left(t.id), t.id).toBe(t.estimate_minutes);
    expect(out.unscheduled.length).toBeGreaterThan(0);
    expect(out.warnings.some((w) => /is due by today but/.test(w))).toBe(true);
  });

  it("an overdue task is placed first but gets no 'after its deadline' warning", () => {
    const late = task({ id: "late", title: "Late form", due_at: DateTime.fromISO(`${MON}T07:00`, { zone }).toISO()! });
    const out = plan({ tasks: [task({ id: "other", priority: 1 }), late] });
    expect(out.blocks[0].task_id).toBe("late");
    expect(out.blocks[0].reason).toMatch(/^overdue/);
    expect(out.afterDeadline).toHaveLength(0);
  });

  it("a task with no estimate is planned as 30 minutes and says so", () => {
    const out = plan({ tasks: [task({ id: "a", estimate_minutes: null })] });
    expect(mins(out.blocks[0])).toBe(30);
    expect(out.blocks[0].reason).toMatch(/no estimate, 30m assumed/);
  });

  it("a learned estimate ratio stretches the time booked (60m at ×1.5 → 90m)", () => {
    const out = plan({ tasks: [task({ id: "a", estimate_minutes: 60 })], estimateRatio: 1.5 });
    expect(out.blocks.reduce((s, b) => s + mins(b), 0)).toBe(90);
    expect(out.blocks[0].reason).toMatch(/estimate adjusted ×1\.50/);
  });

  it("time already worked (actual_minutes) is subtracted from what's left to plan", () => {
    const out = plan({ tasks: [task({ id: "a", estimate_minutes: 90, actual_minutes: 60 })] });
    expect(out.blocks.reduce((s, b) => s + mins(b), 0)).toBe(30);
  });
});
