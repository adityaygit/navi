import { describe, expect, it } from "vitest";
import { summarizeDayPlan, summarizeWeekPlan, type PlanLike } from "@/lib/plan-summary";

const zone = "America/New_York";
const day = (date: string, over: Partial<PlanLike> = {}): PlanLike => ({ date, blocks: [], moved: 0, unscheduled: [], afterDeadline: [], warnings: [], ...over });

// What the person sees after pressing a planning button.
describe("plan summaries", () => {
  it("says what was placed, moved, didn't fit and only fits after the deadline", () => {
    const s = summarizeDayPlan(
      day("2026-11-02", {
        blocks: [{ task_id: "a" }, { task_id: "b" }, { task_id: null }],
        moved: 1,
        unscheduled: [{ task_id: "c", title: "Essay", remaining_minutes: 45 }],
        afterDeadline: [{ task_id: "b", title: "Lab", due_at: "2026-11-02T17:00:00-05:00" }],
        warnings: ["“Lab” can only be scheduled after its deadline.", "“Essay” is due by today but 45 min of work doesn't fit. Consider the recovery options."],
      }),
      zone,
    );
    expect(s).toBe(
      "Mon Nov 2: placed 3 blocks (1 moved). Didn't fit: “Essay” (45 min left). It stays on your task list. Only fits after its deadline: “Lab” (due Mon 5:00 PM). “Essay” is due by today but 45 min of work doesn't fit. Consider the recovery options.",
    );
    expect(summarizeDayPlan(day("2026-11-02", { warnings: ["No availability is set, so Navi didn't schedule flexible work."] }), zone)).toBe(
      "Mon Nov 2: no flexible blocks placed. No availability is set, so Navi didn't schedule flexible work.",
    );
  });

  it("sums a week, reports what never fit, and groups days without availability", () => {
    const left = [{ task_id: "x", title: "Big project", remaining_minutes: 120 }];
    const s = summarizeWeekPlan(
      [
        day("2026-11-02", { blocks: [{ task_id: "x" }], moved: 2, unscheduled: left }),
        day("2026-11-03", { blocks: [{ task_id: "x" }, { task_id: "y" }], afterDeadline: [{ task_id: "y", title: "Form", due_at: "2026-11-03T09:00:00-05:00" }] }),
        day("2026-11-07", { warnings: ["You have no availability on this day, so only fixed commitments are shown."] }),
        day("2026-11-08", { warnings: ["You have no availability on this day, so only fixed commitments are shown."], unscheduled: left }),
      ],
      zone,
    );
    expect(s).toBe("Mon Nov 2–Sun Nov 8: placed 3 blocks (2 moved). Didn't fit in these 4 days: “Big project” (120 min left). It stays on your task list. Only fits after its deadline: “Form” (due Tue 9:00 AM). No availability on Sat, Sun.");
  });
});
