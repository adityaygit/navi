import { describe, expect, it } from "vitest";
import { inQuiet, skippedByQuiet } from "../settings/reminders";
import { paletteFor } from "../theme/colour";
import { palettes, skyFor } from "../theme/tokens";

describe("quiet hours", () => {
  it("handles windows that cross midnight and ones that don't", () => {
    const night = { start: "22:00", end: "07:00" };
    expect(inQuiet("06:00", night)).toBe(true);
    expect(inQuiet("07:00", night)).toBe(false);
    expect(inQuiet("21:59", night)).toBe(false);
    expect(inQuiet("23:30", night)).toBe(true);
    expect(inQuiet("13:00", { start: "12:00", end: "14:00" })).toBe(true);
    expect(inQuiet("06:00", null)).toBe(false);
  });
  it("says which briefings quiet hours would silence", () => {
    expect(skippedByQuiet({ briefings: { enabled: true, morning: "06:00", evening: "21:00" }, quietHours: { start: "22:00", end: "07:00" } })).toEqual(["morning"]);
  });
});

describe("colour", () => {
  const rose = { key: "rose" as const, light: "#FFD3E1", mid: "#F27BA0", dark: "#B9406A", text: "#FFB8CE" };
  it("M6 uses one light palette whatever colour was chosen, and the moment only picks the sky", () => {
    expect(paletteFor({ followsDay: true, color: rose }, "night")).toBe(palettes.night);
    expect(paletteFor({ followsDay: false, color: rose }, "morning")).toBe(palettes.morning);
    expect(palettes.morning.cta).toBe("#11141A");
    expect(skyFor("morning")).toBe("day");
    expect(skyFor("evening")).toBe("dusk");
    expect(skyFor("night")).toBe("dusk");
  });
});
