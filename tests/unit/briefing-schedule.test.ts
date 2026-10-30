import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { dueBriefings } from "@/server/jobs/tick";
import type { Profile } from "@/lib/types";

// Times are stored by Postgres as "HH:MM:SS".
const profile = (over: Partial<Profile> = {}) =>
  ({ timezone: "America/New_York", briefings_enabled: true, morning_briefing_time: "06:00:00", evening_review_time: "21:00:00", weekly_review_day: 0, ...over }) as Profile;
const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
const kinds = (p: Profile, iso: string) => dueBriefings(p, at(iso)).map((b) => `${b.kind}:${b.date}`);

describe("briefing schedule", () => {
  it("fires at 06:00 local on the day clocks fall back (06:00 EST = 11:00 UTC)", () => {
    expect(kinds(profile(), "2026-11-01T10:59:00Z")).toEqual([]);
    expect(kinds(profile(), "2026-11-01T11:00:00Z")).toEqual(["morning:2026-11-01"]);
  });

  it("fires at 06:00 local on the day clocks spring forward (06:00 EDT = 10:00 UTC)", () => {
    expect(kinds(profile(), "2027-03-14T09:55:00Z")).toEqual([]);
    expect(kinds(profile(), "2027-03-14T10:05:00Z")).toEqual(["morning:2027-03-14"]);
  });

  it("handles half-hour offset zones", () => {
    const p = profile({ timezone: "Asia/Kolkata" });
    expect(kinds(p, "2026-10-30T00:29:00Z")).toEqual([]);
    expect(kinds(p, "2026-10-30T00:30:00Z")).toEqual(["morning:2026-10-30"]);
  });

  it("catches up after downtime for 3 hours, then gives up instead of a late 'morning' briefing", () => {
    expect(kinds(profile(), "2026-10-30T12:59:00Z")).toEqual(["morning:2026-10-30"]); // 08:59 EDT
    expect(kinds(profile(), "2026-10-30T13:00:00Z")).toEqual([]); // 09:00 EDT
  });

  it("adds the weekly review to the evening review on the chosen day", () => {
    // Sunday 2026-11-01 21:00 EST = 02:00 UTC Monday.
    expect(kinds(profile(), "2026-11-02T02:00:00Z")).toEqual(["evening:2026-11-01", "weekly:2026-11-01"]);
    expect(kinds(profile({ weekly_review_day: 5 }), "2026-11-02T02:00:00Z")).toEqual(["evening:2026-11-01"]);
  });

  it("respects custom times and turning briefings off", () => {
    expect(kinds(profile({ morning_briefing_time: "07:30:00" }), "2026-10-30T11:29:00Z")).toEqual([]);
    expect(kinds(profile({ morning_briefing_time: "07:30:00" }), "2026-10-30T11:30:00Z")).toEqual(["morning:2026-10-30"]);
    expect(kinds(profile({ briefings_enabled: false }), "2026-11-01T11:00:00Z")).toEqual([]);
  });
});
