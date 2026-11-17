import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { scheduleDay } from "@/server/planner/scheduler";
import { awaitingTriage, isFeedOwned, isImported, provenanceRef } from "@/lib/triage";
import type { Task } from "@/lib/types";

// Reliability repair 2026-11-16: overdue imported work is triaged (every
// policy), and overdue work is never described as "due today".

const zone = "America/New_York";
const task = (over: Partial<Task>): Task => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  workspace_id: null, project_id: null, goal_id: null, milestone_id: null, parent_task_id: null,
  title: "Task", notes: null, status: "todo", priority: 3, due_at: null, due_is_hard: false,
  estimate_minutes: 30, actual_minutes: 0, recurrence: null, blocker: null, source: "user",
  completed_at: null, created_at: "", updated_at: "", ...over,
});
const evening = [{ days: [0, 1, 2, 3, 4, 5, 6], start: "18:00", end: "18:40" }];
const now = DateTime.fromISO("2026-11-16T15:00", { zone }); // Monday

describe("triage rule", () => {
  const base = { status: "todo", source: "external", external_ref: "ext:x", due_at: "2026-10-21T03:59:00Z" };
  it("holds open, overdue imported work; not the person's own work, not future, not finished, not chosen", () => {
    const t = now.toMillis();
    expect(awaitingTriage(base, t)).toBe(true);
    expect(awaitingTriage({ ...base, source: "user", external_ref: null }, t)).toBe(false);
    expect(awaitingTriage({ ...base, due_at: "2026-11-20T04:59:00Z" }, t)).toBe(false);
    expect(awaitingTriage({ ...base, status: "done" }, t)).toBe(false);
    expect(awaitingTriage(base, t, true)).toBe(false);
    expect(awaitingTriage({ ...base, commitment: "must" }, t)).toBe(false);
  });
  it("keeps provenance after a disconnect but only live links are feed-owned", () => {
    expect(provenanceRef("canvas", "School.Instructure.com", "event-assignment-1")).toBe("was:canvas:school.instructure.com:event-assignment-1");
    expect(isFeedOwned("ext:abc")).toBe(true);
    expect(isFeedOwned("was:canvas:h:x")).toBe(false);
    expect(isImported({ source: "external", external_ref: "was:canvas:h:x" })).toBe(true);
  });
});

describe("v1 scheduler (planner v2 off)", () => {
  it("doesn't fill the evening with old Canvas items: they wait for a decision, the person's work is planned", () => {
    const old = Array.from({ length: 30 }, (_, i) => task({ id: `old-${i}`, title: `Old ${i} [Chem]`, source: "external", external_ref: `ext:${i}`, due_at: now.minus({ days: 3 + i }).toISO()!, due_is_hard: true, priority: 2 }));
    const mine = task({ id: "mine", title: "PBL Major", priority: 3 });
    const out = scheduleDay({ date: "2026-11-16", zone, now, availability: evening, events: [], routines: [], tasks: [...old, mine], keptBlocks: [] });
    expect(out.blocks.map((b) => b.task_id)).toEqual(["mine"]);
    expect(out.triage).toHaveLength(30);
    expect(out.unscheduled).toHaveLength(0);
    expect(out.warnings.join(" ")).not.toMatch(/due today/);
  });

  it("an overdue task of the person's own that doesn't fit says when it was due, not 'due today'", () => {
    const a = task({ id: "a", title: "Late essay", due_at: "2026-10-21T03:59:00Z", priority: 1, estimate_minutes: 30 });
    const b = task({ id: "b", title: "Old worksheet", due_at: "2026-10-28T03:59:00Z", priority: 1, estimate_minutes: 30 });
    const out = scheduleDay({ date: "2026-11-16", zone, now, availability: evening, events: [], routines: [], tasks: [a, b], keptBlocks: [] });
    expect(out.warnings).toContain("“Old worksheet” was due Tue Oct 27 (overdue) but 30 min of it doesn't fit.");
  });

  it("work placed on a later day isn't booked again today", () => {
    const test = task({ id: "test", title: "Los Deportes test", due_at: "2026-11-16T23:59:00-05:00", estimate_minutes: 30 });
    const out = scheduleDay({ date: "2026-11-16", zone, now, availability: evening, events: [], routines: [], tasks: [test], keptBlocks: [], alreadyScheduledMinutes: { test: 30 } });
    expect(out.blocks).toHaveLength(0);
  });
});
