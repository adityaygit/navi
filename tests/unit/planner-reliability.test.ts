import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { buildDayModel, type DayModelInput } from "@/server/planner/day-model";
import { scheduleDayV2, type SchedulerV2Input } from "@/server/planner/scheduler-v2";
import { planView } from "@/lib/plan-summary";
import type { Task } from "@/lib/types";

// Planner reliability overhaul (docs/navi-1.5/PLANNER_RELIABILITY.md), pure
// parts. Scenario ids R1–R14 are the regression scenarios from the planner
// audit handoff. Canvas-like backlog: imported assignments are hard
// deadlines, many already overdue (feed-sync.ts imports 30 days back).

const zone = "America/New_York";
const MON = "2026-11-02";
const at = (date: string, hm: string) => DateTime.fromISO(`${date}T${hm}`, { zone });
const morning = at(MON, "08:00");
const mins = (b: { starts_at: string; ends_at: string }) => DateTime.fromISO(b.ends_at).diff(DateTime.fromISO(b.starts_at), "minutes").minutes;

const task = (over: Partial<Task>): Task => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  workspace_id: null, project_id: null, goal_id: null, milestone_id: null, parent_task_id: null,
  title: over.id ?? "Task", notes: null, status: "todo", priority: 3, due_at: null, due_is_hard: false,
  estimate_minutes: 30, actual_minutes: 0, recurrence: null, blocker: null, source: "user",
  completed_at: null, created_at: "", updated_at: "", commitment: "normal", not_before: null, ...over,
});

/** 40 overdue imported assignments (1–30 days late) and 20 due over the next months. */
export function canvasBacklog(now: DateTime): Task[] {
  const overdue = Array.from({ length: 40 }, (_, i) =>
    task({ id: `canvas-old-${i}`, title: `Canvas overdue ${i}`, source: "external", external_ref: `ext:old${i}`, due_is_hard: true, due_at: now.minus({ days: 1 + (i % 30), hours: 2 }).toISO()!, estimate_minutes: null }),
  );
  const future = Array.from({ length: 20 }, (_, i) =>
    task({ id: `canvas-new-${i}`, title: `Canvas future ${i}`, source: "external", external_ref: `ext:new${i}`, due_is_hard: true, due_at: now.plus({ days: 10 + i * 5 }).toISO()!, estimate_minutes: null }),
  );
  return [...overdue, ...future];
}

function model(over: Partial<DayModelInput> = {}) {
  return buildDayModel({
    date: MON, zone, wakeBed: { wake: "07:00", bed: "23:00" }, usualFree: [{ days: [1], start: "15:00", end: "21:00" }], usualFreeIsDefault: false,
    rules: [], exceptions: [], events: [], overrides: [], routines: [], assumeFreeTime: false, typicalHours: [], history: [], ...over,
  });
}
function plan(tasks: Task[], over: Partial<SchedulerV2Input> = {}) {
  const m = model();
  return scheduleDayV2({ date: MON, zone, now: morning, model: m, events: [], overrides: [], routines: [], tasks, keptBlocks: [], loadCap: 1, ...over });
}

const mine = [
  task({ id: "navi-work", title: "Navi work block", estimate_minutes: 60, commitment: "must" }),
  task({ id: "ela", title: "ELA PowerPoint", estimate_minutes: 45 }),
  task({ id: "chem", title: "Chemistry pamphlet", estimate_minutes: 45 }),
];

describe("R3 (current failure): old Canvas work crowds out the work the person chose", () => {
  it.fails("the person's focus and must-do tasks are placed before overdue imported backlog", () => {
    const out = plan([...canvasBacklog(morning), ...mine], { focusTaskIds: ["ela", "chem"] });
    const placed = new Set(out.blocks.map((b) => b.task_id));
    expect(placed.has("navi-work")).toBe(true);
    expect(placed.has("ela")).toBe(true);
    expect(placed.has("chem")).toBe(true);
  });
});

describe("R7 (current failure): the 'didn't fit' count is the whole backlog", () => {
  it.fails("what didn't fit today counts today's work, not every open imported assignment", () => {
    const out = plan([...canvasBacklog(morning), ...mine], { focusTaskIds: ["ela", "chem"] });
    const view = planView([{ ...out, date: MON, moved: 0 }], zone, { now: morning });
    // At most the person's own three tasks can be "didn't fit today"; 57 imported items are not.
    expect(view.leftover?.line ?? "").not.toMatch(/\b([4-9]\d|\d{3,}) things didn't fit/);
  });
});

describe("R11 (current failure): a duration the person stated is scaled by the learned ratio", () => {
  it.fails("30 minutes the person said stays 30 minutes", () => {
    const ela = task({ id: "ela", title: "ELA presentation", estimate_minutes: 30, estimate_source: "user" } as Partial<Task>);
    const out = plan([ela], { estimateRatio: 1.5 });
    expect(out.blocks.filter((b) => b.task_id === "ela").reduce((s, b) => s + mins(b), 0)).toBe(30);
  });
});

describe("R2 / no false success (current failure)", () => {
  it.fails("a run that changed nothing while work still doesn't fit never says the plan already works", () => {
    const out = plan([task({ id: "big", title: "Navi work block", estimate_minutes: 600, commitment: "must" })]);
    const view = planView([{ ...out, date: MON, moved: 0 }], zone, { now: morning, unchanged: true });
    expect(view.display).not.toMatch(/already works/i);
  });
});
