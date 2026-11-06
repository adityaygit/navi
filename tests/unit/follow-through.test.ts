import { describe, expect, it } from "vitest";
import { followThrough, statusWord } from "@/lib/follow-through";

describe("followThrough", () => {
  it("averages the parts that exist", () => {
    const r = followThrough({ avgCompletion: 0.82, minutes: { planned: 600, focus: 426 }, dueCompletions: 10, lateCompletions: 1, enoughData: true });
    expect(r.parts.map((p) => p.value)).toEqual([82, 71, 90]);
    expect(r.score).toBe(81);
  });

  it("gives no score without enough data, but keeps the measured parts", () => {
    const r = followThrough({ avgCompletion: 0.5, minutes: { planned: 60, focus: 30 }, dueCompletions: 0, lateCompletions: 0, enoughData: false });
    expect(r.score).toBeNull();
    expect(r.parts.find((p) => p.key === "onTime")!.value).toBeNull();
    expect(r.parts.find((p) => p.key === "focus")!.value).toBe(50);
  });

  it("skips parts with nothing to measure instead of counting them as zero", () => {
    const r = followThrough({ avgCompletion: 0.9, minutes: { planned: 0, focus: 0 }, dueCompletions: 0, lateCompletions: 0, enoughData: true });
    expect(r.score).toBe(90);
  });

  it("caps focus at 100", () => {
    const r = followThrough({ avgCompletion: null, minutes: { planned: 60, focus: 200 }, dueCompletions: 0, lateCompletions: 0, enoughData: true });
    expect(r.parts[1].value).toBe(100);
  });

  it("words follow one scale", () => {
    expect(statusWord(null).tone).toBe("none");
    expect(statusWord(85).word).toBe("Great");
    expect(statusWord(71).word).toBe("Okay");
    expect(statusWord(40).word).toBe("Needs care");
  });
});
