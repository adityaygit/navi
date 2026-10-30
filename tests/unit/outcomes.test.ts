import { describe, expect, it } from "vitest";
import { blockCategory, describeDisruptions, OUTCOMES, skipCategory, STOPPED_NO_REASON, withNote } from "@/lib/outcomes";

// How a recorded outcome is scored: rest, interruptions, missing information
// and bad estimates are told apart from avoidance.
describe("block outcomes", () => {
  it("reads the category the app wrote, even with a note after it", () => {
    expect(skipCategory(withNote(OUTCOMES.estimate.reason, "intro took ages"))).toBe("estimate");
    expect(skipCategory(withNote(OUTCOMES.missing_info.reason, "no rubric"))).toBe("missing_info");
    // A note that mentions being blocked doesn't turn avoidance into an excuse.
    expect(skipCategory(withNote(OUTCOMES.avoided.reason, "felt blocked"))).toBe("avoided");
    expect(skipCategory(STOPPED_NO_REASON)).toBe("avoided");
    expect(skipCategory(null)).toBe("avoided");
  });

  it("still understands older free-text reasons", () => {
    expect(skipCategory("Blocked: missing the rubric")).toBe("missing_info");
    expect(skipCategory("it took longer than planned")).toBe("estimate");
  });

  it("maps statuses", () => {
    expect(blockCategory({ status: "planned", outcome_reason: null })).toBe("unmarked");
    expect(blockCategory({ status: "in_progress", outcome_reason: null })).toBe("unmarked");
    expect(blockCategory({ status: "interrupted", outcome_reason: "anything" })).toBe("interrupted");
    expect(blockCategory({ status: "skipped", outcome_reason: OUTCOMES.estimate.reason })).toBe("estimate");
  });

  it("keeps notes short and describes disruptions", () => {
    expect(withNote("Chose to rest", "  ")).toBe("Chose to rest");
    expect(withNote("Chose to rest", "x".repeat(400))).toHaveLength(300);
    expect(describeDisruptions({ interruption: 2, estimate: 1, rest: 0 })).toBe("2 interruption, 1 took longer than estimated");
  });
});
