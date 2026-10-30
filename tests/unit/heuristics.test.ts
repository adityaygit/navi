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

describe("goals, projects and routines", () => {
  it("finds goals but leaves dated to-dos as tasks", async () => {
    const { extractGoals } = await import("@/server/ai/heuristics");
    expect(extractGoals("My goal is to get an A in chemistry. I want to finish the essay by friday.")).toEqual([
      { title: "Get an A in chemistry", excerpt: "My goal is to get an A in chemistry" },
    ]);
  });

  it("finds named projects but not areas of life", async () => {
    const { extractProjects } = await import("@/server/ai/heuristics");
    expect(extractProjects("I'm in school and work on a startup. I'm working on an app called Tally and building a robot for the science fair.").map((p) => p.name)).toEqual([
      "Tally",
      "Robot for the science fair",
    ]);
  });

  it("finds routines with an optional time", async () => {
    const { extractRoutines } = await import("@/server/ai/heuristics");
    expect(extractRoutines("I go to the gym every morning at 7. I read every night.")).toEqual([
      { title: "Go to the gym", days: [0, 1, 2, 3, 4, 5, 6], start_time: "07:00", excerpt: "I go to the gym every morning at 7" },
      { title: "Read", days: [0, 1, 2, 3, 4, 5, 6], start_time: null, excerpt: "I read every night" },
    ]);
  });
});
