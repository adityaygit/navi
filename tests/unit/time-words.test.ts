import { afterEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { nowLine, resolveClock, resolveDay, roundUp5, shiftTimes } from "@/lib/time-words";

// "Now" is worked out by code from the real clock, never guessed by the model.
// A fixed clock: Sunday Nov 8 2026, 1:47 PM in New York.
const zone = "America/New_York";
const NOW = DateTime.fromISO("2026-11-08T13:47:00", { zone });
const at = (hm: string, date = "2026-11-08") => DateTime.fromISO(`${date}T${hm}`, { zone });

afterEach(() => vi.useRealTimers());

describe("the clock line at the top of every context", () => {
  it("states the real time from the system clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW.toJSDate());
    expect(nowLine(zone)).toBe("Now: Sunday Nov 8, 1:47 PM (America/New_York).");
  });
});

describe("days and times the person says", () => {
  it("resolves weekday names to the next one (never today), tomorrow and dates", () => {
    expect(resolveDay("monday", zone, NOW)).toBe("2026-11-09");
    expect(resolveDay("Sunday", zone, NOW)).toBe("2026-11-15");
    expect(resolveDay("next fri", zone, NOW)).toBe("2026-11-13");
    expect(resolveDay("tomorrow", zone, NOW)).toBe("2026-11-09");
    expect(resolveDay("2026-12-01", zone, NOW)).toBe("2026-12-01");
    expect(resolveDay("someday", zone, NOW)).toBeNull();
  });

  it("reads 'now' from the clock (rounded up to 5 minutes) and HH:MM on the day", () => {
    expect(resolveClock("now", "2026-11-08", zone, NOW)!.toFormat("HH:mm")).toBe("13:50");
    expect(resolveClock("14:05", "2026-11-08", zone, NOW)!.toISO()).toBe(at("14:05").toISO());
    expect(resolveClock("25:00", "2026-11-08", zone, NOW)).toBeNull();
    expect(roundUp5(at("13:50")).toFormat("HH:mm")).toBe("13:50");
  });
});

describe("clearing time and pushing the plan", () => {
  const blocks = [
    { id: "heimler", start: at("13:50"), end: at("14:20") },
    { id: "leq", start: at("14:30"), end: at("15:10") },
    { id: "check", start: at("15:20"), end: at("15:40") },
    { id: "late", start: at("17:00"), end: at("17:30") },
  ];
  const dayEnd = at("23:59:59");

  it("'leave an empty space from now till 2:05': work before 2:05 starts at 2:05, later work moves only as needed", () => {
    const { moves, stuck } = shiftTimes(blocks, [], { startAt: at("14:05"), earliest: NOW, dayEnd });
    expect(stuck).toEqual([]);
    // "check" (15:20) and "late" (17:00) already start after the pushed work ends, so they stay.
    expect(moves.map((m) => [m.id, m.start.toFormat("HH:mm"), m.end.toFormat("HH:mm")])).toEqual([
      ["heimler", "14:05", "14:35"],
      ["leq", "14:35", "15:15"],
    ]);
  });

  it("'push everything 30 min' moves each one 30 minutes and steps over fixed things", () => {
    const karate = { start: at("15:30"), end: at("16:30") };
    const { moves } = shiftTimes(blocks, [karate], { minutes: 30, earliest: NOW, dayEnd });
    expect(Object.fromEntries(moves.map((m) => [m.id, m.start.toFormat("HH:mm")]))).toEqual({ heimler: "14:20", leq: "16:30", check: "17:10", late: "17:30" }); // the LEQ paper no longer fits before karate
  });

  it("never moves work into the past, and leaves work that would run past midnight where it was", () => {
    const night = [{ id: "a", start: at("23:00"), end: at("23:30") }, { id: "b", start: at("23:35"), end: at("23:50") }];
    const r = shiftTimes(night, [], { minutes: 30, earliest: NOW, dayEnd });
    expect(r.stuck.sort()).toEqual(["a", "b"]);
    expect(r.moves).toEqual([]);
    const early = shiftTimes([{ id: "x", start: at("14:00"), end: at("14:30") }], [], { minutes: -60, earliest: NOW, dayEnd });
    expect(early.moves[0].start.toFormat("HH:mm")).toBe("13:50");
  });
});
