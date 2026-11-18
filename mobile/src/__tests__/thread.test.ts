import { describe, expect, it } from "vitest";
import { buildItems, folded } from "../ui/Thread";
import type { Message } from "@shared/types";

const msg = (id: string, role: "user" | "assistant", content: string, minsAgo: number, extra: Partial<Message> & Record<string, unknown> = {}): Message =>
  ({ id, conversation_id: "c", role, content, modality: "text", tool_events: [], created_at: new Date(Date.now() - minsAgo * 60000).toISOString(), ...extra }) as Message;

describe("conversation layout", () => {
  it("adds a time stamp only when an hour has passed", () => {
    const items = buildItems([msg("1", "user", "hi", 120), msg("2", "assistant", "hello", 119), msg("3", "user", "again", 10)], {}, null);
    expect(items.filter((i) => i.k === "stamp")).toHaveLength(2);
  });
  it("uses the server's merged receipts when present, with Undo only on rows that worked", () => {
    const items = buildItems(
      [msg("1", "assistant", "Done.", 1, { receipts: [{ ok: true, label: "Moved", display: "Moved 3 things", undo: ["a", "b"] }, { ok: false, label: "x", display: "Couldn't move the gym", undo: ["c"] }], cardIds: [] })],
      {},
      null,
    );
    const receipts = items.filter((i) => i.k === "receipt") as { undo?: string[]; text: string }[];
    expect(receipts.map((r) => r.text)).toEqual(["Moved 3 things", "Couldn't move the gym"]);
    expect(receipts[0].undo).toEqual(["a", "b"]);
    expect(receipts[1].undo).toBeUndefined();
  });
  it("shows what Navi is doing while a reply streams", () => {
    const items = buildItems([], {}, { text: "", segment: 0, steps: [{ id: "s", label: "Moving the essay", done: false, ok: true, readOnly: false }] });
    expect(items).toEqual([expect.objectContaining({ k: "looking", text: "Moving the essay" })]);
  });
});

describe("folding (M6)", () => {
  type Item = Parameters<typeof folded>[0][number];
  const card = (key: string, subject: string, status = "proposed") => ({ k: "card", key, action: { id: key, status, subject } }) as unknown as Item;
  const talk = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ k: i % 2 ? "navi" : "me", key: `t${i}`, text: `m${i}` }) as Item);

  it("shows one waiting suggestion and folds the rest into “N more”", () => {
    const items = [...talk(2), card("a", "Move the essay"), card("b", "Text Sam"), card("c", "Book gym"), card("d", "Done thing", "completed")];
    const f = folded(items, false, false);
    expect(f.list.map((i) => i.key)).toEqual(["t0", "t1", "a", "d"]);
    expect(f.more).toEqual({ n: 2, subject: "Text Sam" });
    expect(folded(items, false, true).list).toHaveLength(6);
  });

  it("folds the start of a long chat at a turn and counts the messages", () => {
    const f = folded(talk(40), false, false);
    expect(f.list[0].k).toBe("me");
    expect(f.list.length).toBeGreaterThanOrEqual(16);
    expect(f.earlier + f.list.length).toBe(40);
    expect(folded(talk(40), true, false).earlier).toBe(0);
    expect(folded(talk(20), false, false).earlier).toBe(0);
  });
});
