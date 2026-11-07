import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { endOfDayIso, parseQuickAdd } from "@/lib/quick-add";

// Friday 6 November 2026, 13:10 in London.
const now = DateTime.fromISO("2026-11-06T13:10", { zone: "Europe/London" });
const spaces = [
  { id: "s1", name: "School" },
  { id: "s2", name: "Friends" },
  { id: "s3", name: "Side project" },
  { id: "s4", name: "Side" },
];

describe("quick add", () => {
  it("takes a weekday as the due date and removes it from the title", () => {
    const r = parseQuickAdd("pick up concert tickets fri", spaces, now);
    expect(r.title).toBe("pick up concert tickets");
    expect(r.due).toEqual({ date: "2026-11-06", label: "Today" });
    expect(r.space).toBeNull();
  });

  it("weekdays mean the next one; today and tomorrow are words too", () => {
    expect(parseQuickAdd("call mum monday", spaces, now).due).toEqual({ date: "2026-11-09", label: "Monday" });
    expect(parseQuickAdd("bins sat", spaces, now).due).toEqual({ date: "2026-11-07", label: "Tomorrow" });
    expect(parseQuickAdd("email the prof tomorrow", spaces, now)).toMatchObject({ title: "email the prof", due: { date: "2026-11-07", label: "Tomorrow" } });
    expect(parseQuickAdd("reply to Sam today.", spaces, now)).toMatchObject({ title: "reply to Sam", due: { label: "Today" } });
  });

  it("drops a leading on/by/due with the day, and the last day word wins", () => {
    expect(parseQuickAdd("finish essay by thursday", spaces, now)).toMatchObject({ title: "finish essay", due: { date: "2026-11-12", label: "Thursday" } });
    expect(parseQuickAdd("move the call from mon to wed", spaces, now)).toMatchObject({ title: "move the call from mon to", due: { label: "Wednesday" } });
  });

  it("does not treat words that only contain a day as a day", () => {
    const r = parseQuickAdd("buy sunscreen and a monster truck", spaces, now);
    expect(r.due).toBeNull();
    expect(r.title).toBe("buy sunscreen and a monster truck");
  });

  it("suggests a space named in the text; a #tag is removed, a plain word stays", () => {
    expect(parseQuickAdd("revise for school quiz", spaces, now)).toMatchObject({ title: "revise for school quiz", space: { id: "s1" } });
    expect(parseQuickAdd("plan brunch #friends sun", spaces, now)).toMatchObject({ title: "plan brunch", space: { id: "s2" }, due: { label: "Sunday" } });
    expect(parseQuickAdd("ship the side project page", spaces, now).space?.id).toBe("s3");
    expect(parseQuickAdd("schoolbag repair", spaces, now).space).toBeNull();
  });

  it("due is the end of that local day", () => {
    expect(endOfDayIso("2026-11-06", "Europe/London")).toBe("2026-11-06T23:59:00.000+00:00");
  });
});
