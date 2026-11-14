import type { ToolEvent } from "./types";
import type { ActionView } from "./actions";
import type { StepView } from "./tool-events";
import { isPlanStep } from "./plain-text";
import { displayOf, planCard } from "./plan-card";
import { stepDone } from "./tool-labels";

// How a saved reply's steps read, as rows (pure). The web chat (NaviMessage)
// and the phone app's message history (/api/m) both draw from this, so they
// show the same receipts: every plan change of a reply as ONE row with one
// Undo where the first one was, the other steps as their own ✓/✕ rows, and the
// steps that are waiting on (or show the outcome of) an action card left out
// of the rows, to be drawn as that card.

export type ReceiptRow = {
  ok: boolean;
  /** "Added a task", "Updated your plan", "Couldn't move…". */
  label: string;
  /** The one plain line under the label. */
  display: string;
  detail?: string[];
  leftover?: StepView["leftover"];
  /** Activity-log ids that undo this row (Undo shown only when ok and non-empty). */
  undo?: string[];
  /** This row stands for all of the reply's plan changes. */
  plan?: true;
};

export type ReplyView = {
  rows: ReceiptRow[];
  /** Action cards this reply carries, in order, without repeats. */
  cardIds: string[];
  /** An older reply mentions an approval it isn't linked to (it's in Activity). */
  unlinked: boolean;
};

export function replyView(events: ToolEvent[], actions: Record<string, ActionView>): ReplyView {
  const cards = events.flatMap((e) => (e.action_id && actions[e.action_id] ? [e.action_id] : []));
  const steps = events.filter((e) => !(e.action_id && actions[e.action_id]));
  const unlinked = steps.some((e) => !e.action_id && /approv/i.test(e.summary));
  const planSteps = steps.filter((e) => e.ok && isPlanStep(e));
  const firstPlan = steps.findIndex((e) => planSteps.includes(e));
  const rows: ReceiptRow[] = [];
  steps.forEach((e, i) => {
    if (planSteps.includes(e)) {
      if (i !== firstPlan) return;
      const card = planCard(planSteps);
      rows.push({ ok: true, label: "Updated your plan", display: card.display, detail: card.detail, leftover: card.leftover, undo: card.undo, plan: true });
      return;
    }
    rows.push({ ok: e.ok, label: stepDone(e.name, e.ok), display: displayOf(e), detail: e.detail, leftover: e.leftover, undo: e.undo });
  });
  return { rows, cardIds: cards.filter((id, i) => cards.indexOf(id) === i), unlinked };
}
