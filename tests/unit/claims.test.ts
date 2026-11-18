import { describe, expect, it } from "vitest";
import { emptyReply, stripUnsupported, unsupportedClaims, type TurnStep } from "@/lib/claims";

const noop: TurnStep = { name: "plan", ok: true, mutated: false };
const created: TurnStep = { name: "create_task", ok: true, mutated: true };
const card: TurnStep = { name: "delete_item", ok: true, mutated: true, actionId: "a1" };
const failed: TurnStep = { name: "move_block", ok: false, mutated: false };

describe("reply claims are checked against what the turn's tools did", () => {
  it("catches the production case: a card claimed when only a no-op plan ran", () => {
    const text = "I've sent a card to remove tonight's Los Deportes test block so the planner can use that time. Approve it and I'll re-plan today around the urban gardening project.";
    const claims = unsupportedClaims(text, [noop]);
    expect(claims.map((c) => c.kind)).toEqual(["card"]);
  });

  it("accepts a card claim when a card was really made", () => {
    expect(unsupportedClaims("I've sent you a card to delete it.", [card])).toEqual([]);
  });

  it("catches 'added' / 'moved' / 'marked done' with nothing changed, or after a failure", () => {
    expect(unsupportedClaims("I added the essay to your list.", []).map((c) => c.kind)).toEqual(["created"]);
    expect(unsupportedClaims("I moved the test to 5:30 tomorrow.", [failed]).map((c) => c.kind)).toEqual(["scheduled"]);
    expect(unsupportedClaims("I've marked it done.", [noop]).map((c) => c.kind)).toEqual(["done"]);
    expect(unsupportedClaims("Done! Enjoy your evening.", []).map((c) => c.kind)).toEqual(["generic"]);
  });

  it("accepts true claims", () => {
    expect(unsupportedClaims("I added “PBL Major” under Engineering.", [created])).toEqual([]);
  });

  it("catches a claimed look-up when no tool ran (stress test A1), even next to 'already'", () => {
    const text = "Yes, the task exists. Searching now shows one “Bio lab report” task, due Friday, and it was already on your list before I added it, so I didn't create a second copy.";
    expect(unsupportedClaims(text, []).map((c) => c.kind)).toEqual(["checked"]);
    expect(unsupportedClaims("I just checked: it's on your list, due Friday.", []).map((c) => c.kind)).toEqual(["checked"]);
    expect(unsupportedClaims("A quick search shows nothing called French essay.", []).map((c) => c.kind)).toEqual(["checked"]);
    const read: TurnStep = { name: "search_items", ok: true, mutated: false };
    expect(unsupportedClaims(text, [read])).toEqual([]);
    expect(unsupportedClaims("I just checked: it's on your list.", [read])).toEqual([]);
    for (const s of ["Let me check your list.", "I can check your plan for tomorrow.", "I couldn't check Canvas right now."]) expect(unsupportedClaims(s, []), s).toEqual([]);
  });

  it("ignores offers, negations and references to earlier turns", () => {
    for (const s of [
      "I couldn't move it: that time overlaps your class.",
      "I can move the test to tomorrow if you want.",
      "Earlier I moved the test to tomorrow.",
      "It's already on your list.",
      "Want me to add it?",
      "I didn't add anything.",
    ]) expect(unsupportedClaims(s, []), s).toEqual([]);
  });

  it("falls back to facts: drops unbacked sentences and never says a bare Done", () => {
    const text = "I've sent a card to remove the block. The rest of tonight is open.";
    const claims = unsupportedClaims(text, [noop]);
    expect(stripUnsupported(text, claims, ["Your plan already works; nothing changed"])).toBe("The rest of tonight is open.\n\nWhat actually happened: Your plan already works; nothing changed.");
    expect(emptyReply([], false)).toBe("I didn't change anything.");
    expect(emptyReply(["(didn't work) Couldn't move it there"], true)).toBe("Not everything worked. What happened: (didn't work) Couldn't move it there.");
  });
});
