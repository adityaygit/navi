import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { eventOccurrence, learnedEstimateRatio, scheduleDay } from "@/server/planner/scheduler";
import type { CalendarEvent, Routine, Task } from "@/lib/types";

const zone = "America/New_York";
const task = (over: Partial<Task>): Task => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  workspace_id: null, project_id: null, goal_id: null, milestone_id: null, parent_task_id: null,
  title: "Task", notes: null, status: "todo", priority: 3, due_at: null, due_is_hard: false,
  estimate_minutes: 30, actual_minutes: 0, recurrence: null, blocker: null, source: "user",
  completed_at: null, created_at: "", updated_at: "", ...over,
});
const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e", workspace_id: null, title: "Event", starts_at: "", ends_at: "", recurrence: null,
  location: null, notes: null, source: "user", external_ref: null, status: "confirmed", ...over,
});
const weekdays = [{ days: [1, 2, 3, 4, 5], start: "16:00", end: "20:00" }];
const morning = DateTime.fromISO("2026-11-02T08:00", { zone }); // Monday

describe("scheduleDay", () => {
  it("does not invent availability when none is declared", () => {
    const out = scheduleDay({ date: "2026-11-02", zone, now: morning, availability: [], events: [], routines: [], tasks: [task({})], keptBlocks: [] });
    expect(out.blocks).toHaveLength(0);
    expect(out.warnings[0]).toMatch(/No availability/);
    expect(out.unscheduled).toHaveLength(1);
  });

  it("places higher-priority and sooner-due work first, inside availability", () => {
    const low = task({ id: "low", title: "Low", priority: 4 });
    const urgent = task({ id: "urgent", title: "Urgent", priority: 2, due_at: "2026-11-02T23:00:00-05:00" });
    const out = scheduleDay({ date: "2026-11-02", zone, now: morning, availability: weekdays, events: [], routines: [], tasks: [low, urgent], keptBlocks: [] });
    expect(out.blocks.map((b) => b.task_id)).toEqual(["urgent", "low"]);
    const first = DateTime.fromISO(out.blocks[0].starts_at).setZone(zone);
    expect(first.toFormat("HH:mm")).toBe("16:00");
  });

  it("routes around fixed events with a buffer", () => {
    const ev = event({ starts_at: "2026-11-02T16:00:00-05:00", ends_at: "2026-11-02T17:00:00-05:00", title: "Practice" });
    const out = scheduleDay({ date: "2026-11-02", zone, now: morning, availability: weekdays, events: [ev], routines: [], tasks: [task({ id: "a" })], keptBlocks: [] });
    expect(DateTime.fromISO(out.blocks[0].starts_at).setZone(zone).toFormat("HH:mm")).toBe("17:10");
    expect(out.fixed[0].title).toBe("Practice");
  });

  it("splits long tasks and reports what doesn't fit instead of dropping it", () => {
    const big = task({ id: "big", estimate_minutes: 300 });
    const out = scheduleDay({ date: "2026-11-02", zone, now: morning, availability: weekdays, events: [], routines: [], tasks: [big], keptBlocks: [] });
    const scheduled = out.blocks.reduce((s, b) => s + DateTime.fromISO(b.ends_at).diff(DateTime.fromISO(b.starts_at), "minutes").minutes, 0);
    expect(out.blocks.length).toBeGreaterThan(1);
    expect(out.blocks.every((b) => DateTime.fromISO(b.ends_at).diff(DateTime.fromISO(b.starts_at), "minutes").minutes <= 90)).toBe(true);
    expect(out.unscheduled[0].task_id).toBe("big");
    expect(scheduled + out.unscheduled[0].remaining_minutes).toBe(300);
  });

  it("never schedules into the past for today", () => {
    const now = DateTime.fromISO("2026-11-02T18:02", { zone });
    const out = scheduleDay({ date: "2026-11-02", zone, now, availability: weekdays, events: [], routines: [], tasks: [task({})], keptBlocks: [] });
    expect(DateTime.fromISO(out.blocks[0].starts_at).setZone(zone).toFormat("HH:mm")).toBe("18:05");
  });

  it("places fixed routines as fixed and flexible routines as blocks", () => {
    const fixedR: Routine = { id: "r1", workspace_id: null, goal_id: null, title: "Gym", days: [1], start_time: "18:00", duration_minutes: 60, is_fixed: true, active: true };
    const flexR: Routine = { ...fixedR, id: "r2", title: "Read", start_time: null, is_fixed: false, duration_minutes: 20 };
    const out = scheduleDay({ date: "2026-11-02", zone, now: morning, availability: weekdays, events: [], routines: [fixedR, flexR], tasks: [], keptBlocks: [] });
    expect(out.fixed.map((f) => f.title)).toContain("Gym");
    expect(out.blocks.map((b) => b.routine_id)).toEqual(["r2"]);
  });

  it("expands weekly recurring events and keeps wall-clock time across DST", () => {
    // Class at 9:00 EDT starting in October; Nov 2 2026 is after DST ends (EST).
    const ev = event({ starts_at: "2026-10-05T09:00:00-04:00", ends_at: "2026-10-05T10:00:00-04:00", recurrence: { freq: "weekly", days: [1] } });
    const iv = eventOccurrence(ev, "2026-11-02", zone)!;
    expect(iv.start!.setZone(zone).toFormat("HH:mm")).toBe("09:00");
    expect(iv.start!.toUTC().toFormat("HH:mm")).toBe("14:00");
    expect(eventOccurrence(ev, "2026-11-03", zone)).toBeNull();
  });

  it("does not schedule a parent task whose subtasks are open", () => {
    const parent = task({ id: "p", title: "Parent" });
    const child = task({ id: "c", title: "Child", parent_task_id: "p" });
    const out = scheduleDay({ date: "2026-11-02", zone, now: morning, availability: weekdays, events: [], routines: [], tasks: [parent, child], keptBlocks: [] });
    expect(out.blocks.map((b) => b.task_id)).toEqual(["c"]);
  });
});

describe("learnedEstimateRatio", () => {
  it("requires at least five samples before adjusting", () => {
    expect(learnedEstimateRatio([{ estimate_minutes: 10, actual_minutes: 20 }]).ratio).toBe(1);
  });
  it("uses the clamped median of actual/estimate", () => {
    const rows = [1.5, 1.5, 1.5, 3, 0.5].map((r) => ({ estimate_minutes: 60, actual_minutes: 60 * r }));
    expect(learnedEstimateRatio(rows).ratio).toBe(1.5);
  });
});
