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
  return scheduleDayV2({ date: MON, zone, now: morning, model: m, events: [], overrides: [], routines: [], tasks, keptBlocks: [], loadCap: 1, policy: "commands", ...over });
}

const mine = [
  task({ id: "navi-work", title: "Navi work block", estimate_minutes: 60, commitment: "must" }),
  task({ id: "ela", title: "ELA PowerPoint", estimate_minutes: 45 }),
  task({ id: "chem", title: "Chemistry pamphlet", estimate_minutes: 45 }),
];

describe("R3: old Canvas work no longer crowds out the work the person chose", () => {
  it("the person's focus and must-do tasks are placed before overdue imported backlog", () => {
    const out = plan([...canvasBacklog(morning), ...mine], { focusTaskIds: ["ela", "chem"] });
    const placed = new Set(out.blocks.map((b) => b.task_id));
    expect(placed.has("navi-work")).toBe(true);
    expect(placed.has("ela")).toBe(true);
    expect(placed.has("chem")).toBe(true);
  });
});

describe("R7: what didn't fit counts today's work, not the whole backlog", () => {
  it("what didn't fit today counts today's work, not every open imported assignment", () => {
    const out = plan([...canvasBacklog(morning), ...mine], { focusTaskIds: ["ela", "chem"] });
    const view = planView([{ ...out, date: MON, moved: 0 }], zone, { now: morning });
    // At most the person's own three tasks can be "didn't fit today"; 57 imported items are not.
    expect(view.leftover?.line ?? "").not.toMatch(/\b([4-9]\d|\d{3,}) things didn't fit/);
  });
});

describe("R11: a duration the person stated isn't scaled by the learned ratio", () => {
  it("30 minutes the person said stays 30 minutes", () => {
    const ela = task({ id: "ela", title: "ELA presentation", estimate_minutes: 30, estimate_source: "user" } as Partial<Task>);
    const out = plan([ela], { estimateRatio: 1.5 });
    expect(out.blocks.filter((b) => b.task_id === "ela").reduce((s, b) => s + mins(b), 0)).toBe(30);
  });
});

describe("R2 / no false success", () => {
  it("a run that changed nothing while work still doesn't fit never says the plan already works", () => {
    const out = plan([task({ id: "big", title: "Navi work block", estimate_minutes: 600, commitment: "must" })]);
    const view = planView([{ ...out, date: MON, moved: 0 }], zone, { now: morning, unchanged: true });
    expect(view.display).not.toMatch(/already works/i);
  });
});

describe("planner commands policy (pure)", () => {
  it("before the fix (policy v2) the overdue backlog still wins: the switch keeps old accounts unchanged", () => {
    const out = plan([...canvasBacklog(morning), ...mine], { focusTaskIds: ["ela", "chem"], policy: "v2" });
    expect(out.blocks.some((b) => b.task_id === "ela")).toBe(false);
    expect(out.triage).toEqual([]);
  });

  it("overdue imported work waits for a decision (triage), keeping its deadline and identity; nothing is dropped", () => {
    const backlog = canvasBacklog(morning);
    const out = plan([...backlog, ...mine]);
    expect(out.triage).toHaveLength(40);
    expect(out.triage[0]).toEqual(expect.objectContaining({ task_id: "canvas-old-0", due_at: backlog[0].due_at }));
    expect(out.blocks.some((b) => b.task_id?.startsWith("canvas-old"))).toBe(false);
    // Future imported work isn't "didn't fit": it waits for later days.
    expect(out.unscheduled.filter((u) => u.task_id.startsWith("canvas-new")).every((u) => u.bucket === "later")).toBe(true);
  });

  it("work the person chose keeps its priority even when it's overdue (imported or not)", () => {
    const late = task({ id: "late-canvas", title: "Late Canvas essay", source: "external", due_is_hard: true, due_at: morning.minus({ days: 3 }).toISO()!, estimate_minutes: 60 });
    const out = plan([...canvasBacklog(morning), late, ...mine], { scope: { only: [], include: ["late-canvas"], exclude: [] } });
    expect(out.blocks.some((b) => b.task_id === "late-canvas")).toBe(true);
    expect(out.blocks[0].task_id).toBe("late-canvas");
    expect(out.triage.some((t) => t.task_id === "late-canvas")).toBe(false);
  });

  it("focus and chosen work go first, then must-do, then upcoming hard deadlines", () => {
    const hard = task({ id: "hard", title: "Lab report", due_is_hard: true, due_at: morning.plus({ days: 2 }).toISO()!, estimate_minutes: 30 });
    const out = plan([hard, ...mine], { focusTaskIds: ["chem"] });
    const order = out.blocks.map((b) => b.task_id);
    expect(order.indexOf("chem")).toBeLessThan(order.indexOf("navi-work"));
    expect(order.indexOf("navi-work")).toBeLessThan(order.indexOf("hard"));
  });

  it("scope 'only': nothing else is planned automatically; 'exclude' keeps a task off the day", () => {
    const algebra = task({ id: "algebra", title: "Algebra Unit 4 Quiz", due_is_hard: true, due_at: morning.plus({ days: 1 }).toISO()! });
    const only = plan([...mine, algebra], { scope: { only: ["ela", "chem"], include: [], exclude: [] } });
    expect(new Set(only.blocks.map((b) => b.task_id))).toEqual(new Set(["ela", "chem"]));
    expect(only.outOfScope.map((o) => o.task_id).sort()).toEqual(["algebra", "navi-work"]);
    const excl = plan([...mine, algebra], { scope: { only: [], include: [], exclude: ["algebra"] } });
    expect(excl.blocks.some((b) => b.task_id === "algebra")).toBe(false);
    expect(excl.unscheduled.some((u) => u.task_id === "algebra")).toBe(false);
  });

  it("R12: a real shortfall is reported, durations are never shrunk, must-do work is placed first", () => {
    const tasks = [
      task({ id: "m1", title: "Must A", commitment: "must", estimate_minutes: 150, estimate_source: "user" } as Partial<Task>),
      task({ id: "m2", title: "Must B", commitment: "must", estimate_minutes: 150, estimate_source: "user" } as Partial<Task>),
      task({ id: "n1", title: "Other", estimate_minutes: 300, estimate_source: "user" } as Partial<Task>),
    ];
    const out = plan(tasks); // 6 hours free (3–9 PM), 10 hours of work
    const placed = (id: string) => out.blocks.filter((b) => b.task_id === id).reduce((s, b) => s + mins(b), 0);
    expect(placed("m1")).toBe(150);
    expect(placed("m2")).toBe(150);
    const short = out.unscheduled.find((u) => u.task_id === "n1")!;
    expect(placed("n1") + short.remaining_minutes).toBe(300);
    const view = planView([{ ...out, date: MON, moved: 0 }], zone, { now: morning });
    // "Other" has no deadline and wasn't chosen: it waits for another day; it isn't a failure to fit.
    expect(short.bucket).toBe("later");
    expect(view.leftover?.line).toMatch(/1 thing waits for another day/);
  });
});

describe("imported work that isn't due soon doesn't outrank the person's own work (policy commands)", () => {
  it("an assignment due in 3 weeks waits behind an undated task of the person's", () => {
    const own = task({ id: "own", title: "Own project", estimate_minutes: 60 });
    const far = task({ id: "far", title: "Canvas far", source: "external", due_is_hard: true, due_at: morning.plus({ days: 21 }).toISO()!, estimate_minutes: 60 });
    const out = plan([far, own]);
    expect(out.blocks[0].task_id).toBe("own");
    const old = plan([far, own], { policy: "v2" });
    expect(old.blocks[0].task_id).toBe("far");
  });
});
