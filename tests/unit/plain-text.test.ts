import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { dayWord, fieldWords, isPlanStep, legacyDetail, legacyDisplay, partOfDay, plainActivity, plainProblems, shortTitle } from "@/lib/plain-text";
import { displayOf, planCard } from "@/lib/plan-card";

const zone = "America/New_York";

// Lines the owner actually saw in the chat (2026-11-08), verbatim.
const SEEN = [
  "Updated plan block “Administration Heimler Video + Quiz (AP World)”: starts_at → 2026-11-08T14:05:00-05:00, ends_at → 2026-11-08T14:35:00-05:00",
  "Reworked your plan: 5 blocks marked interrupted (“Finish LEQ paper (AP World)”, “A”, “B”, “C”, “D”). 4 blocks re-planned from 4:20 PM today. Not scheduled yet, still on your task list: “Q1” (30 min), “Q2” (30 min), “Q3” (30 min), “Q4” (30 min), “Q5” (30 min); there's no free time for it tomorrow either. 1 earlier block isn't marked yet; say how it went in the evening review.",
  "Planned your day: Sun Nov 8: placed 9 blocks (4 moved). Didn't fit: “A” (30 min left), “B” (30 min left), “C” (30 min left), “D” (30 min left) and 9 more. They stay on your task list. “X” is due by today but 30 min of work doesn't fit. Consider the recovery options.",
];

describe("plainProblems: the check every person-facing line must pass", () => {
  it("rejects what the owner saw", () => {
    for (const s of SEEN) expect(plainProblems(s).length, s).toBeGreaterThan(0);
    expect(plainProblems(SEEN[0])).toEqual(expect.arrayContaining(["ISO timestamp", "field name", "arrow"]));
    expect(plainProblems(SEEN[1])).toEqual(expect.arrayContaining(["long list", "too long"]));
    expect(plainProblems("I don't have a live clock, so I used 1:15 as now")).toContain("clock time");
    expect(plainProblems("Kept free during quiet hours")).toEqual(["jargon: quiet hours"]);
  });

  it("accepts plain lines, and times inside the disclosure", () => {
    for (const s of ["Moved “Heimler video” earlier", "Cleared your time until then", "Planned tonight: 6 things", "Added “water the plants”", "13 things didn't fit tonight"]) expect(plainProblems(s), s).toEqual([]);
    expect(plainProblems("Heimler Video + Quiz → 2:05 PM", { detail: true })).toEqual([]);
    // A title may contain any word; only Navi's own words are checked.
    expect(plainProblems("Moved “Building blocks lab”")).toEqual([]);
  });
});

describe("shortTitle", () => {
  it("drops item codes and bracketed tags, and shortens long titles", () => {
    expect(shortTitle("02.03a Heimler Video + Quiz (AP World)")).toBe("Heimler Video + Quiz");
    expect(shortTitle("Module 3 vocabulary (Spanish)")).toBe("Module 3 vocabulary");
    expect(shortTitle("U3.2 - Quiz corrections")).toBe("Quiz corrections");
    expect(shortTitle("[APW] Essay outline")).toBe("Essay outline");
    expect(shortTitle("3 pages of reading")).toBe("3 pages of reading");
    expect(shortTitle("(Spanish)")).toBe("(Spanish)");
    expect(shortTitle("Write the long argumentative essay about the causes of the First World War")).toBe("Write the long argumentative essay…");
  });
});

describe("older messages (saved before display lines) still read cleanly", () => {
  it("rewrites known summaries and cleans the rest", () => {
    expect(legacyDisplay({ name: "update_item", ok: true, summary: SEEN[0] })).toBe("Moved “Administration Heimler Video + Quiz”");
    expect(legacyDetail({ summary: SEEN[0] })).toEqual(["Administration Heimler Video + Quiz → 2:05 PM"]);
    expect(legacyDisplay({ name: "recover_plan", ok: true, summary: SEEN[1] })).toBe("Reworked the rest of today. 5 things didn't fit");
    expect(legacyDisplay({ name: "plan_day", ok: true, summary: SEEN[2].replace("Planned your day: ", "") })).toBe("Planned 9 things. 13 things didn't fit");
    expect(legacyDisplay({ name: "create_task", ok: true, summary: "Created task “Call mom”: soft due date Sunday Nov 8. It is not scheduled" })).toBe("Added “Call mom”");
    expect(legacyDisplay({ name: "remember", ok: true, summary: "Remembered: likes mornings" })).toBe("Remembered: likes mornings");
    for (const s of SEEN) expect(plainProblems(legacyDisplay({ name: "update_item", ok: true, summary: s }))).toEqual([]);
  });

  it("groups an old reply's four block moves into one card with one Undo", () => {
    const old = ["A", "B", "C", "D"].map((t, i) => ({
      name: "update_item",
      ok: true,
      summary: `Updated plan block “${t} (AP World)”: starts_at → 2026-11-08T1${4 + i}:05:00-05:00, ends_at → 2026-11-08T1${4 + i}:35:00-05:00`,
      undo: [`u${i}`],
    }));
    expect(old.every(isPlanStep)).toBe(true);
    const card = planCard(old);
    expect(card).toEqual({ display: "Updated your plan", detail: ["A → 2:05 PM", "B → 3:05 PM", "C → 4:05 PM", "D → 5:05 PM"], undo: ["u0", "u1", "u2", "u3"] });
  });

  it("offers no Undo when part of the plan change can't be undone", () => {
    const card = planCard([
      { name: "update_item", ok: true, summary: "", display: "Moved “A”", detail: ["A → 2:05 PM"], plan: true, undo: ["u1"] },
      { name: "plan_day", ok: true, summary: "", display: "Planned today: 3 things", plan: true, irreversible: true },
    ]);
    expect(card.undo).toBeUndefined();
    expect(card.display).toBe("Updated your plan");
    // An unchanged step doesn't block Undo or show up.
    const ok = planCard([
      { name: "shift_blocks", ok: true, summary: "", display: "Cleared your time until then", detail: ["A → 2:05 PM"], plan: true, undo: ["u1", "u2"] },
      { name: "plan", ok: true, summary: "", display: "Your plan already works; nothing changed", plan: true, unchanged: true },
    ]);
    expect(ok).toMatchObject({ display: "Cleared your time until then", detail: ["A → 2:05 PM"], undo: ["u1", "u2"] });
    expect(displayOf({ name: "x", ok: true, summary: "Updated task “Essay (Eng)”: due_at → 2026-11-09T23:59:00-05:00" })).toBe("Updated “Essay”");
  });
});

describe("words for days, parts of the day and fields", () => {
  const now = DateTime.fromISO("2026-11-08T13:47:00", { zone }); // a Sunday
  it("names days and parts of the day like a person", () => {
    expect(dayWord("2026-11-08", zone, now)).toBe("today");
    expect(dayWord("2026-11-08", zone, now.set({ hour: 19 }))).toBe("tonight");
    expect(dayWord("2026-11-09", zone, now)).toBe("tomorrow");
    expect(dayWord("2026-11-11", zone, now)).toBe("Wednesday");
    expect(partOfDay(DateTime.fromISO("2026-11-08T16:00:00", { zone }), now)).toBe("this afternoon");
    expect(partOfDay(DateTime.fromISO("2026-11-08T22:00:00", { zone }), now)).toBe("tonight");
    expect(fieldWords(["starts_at", "ends_at"])).toBe("time");
    expect(fieldWords(["due_at", "estimate_minutes"])).toBe("due date and estimate");
  });

  it("makes Activity readable without losing the detail", () => {
    expect(plainActivity("Updated plan block “X” (starts_at, ends_at)")).toBe("Updated plan “X” (time)");
    expect(plainActivity("Updated task “X”: due_at → 2026-11-09T23:59:00-05:00", zone)).toBe("Updated task “X”: due date → Mon Nov 9, 11:59 PM");
  });
});
