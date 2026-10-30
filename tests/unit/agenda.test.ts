import { describe, expect, it } from "vitest";
import { buildDayAgenda, describeDayAgenda } from "@/server/planner/agenda";
import type { CalendarEvent, PlanBlock, Routine, Task } from "@/lib/types";

// The day view shared by the planner UI, Today and the AI's get_plan tool.

const zone = "America/New_York";
const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e1", workspace_id: null, title: "Event", starts_at: "2026-10-31T10:00:00-04:00", ends_at: "2026-10-31T11:00:00-04:00",
  recurrence: null, location: null, notes: null, source: "user", external_ref: null, status: "confirmed", ...over,
});
const routine = (over: Partial<Routine>): Routine => ({
  id: "r1", workspace_id: null, goal_id: null, title: "Routine", days: [6], start_time: "07:00:00", duration_minutes: 30, is_fixed: false, active: true, ...over,
});
const block = (over: Partial<PlanBlock>): PlanBlock => ({
  id: "b1", task_id: null, routine_id: null, title: "Block", plan_date: "2026-10-31", starts_at: "2026-10-31T14:00:00-04:00", ends_at: "2026-10-31T15:00:00-04:00",
  is_flexible: true, status: "planned", outcome_reason: null, created_by: "navi", reason: null, ...over,
});
const task = (over: Partial<Task>): Task => ({
  id: "t1", workspace_id: null, project_id: null, goal_id: null, milestone_id: null, parent_task_id: null, title: "Task", notes: null, status: "todo",
  priority: 3, due_at: null, due_is_hard: false, estimate_minutes: null, actual_minutes: 0, recurrence: null, blocker: null, source: "user",
  completed_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over,
});

describe("day agenda", () => {
  it("includes weekly events stored weeks earlier, routines that day, plan blocks and tasks due that day", () => {
    const a = buildDayAgenda({
      date: "2026-10-31", // Saturday
      zone,
      events: [
        // First occurrence was a month ago (in daylight time); it still repeats on Saturdays.
        event({ id: "e-weekly", title: "Piano lesson", starts_at: "2026-10-03T09:00:00-04:00", ends_at: "2026-10-03T10:00:00-04:00", recurrence: { freq: "weekly", days: [6] } }),
        event({ id: "e-other-day", title: "Dentist", starts_at: "2026-11-02T09:00:00-05:00", ends_at: "2026-11-02T10:00:00-05:00" }),
      ],
      routines: [routine({ id: "r-sat", title: "Run" }), routine({ id: "r-weekday", title: "Commute", days: [1, 2, 3, 4, 5] })],
      blocks: [block({ id: "b-sat", title: "Call mom" }), block({ id: "b-sun", title: "Laundry", plan_date: "2026-11-01" })],
      tasks: [
        task({ id: "t-due", title: "Return library books", due_at: "2026-10-31T23:59:00-04:00" }),
        task({ id: "t-done", title: "Already done", status: "done", due_at: "2026-10-31T12:00:00-04:00" }),
        task({ id: "t-later", title: "Later", due_at: "2026-11-01T12:00:00-05:00" }),
      ],
    });
    expect(a.entries.map((e) => e.title)).toEqual(["Run", "Piano lesson", "Call mom"]);
    expect(a.entries.find((e) => e.title === "Piano lesson")).toMatchObject({ kind: "event", fixed: true, label: "fixed", start: "2026-10-31T09:00:00.000-04:00" });
    expect(a.due.map((t) => t.title)).toEqual(["Return library books"]);
    const text = describeDayAgenda(a, zone, "2026-10-30");
    expect(text).toContain("Saturday, Oct 31 2026 (2026-10-31, tomorrow)");
    expect(text).toContain("9:00 AM–10:00 AM Piano lesson (fixed event, weekly)");
    expect(text).toContain("2:00 PM–3:00 PM Call mom (flexible plan block, planned)");
    expect(text).toContain("Return library books (P3, todo, due 11:59 PM, soft)");
  });

  it("labels a routine fixed only when it is marked fixed", () => {
    const a = buildDayAgenda({
      date: "2026-10-31",
      zone,
      events: [],
      routines: [routine({ id: "flex", title: "Reading", is_fixed: false }), routine({ id: "fix", title: "Practice", start_time: "16:00", is_fixed: true }), routine({ id: "any", title: "Stretch", start_time: null })],
      blocks: [],
      tasks: [],
    });
    expect(a.entries.map((e) => [e.title, e.label, e.fixed])).toEqual([
      ["Reading", "routine", false],
      ["Practice", "fixed", true],
      ["Stretch", "routine", false],
    ]);
    expect(describeDayAgenda(a, zone, "2026-10-31")).toMatch(/Reading \(routine, preferred time \(can move\)\)[\s\S]*any time Stretch \(routine, no set time\)/);
  });

  it("doesn't list a routine twice when it already has a block that day", () => {
    const a = buildDayAgenda({ date: "2026-10-31", zone, events: [], routines: [routine({ id: "r", title: "Run", start_time: null })], blocks: [block({ routine_id: "r", title: "Run" })], tasks: [] });
    expect(a.entries.map((e) => e.kind)).toEqual(["block"]);
  });
});
