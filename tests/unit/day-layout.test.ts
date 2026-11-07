import { describe, expect, it } from "vitest";
import { findFits, gridHours, hourLabel, layoutColumn, weekOf } from "@/lib/day-layout";
import { weekHeadline } from "@/lib/sentences";

const H = 3600000;
const M = 60000;

describe("day layout", () => {
  it("pairs free stretches with tasks that fit, earliest due first, one task per gap", () => {
    const gaps = [
      { start: 0, end: 30 * M }, // 30 min
      { start: 2 * H, end: 2 * H + 20 * M }, // 20 min: too short to show
      { start: 4 * H, end: 6 * H }, // 2 h
    ];
    const fits = findFits(gaps, [
      { id: "essay", title: "Essay", estimate: 90, dueMs: 5 * H },
      { id: "dentist", title: "Book the dentist", estimate: 10, dueMs: 3 * H },
      { id: "song", title: "Practise", estimate: 20, dueMs: null },
      { id: "lisbon", title: "Plan Lisbon", estimate: null, dueMs: 1 * H },
    ]);
    expect(fits.map((f) => [f.minutes, f.task?.id ?? null])).toEqual([
      [30, "dentist"],
      [120, "essay"],
    ]);
  });

  it("offers nothing when no estimate fits", () => {
    const fits = findFits([{ start: 0, end: 40 * M }], [{ id: "a", title: "A", estimate: 90, dueMs: null }]);
    expect(fits).toEqual([{ gap: { start: 0, end: 40 * M }, minutes: 40, task: null }]);
  });

  it("lays out blocks on an hour grid, side by side when they overlap", () => {
    const items = [
      { id: "a", startMs: 1 * H, endMs: 3 * H },
      { id: "b", startMs: 2 * H, endMs: 4 * H },
      { id: "c", startMs: 5 * H, endMs: 5 * H + 30 * M },
    ];
    const placed = layoutColumn(items, 0, 10 * H, 40);
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    expect(by.a).toMatchObject({ top: 40, height: 80, lane: 0, lanes: 2 });
    expect(by.b).toMatchObject({ top: 80, height: 80, lane: 1, lanes: 2 });
    expect(by.c).toMatchObject({ top: 200, height: 20, lane: 0, lanes: 1 });
  });

  it("clips items to the grid and keeps a minimum height", () => {
    const placed = layoutColumn([{ startMs: -H, endMs: 5 * M }], 0, 10 * H, 40);
    expect(placed[0]).toMatchObject({ top: 0, height: 18 });
  });

  it("finds the Monday-to-Sunday week", () => {
    expect(weekOf("2026-11-06", "Europe/London")).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(weekOf("2026-11-08", "UTC")[0]).toBe("2026-11-02");
  });

  it("grid hours follow wake and bed, widened for anything outside them", () => {
    expect(gridHours(null, [])).toEqual({ from: 7, to: 23 });
    expect(gridHours({ wakeMinute: 7 * 60, bedMinute: 23 * 60 + 30 }, [])).toEqual({ from: 7, to: 24 });
    expect(gridHours({ wakeMinute: 8 * 60, bedMinute: 30 }, [])).toEqual({ from: 8, to: 24 });
    expect(gridHours(null, [{ start: 6 * 60 + 15, end: 7 * 60 }])).toEqual({ from: 6, to: 23 });
    expect(hourLabel(12)).toBe("Noon");
    expect(hourLabel(15)).toBe("3 PM");
  });

  it("week headline counts open days instead of naming one of them", () => {
    const text = (l: { text: string }[]) => l.map((s) => s.text).join("");
    const days = [
      { name: "Monday", minutes: 0, titles: [] },
      { name: "Tuesday", minutes: 0, titles: [] },
      { name: "Saturday", minutes: 315, titles: ["Class", "Essay", "Dinner"] },
    ];
    expect(text(weekHeadline(days))).toBe("Saturday's the full one — 5¼ hours planned. Two days have nothing planned.");
  });
});
