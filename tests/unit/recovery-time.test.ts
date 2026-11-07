import { describe, expect, it } from "vitest";
import { readRecoveryTime } from "@/server/planner/plan";

// "My plan broke" times are the person's clock, in their profile timezone —
// not the browser's or the server's.
describe("readRecoveryTime", () => {
  it("reads a typed clock time as today in the profile timezone", () => {
    const d = readRecoveryTime("14:30", "Asia/Kolkata", "2026-11-06")!;
    expect(d.toISO()).toBe("2026-11-06T14:30:00.000+05:30");
    expect(readRecoveryTime("9:05", "America/New_York", "2026-11-06")!.toISO()).toBe("2026-11-06T09:05:00.000-05:00");
  });

  it("keeps an explicit offset and reads an offset-less date-time in the profile zone", () => {
    expect(readRecoveryTime("2026-11-06T10:00:00Z", "America/New_York", "2026-11-06")!.toISO()).toBe("2026-11-06T05:00:00.000-05:00");
    expect(readRecoveryTime("2026-11-06T10:00", "Europe/Berlin", "2026-11-06")!.toISO()).toBe("2026-11-06T10:00:00.000+01:00");
  });

  it("ignores empty or invalid input", () => {
    expect(readRecoveryTime("", "UTC", "2026-11-06")).toBeNull();
    expect(readRecoveryTime(null, "UTC", "2026-11-06")).toBeNull();
    expect(readRecoveryTime("25:99", "UTC", "2026-11-06")).toBeNull();
    expect(readRecoveryTime("soon", "UTC", "2026-11-06")).toBeNull();
  });
});
