import { describe, expect, it } from "vitest";
import { buildItems } from "../ui/Thread";
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
