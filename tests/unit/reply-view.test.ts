import { describe, expect, it } from "vitest";
import { replyView } from "@/lib/reply-view";
import type { ActionView } from "@/lib/actions";
import type { ToolEvent } from "@/lib/types";

// A saved reply's receipts, as both the web chat and the phone app draw them.

const card = (id: string): ActionView => ({ id, status: "proposed", verb: "Email", subject: "Sam", fields: [], reason: null, external: true, result: null, error: null, undo: [], undone: false, revision: 1, expiresAt: "2026-11-20T00:00:00Z" });

describe("replyView", () => {
  it("merges every plan change into one row where the first one was, keeps other steps, and lifts cards out", () => {
    const events: ToolEvent[] = [
      { name: "create_task", ok: true, summary: "Created task", display: "Added “Buy milk”", undo: ["a1"] },
      { name: "plan_day", ok: true, summary: "Planned", display: "Planned today", plan: true, undo: ["p1"] },
      { name: "send_email", ok: true, summary: "Asked", action_id: "c1" },
      { name: "move_block", ok: true, summary: "Moved", display: "Moved run to 7", plan: true, undo: ["p2"] },
      { name: "send_email", ok: true, summary: "Asked again", action_id: "c1" },
    ];
    const v = replyView(events, { c1: card("c1") });
    expect(v.cardIds).toEqual(["c1"]);
    expect(v.unlinked).toBe(false);
    expect(v.rows).toHaveLength(2);
    expect(v.rows[0]).toMatchObject({ ok: true, display: "Added “Buy milk”", undo: ["a1"] });
    expect(v.rows[1]).toMatchObject({ ok: true, label: "Updated your plan", display: "Updated your plan", detail: ["Planned today", "Moved run to 7"], undo: ["p1", "p2"], plan: true });
  });

  it("keeps a step whose card isn't known as a row, and flags old unlinked approvals", () => {
    const v = replyView([{ name: "request_approval", ok: true, summary: "Asked for approval to email" }], {});
    expect(v.rows).toHaveLength(1);
    expect(v.cardIds).toEqual([]);
    expect(v.unlinked).toBe(true);
  });

  it("offers no Undo for a plan card with a change that can't be undone", () => {
    const v = replyView(
      [
        { name: "plan_day", ok: true, summary: "Planned", display: "Planned today", plan: true, undo: ["p1"] },
        { name: "plan_week", ok: true, summary: "Planned", display: "Planned week", plan: true, irreversible: true },
      ],
      {},
    );
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0].undo).toBeUndefined();
  });
});
