import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { contextFor, fixWeekdayNumbering, guardInventedTimes as guard, mentionsTimeOfDay, type GuardedItem } from "@/server/ai/time-guard";

const zone = "America/New_York";
const friday = DateTime.fromISO("2026-10-30T10:00", { zone }); // a Friday
const guardInventedTimes = (items: GuardedItem[], opts: Parameters<typeof guard>[1]) => guard(items, opts);
const local = (iso: unknown) => DateTime.fromISO(String(iso)).setZone(zone).toFormat("ccc yyyy-LL-dd HH:mm");

describe("mentionsTimeOfDay", () => {
  it("finds clock times and named parts of the day", () => {
    for (const t of ["dentist at 3", "call at 4:30", "by 5pm", "friday evening", "tonight", "before school", "in 2 hours", "at noon", "7am gym"]) {
      expect(mentionsTimeOfDay(t), t).toBe(true);
    }
  });
  it("doesn't treat a day or a duration as a time of day", () => {
    for (const t of ["call mom on friday", "essay due monday", "study for 30 minutes on sunday", "buy 3 eggs"]) {
      expect(mentionsTimeOfDay(t), t).toBe(false);
    }
  });
});

describe("contextFor", () => {
  it("widens an excerpt to its sentence so a nearby time still counts", () => {
    expect(contextFor("Buy milk. Call mom on friday at 3pm. Gym", "call mom on friday")).toBe(" Call mom on friday at 3pm");
    expect(contextFor("whatever", "not in there")).toBe("whatever");
  });
});

describe("guardInventedTimes", () => {
  it("moves an invented due time on a task to the end of that day and says so", () => {
    const [out] = guardInventedTimes(
      [{ kind: "task", payload: { title: "Call mom", due_at: "2026-10-30T18:00:00-04:00" }, source_excerpt: "call mom on friday", rationale: "Stated" }],
      { sourceText: "call mom on friday", zone, now: friday },
    );
    expect(local(out.payload.due_at)).toBe("Fri 2026-10-30 23:59");
    expect(out.payload.due_is_hard).toBe(false);
    expect(out.rationale).toMatch(/No time of day was given/);
    // Said on a Friday: the assumption is spelled out.
    expect(out.rationale).toMatch(/Today is Friday, so “Friday” was read as today; edit it if you meant next Friday \(Nov 6\)/);
  });

  it("turns a one-off event with an invented time into a task due that day", () => {
    const [out] = guardInventedTimes(
      [{ kind: "event", payload: { title: "Dentist", starts_at: "2026-11-02T18:00:00-05:00", ends_at: "2026-11-02T19:00:00-05:00", location: "Main St" }, source_excerpt: "dentist monday", rationale: null }],
      { sourceText: "dentist monday", zone, now: friday },
    );
    expect(out.kind).toBe("task");
    expect(out.payload).toMatchObject({ title: "Dentist", due_is_hard: false, notes: "Location: Main St" });
    expect(out.payload.starts_at).toBeUndefined();
    expect(local(out.payload.due_at)).toBe("Mon 2026-11-02 23:59");
    expect(out.rationale).toMatch(/task due Monday Nov 2 rather than an event at 6:00 PM/);
  });

  it("keeps times the user actually said", () => {
    const items = [
      { kind: "event", payload: { title: "Dentist", starts_at: "2026-11-02T15:00:00-05:00", ends_at: "2026-11-02T16:00:00-05:00" }, source_excerpt: "dentist monday", rationale: null },
      { kind: "task", payload: { title: "Submit form", due_at: "2026-11-03T17:00:00-05:00" }, source_excerpt: "submit form tuesday by 5pm", rationale: null },
      { kind: "task", payload: { title: "Essay", due_at: "2026-11-04T23:59:00-05:00" }, source_excerpt: "essay wednesday", rationale: null },
    ];
    const out = guardInventedTimes(items, { sourceText: "Dentist monday at 3. Submit form tuesday by 5pm. Essay wednesday", zone, now: friday });
    expect(out).toEqual(items);
  });

  it("keeps weekly commitments as events (only the time is in question there)", () => {
    const item = { kind: "event", payload: { title: "Soccer", starts_at: "2026-11-02T16:00:00-05:00", ends_at: "2026-11-02T17:00:00-05:00", recurrence: { freq: "weekly", days: [1] } }, source_excerpt: "soccer mondays", rationale: null };
    expect(guardInventedTimes([item], { sourceText: "soccer mondays", zone, now: friday })[0].kind).toBe("event");
  });

  it("notes the assumption when a same-named weekday was read as next week", () => {
    const [out] = guardInventedTimes(
      [{ kind: "task", payload: { title: "Call mom", due_at: "2026-11-06T23:59:00-05:00" }, source_excerpt: "call mom on friday", rationale: null }],
      { sourceText: "call mom on friday", zone, now: friday },
    );
    expect(out.rationale).toMatch(/read as next Friday, Nov 6; edit it if you meant today \(Oct 30\)/);
  });

  it("doesn't repeat the assumption when the model already stated it", () => {
    const rationale = "'Friday' was said on a Friday, so I assumed next Friday, Nov 6.";
    const [out] = guardInventedTimes(
      [{ kind: "task", payload: { title: "Call mom", due_at: "2026-11-06T23:59:00-05:00" }, source_excerpt: "call mom on friday", rationale }],
      { sourceText: "call mom on friday", zone, now: friday },
    );
    expect(out.rationale).toBe(rationale);
  });
});

describe("fixWeekdayNumbering", () => {
  // What Gemini Live proposed for "a coffee shop every Saturday", "chemistry lab
  // every Tuesday" and "free on weekday evenings" (Monday counted as 0).
  const geminiBatch: GuardedItem[] = [
    { kind: "event", payload: { title: "Coffee shop", starts_at: "2026-11-07T08:00:00-05:00", ends_at: "2026-11-07T14:00:00-05:00", recurrence: { freq: "weekly", days: [5] } } },
    { kind: "event", payload: { title: "Chemistry lab", starts_at: "2026-11-03T13:00:00-05:00", ends_at: "2026-11-03T15:00:00-05:00", recurrence: { freq: "weekly", days: [1] } } },
    { kind: "routine", payload: { title: "Run", days: [6], duration_minutes: 30 } },
    { kind: "preference", payload: { availability: [{ days: [0, 1, 2, 3, 4], start: "19:00", end: "22:00" }] } },
    { kind: "workspace", payload: { name: "College" } },
  ];

  it("shifts every day list in a batch whose weekly events are all one day off", () => {
    const out = fixWeekdayNumbering(geminiBatch, zone);
    expect((out[0].payload.recurrence as { days: number[] }).days).toEqual([6]);
    expect((out[1].payload.recurrence as { days: number[] }).days).toEqual([2]);
    expect(out[2].payload.days).toEqual([0]); // Sunday, wrapped around
    expect((out[3].payload.availability as { days: number[] }[])[0].days).toEqual([1, 2, 3, 4, 5]);
    expect(out[0].rationale).toMatch(/Weekday numbers were off by one/);
    expect(out[4]).toBe(geminiBatch[4]);
  });

  it("leaves a batch alone when the events' days match their dates, or there's no event to tell", () => {
    const right: GuardedItem[] = [
      { kind: "event", payload: { title: "Coffee shop", starts_at: "2026-11-07T08:00:00-05:00", ends_at: "2026-11-07T14:00:00-05:00", recurrence: { freq: "weekly", days: [6] } } },
      { kind: "preference", payload: { availability: [{ days: [1, 2, 3, 4, 5], start: "19:00", end: "22:00" }] } },
    ];
    expect(fixWeekdayNumbering(right, zone)).toEqual(right);
    const noEvents = geminiBatch.slice(2);
    expect(fixWeekdayNumbering(noEvents, zone)).toEqual(noEvents);
  });
});
