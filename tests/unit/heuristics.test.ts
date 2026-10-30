import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { extractAvailability, extractItems, extractWeeklyCommitments, parseDue } from "@/server/ai/heuristics";

const now = DateTime.fromISO("2026-10-30T10:00", { zone: "America/New_York" }); // Friday

describe("rule-based extraction", () => {
  it("splits a brain dump into separate items with due dates", () => {
    const items = extractItems("need to buy running shoes tomorrow. call grandma on sunday", now);
    expect(items.map((i) => i.title)).toEqual(["Buy running shoes", "Call grandma"]);
    expect(items[0].due_at).toMatch(/^2026-10-31T23:59/);
    expect(items[1].due_at).toMatch(/^2026-11-01T23:59/);
  });

  it("parses explicit times", () => {
    expect(parseDue("submit form by 5pm tomorrow", now)?.iso).toMatch(/^2026-10-31T17:00/);
    expect(parseDue("dentist monday at 9am", now)?.iso).toMatch(/^2026-11-02T09:00/);
  });

  it("finds weekly commitments with days and times", () => {
    const c = extractWeeklyCommitments("I have soccer practice mon and wed at 4pm. Classes weekdays at 8am.");
    expect(c[0]).toMatchObject({ title: "Soccer practice", days: [1, 3], hour: 16, minute: 0 });
    expect(c.find((x) => x.title === "Classes")).toMatchObject({ days: [1, 2, 3, 4, 5], hour: 8 });
  });

  it("reads availability windows", () => {
    expect(extractAvailability("I'm free after 6pm on weekdays")).toEqual([{ days: [1, 2, 3, 4, 5], start: "18:00", end: "21:00" }]);
    expect(extractAvailability("free from 9am to 1pm on weekends")[0]).toEqual({ days: [0, 6], start: "09:00", end: "13:00" });
    expect(extractAvailability("I'm free after 6pm on weekdays and free from 10am to 2pm on weekends. Quiet 10pm to 7am.")).toEqual([
      { days: [1, 2, 3, 4, 5], start: "18:00", end: "21:00" },
      { days: [0, 6], start: "10:00", end: "14:00" },
    ]);
  });

  it("keeps unclassifiable text as a note rather than dropping it", () => {
    expect(extractItems("the sunset was nice", now)[0].kind).toBe("note");
  });
});
