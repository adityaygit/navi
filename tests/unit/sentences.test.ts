import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { busiestPart, freeGaps, greeting, homeSummary, hoursText, mergeSpans, myDayHeadline, tasksHeadline, weekHeadline } from "@/lib/sentences";

const text = (line: { text: string }[]) => line.map((s) => s.text).join("");
const Z = "Europe/London";
const at = (hhmm: string) => DateTime.fromISO(`2026-11-06T${hhmm}`, { zone: Z }).toMillis();
const fmtHour = (ms: number) => {
  const d = DateTime.fromMillis(ms, { zone: Z });
  const h = d.hour % 12 || 12;
  return d.minute ? `${h}:${String(d.minute).padStart(2, "0")}` : `${h}`;
};
const mod = (ms: number) => {
  const d = DateTime.fromMillis(ms, { zone: Z });
  return d.hour * 60 + d.minute;
};

describe("sentences (V4 sources contract)", () => {
  it("formats hours in quarter steps", () => {
    expect(hoursText(570)).toBe("9½ hours");
    expect(hoursText(60)).toBe("1 hour");
    expect(hoursText(405)).toBe("6¾ hours");
    expect(hoursText(45)).toBe("45 minutes");
    expect(hoursText(75)).toBe("1¼ hours");
  });

  it("greets by local time, and drops the name when there is none", () => {
    expect(greeting("Alex", 9)).toBe("Morning, Alex.");
    expect(greeting("Alex", 14)).toBe("Afternoon, Alex.");
    expect(greeting(null, 20)).toBe("Evening.");
  });

  it("Home summary counts real tasks and names the busy part only when clear", () => {
    const four = [{ done: true }, { done: false }, { done: false }, { done: false }];
    expect(text(homeSummary(four, { morning: 60, afternoon: 300, evening: 90 }))).toBe("Four things today, one already done. Your afternoon is the busy part.");
    expect(text(homeSummary(four, { morning: 200, afternoon: 190, evening: 0 }))).toBe("Four things today, one already done.");
    expect(text(homeSummary([], { morning: 0, afternoon: 0, evening: 0 }))).toBe("Nothing on your list today.");
    expect(text(homeSummary([{ done: true }, { done: true }], { morning: 0, afternoon: 0, evening: 0 }))).toBe("Two things today, all done.");
  });

  it("busiest part needs an hour and a clear lead", () => {
    expect(busiestPart({ morning: 30, afternoon: 50, evening: 0 })).toBeNull();
    expect(busiestPart({ morning: 100, afternoon: 90, evening: 0 })).toBeNull();
    expect(busiestPart({ morning: 0, afternoon: 0, evening: 120 })).toBe("evening");
  });

  it("Tasks headline compares estimates only when every task has one", () => {
    const open = [{ title: "History essay", estimate: 90 }, { title: "Reply to Sam", estimate: 5 }, { title: "Text Maya", estimate: 10 }];
    expect(text(tasksHeadline(open, 1))).toBe("3 left. “History essay” is the big one — everything else takes under 15 minutes.");
    expect(text(tasksHeadline([...open, { title: "Book dentist", estimate: null }], 0))).toBe("4 left.");
    expect(text(tasksHeadline([], 2))).toBe("All done for today.");
    expect(text(tasksHeadline([], 0))).toBe("Nothing due today.");
  });

  it("merges spans and finds free gaps", () => {
    const merged = mergeSpans([{ start: 0, end: 10 }, { start: 5, end: 20 }, { start: 30, end: 40 }]);
    expect(merged).toEqual([{ start: 0, end: 20 }, { start: 30, end: 40 }]);
    expect(freeGaps(merged, 0, 50)).toEqual([{ start: 20, end: 30 }, { start: 40, end: 50 }]);
  });

  it("My day headline: planned, free, and where the free time sits", () => {
    const busy = [
      { start: at("08:45"), end: at("11:00") },
      { start: at("13:00"), end: at("15:30") },
      { start: at("15:30"), end: at("18:00") },
      { start: at("19:30"), end: at("21:00") },
    ];
    const awake = { start: at("07:00"), end: at("23:00") };
    const line = text(myDayHeadline(busy, awake, fmtHour, mod));
    expect(line).toBe("A full afternoon. 8¾ hours planned, 7¼ free.");
    // Without wake/bed, free time isn't counted.
    expect(text(myDayHeadline(busy, null, fmtHour, mod))).toBe("A full afternoon. 8¾ hours planned.");
    expect(text(myDayHeadline([], awake, fmtHour, mod))).toBe("Nothing planned yet.");
  });

  it("says where most of the free time is when one stretch dominates", () => {
    const busy = [{ start: at("13:00"), end: at("23:00") }];
    const awake = { start: at("07:00"), end: at("23:00") };
    expect(text(myDayHeadline([...busy, { start: at("08:00"), end: at("08:30") }], awake, fmtHour, mod))).toContain("most of it before 1");
  });

  it("week headline names the full day and the quiet one", () => {
    const days = [
      { name: "Monday", minutes: 300, titles: ["Class", "Shift"] },
      { name: "Friday", minutes: 570, titles: ["Class", "Essay", "Run", "Dinner"] },
      { name: "Saturday", minutes: 90, titles: ["Brunch with Jo"] },
    ];
    expect(text(weekHeadline(days))).toBe("Friday's the full one — 9½ hours planned. Saturday has just brunch with Jo.");
    expect(text(weekHeadline([{ name: "Monday", minutes: 100, titles: ["A"] }, { name: "Tuesday", minutes: 120, titles: ["B"] }]))).toBe("About the same every day this week.");
    expect(text(weekHeadline([{ name: "Monday", minutes: 0, titles: [] }]))).toBe("Nothing planned this week yet.");
  });
});
