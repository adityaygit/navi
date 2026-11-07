import { describe, expect, it } from "vitest";
import { savedNaviColor, withNaviColor } from "@/app/(app)/settings/navi-color";
import { NAVI_COLORS } from "@/lib/navi-colors";

describe("Navi's colour preference", () => {
  it("sets navi_color and keeps every other preference", () => {
    const before = { tone: "direct", briefing: { short: true }, navi_color: "amber" };
    const after = withNaviColor(before, "lilac");
    expect(after).toEqual({ tone: "direct", briefing: { short: true }, navi_color: "lilac" });
    // The stored object isn't changed in place.
    expect(before.navi_color).toBe("amber");
  });

  it("starts from empty preferences when none (or something odd) is stored", () => {
    for (const prefs of [null, undefined, "x", 3, ["rose"]]) expect(withNaviColor(prefs, "sky")).toEqual({ navi_color: "sky" });
  });

  it("accepts every palette colour and rejects anything else", () => {
    for (const c of NAVI_COLORS) expect(withNaviColor({}, c.key).navi_color).toBe(c.key);
    for (const bad of ["", "red", "AMBER", "amber ", null, 1, { key: "rose" }, "__proto__"]) expect(() => withNaviColor({}, bad)).toThrow();
  });

  it("reads the saved colour, falling back to mint (the Navi 1.5 stone)", () => {
    expect(savedNaviColor({ navi_color: "mint" })).toBe("mint");
    expect(savedNaviColor({ navi_color: "neon" })).toBe("mint");
    expect(savedNaviColor({})).toBe("mint");
    expect(savedNaviColor(null)).toBe("mint");
  });
});
