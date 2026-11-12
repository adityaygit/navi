import { describe, expect, it } from "vitest";
import { feedSummaryText } from "@/lib/feed-summary";

describe("feed summary", () => {
  it("first import: one concise line, not a card per item", () => {
    expect(feedSummaryText({ trigger: "connect", assignments: 18, events: 6, courses: 4, created: 24, duplicates: 2 })).toBe(
      "Imported 18 assignments and 6 events from 4 courses. 2 look like tasks you already have, so they're waiting for you to decide.",
    );
    expect(feedSummaryText({ trigger: "connect", assignments: 1, events: 0, courses: 1 })).toBe("Imported 1 assignment and 0 events from 1 course.");
  });
  it("later syncs: what changed", () => {
    expect(feedSummaryText({ trigger: "schedule", assignments: 5, events: 9, courses: 4, created: 1, updated: 2, removed: 1, newCourses: ["BIOL 110"] })).toBe(
      "Canvas has 5 assignments and 9 events from 4 courses. 1 new item added, 2 changes applied, 1 removed after being deleted in Canvas. New: BIOL 110.",
    );
    expect(feedSummaryText({ trigger: "manual", assignments: 2, events: 1 })).toBe("Canvas has 2 assignments and 1 event.");
    expect(feedSummaryText(null)).toBe("");
  });
});
