import { describe, expect, it } from "vitest";
import { breakThroughs } from "@/lib/focus";

const MIN = 60000;
const now = Date.parse("2026-11-07T14:00:00Z");
const dayStart = Date.parse("2026-11-07T00:00:00Z");
const dayEnd = Date.parse("2026-11-07T23:59:59Z");

describe("focus break-through rule", () => {
  it("lets through a fixed event starting within 10 minutes, not later ones or past ones", () => {
    const events = [
      { id: "a", title: "Shift at the café", startMs: now + 8 * MIN },
      { id: "b", title: "Dinner", startMs: now + 11 * MIN },
      { id: "c", title: "Class", startMs: now - 5 * MIN },
    ];
    expect(breakThroughs(now, events, [], dayStart, dayEnd).map((b) => b.id)).toEqual(["a"]);
  });

  it("lets through hard deadlines due today only", () => {
    const deadlines = [
      { id: "t1", title: "Essay", dueMs: now + 3 * 60 * MIN },
      { id: "t2", title: "Form", dueMs: dayEnd + 60 * MIN },
      { id: "t3", title: "Earlier today", dueMs: now - 60 * MIN },
    ];
    expect(breakThroughs(now, [], deadlines, dayStart, dayEnd).map((b) => b.id)).toEqual(["t3", "t1"]);
  });

  it("is empty when nothing qualifies", () => {
    expect(breakThroughs(now, [], [], dayStart, dayEnd)).toEqual([]);
  });
});
