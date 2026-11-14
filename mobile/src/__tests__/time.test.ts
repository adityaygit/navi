import { describe, expect, it } from "vitest";
import { addDays, clock, duration, range } from "../data/time";

describe("time helpers", () => {
  it("formats durations the way the timeline reads them", () => {
    expect(duration(45)).toBe("45 min");
    expect(duration(60)).toBe("1 h");
    expect(duration(90)).toBe("1½ h");
    expect(duration(75)).toBe("1 h 15 min");
    expect(duration(315)).toBe("5½ h"); // long stretches round to the half hour
    expect(duration(522)).toBe("8½ h");
    expect(duration(480)).toBe("8 h");
  });
  it("shows times in the person's zone, not the phone's", () => {
    const iso = "2026-11-13T14:00:00.000Z";
    expect(clock(iso, "UTC")).toBe("2:00");
    expect(clock(iso, "Asia/Tokyo")).toBe("11:00");
    expect(range(iso, "2026-11-13T15:30:00.000Z", "UTC")).toBe("2:00 – 3:30 PM");
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
