import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { planMessage, planView, summarizeDayPlan, summarizeWeekPlan, type PlanLike } from "@/lib/plan-summary";
import { plainProblems } from "@/lib/plain-text";

const zone = "America/New_York";
const day = (date: string, over: Partial<PlanLike> = {}): PlanLike => ({ date, blocks: [], moved: 0, unscheduled: [], afterDeadline: [], warnings: [], ...over });

// The exact text Navi (the model) gets after planning.
describe("plan summaries (for the model)", () => {
  it("says what was planned, moved, didn't fit and only fits after it's due", () => {
    const s = summarizeDayPlan(
      day("2026-11-02", {
        blocks: [{ task_id: "a" }, { task_id: "b" }, { task_id: null }],
        moved: 1,
        unscheduled: [{ task_id: "c", title: "Essay", remaining_minutes: 45 }],
        afterDeadline: [{ task_id: "b", title: "Lab", due_at: "2026-11-02T17:00:00-05:00" }],
        warnings: ["“Lab” only fits after it's due.", "“Essay” is due today but 45 min of it doesn't fit."],
      }),
      zone,
    );
    expect(s).toBe(
      "Mon Nov 2: planned 3 things (1 moved). Didn't fit: “Essay” (45 min left). It stays on your task list. Only fits after it's due: “Lab” (due Mon 5:00 PM). “Essay” is due today but 45 min of it doesn't fit.",
    );
    expect(summarizeDayPlan(day("2026-11-02", { warnings: ["Navi doesn't know when you're free yet, so it didn't plan any work."] }), zone)).toBe(
      "Mon Nov 2: nothing new planned. Navi doesn't know when you're free yet, so it didn't plan any work.",
    );
  });

  it("sums a week, reports what never fit, and groups days with no free time", () => {
    const left = [{ task_id: "x", title: "Big project", remaining_minutes: 120 }];
    const noTime = "You have no free time set for this day, so only your fixed plans are shown.";
    const s = summarizeWeekPlan(
      [
        day("2026-11-02", { blocks: [{ task_id: "x" }], moved: 2, unscheduled: left }),
        day("2026-11-03", { blocks: [{ task_id: "x" }, { task_id: "y" }], afterDeadline: [{ task_id: "y", title: "Form", due_at: "2026-11-03T09:00:00-05:00" }] }),
        day("2026-11-07", { warnings: [noTime] }),
        day("2026-11-08", { warnings: [noTime], unscheduled: left }),
      ],
      zone,
    );
    expect(s).toBe("Mon Nov 2–Sun Nov 8: planned 3 things (2 moved). Didn't fit in these 4 days: “Big project” (120 min left). It stays on your task list. Only fits after it's due: “Form” (due Tue 9:00 AM). No free time set on Sat, Sun.");
  });
});

// What the person sees: one line, changes behind the arrow, a count of what didn't fit.
describe("plan view (for the person)", () => {
  const now = DateTime.fromISO("2026-11-08T13:47:00", { zone }); // Sunday 1:47 PM
  const titles = Array.from({ length: 18 }, (_, i) => `0${i % 9}.0${i % 7}a Spanish reading ${i} (Spanish)`);
  const overloaded = day("2026-11-08", {
    blocks: [
      { task_id: "a", title: "02.03a Heimler Video + Quiz (AP World)", starts_at: "2026-11-08T14:05:00-05:00" },
      { task_id: "b", title: "Finish LEQ paper (AP World)", starts_at: "2026-11-08T14:45:00-05:00" },
    ],
    unscheduled: titles.map((t, i) => ({ task_id: `t${i}`, title: t, remaining_minutes: 30 })),
  });

  it("is one plain line, the placed work behind the arrow, and a count of what didn't fit", () => {
    const v = planView([overloaded], zone, { now });
    expect(v.display).toBe("Planned today: 2 things");
    expect(v.detail).toEqual(["Heimler Video + Quiz at 2:05 PM", "Finish LEQ paper at 2:45 PM"]);
    expect(v.leftover!.line).toBe("18 things didn't fit today");
    expect(v.leftover!.options[0]).toMatch(/^Includes “Spanish reading 0”, “Spanish reading 1”, “Spanish reading 2” and 15 more\. They stay on your list/);
    expect(v.plan).toBe(true);
    expect(planMessage(v)).toBe("Planned today: 2 things. 18 things didn't fit today.");
  });

  it("says tonight in the evening, uses the change set's moves, and never shows ISO times or long lists", () => {
    const evening = DateTime.fromISO("2026-11-08T19:00:00", { zone });
    const v = planView([overloaded], zone, { now: evening, changes: [{ kind: "move", title: "02.03a Heimler Video + Quiz (AP World)", at: "2026-11-08T14:05:00-05:00" }] });
    expect(v.display).toBe("Planned tonight: 2 things");
    expect(v.detail).toEqual(["Heimler Video + Quiz → 2:05 PM"]);
    expect(plainProblems(v.display!)).toEqual([]);
    expect(plainProblems(v.leftover!.line)).toEqual([]);
    for (const l of [...v.detail!, ...v.leftover!.options]) expect(plainProblems(l, { detail: true })).toEqual([]);
  });

  it("an unchanged run says so; a week counts all days", () => {
    expect(planView([day("2026-11-08")], zone, { now, unchanged: true })).toMatchObject({ display: "Your plan already works; nothing changed", unchanged: true });
    const week = planView([day("2026-11-08", { blocks: [{ task_id: "a" }] }), day("2026-11-09", { blocks: [{ task_id: "b" }, { task_id: "c" }] })], zone, { now });
    expect(week.display).toBe("Planned the next 2 days: 3 things");
  });
});
