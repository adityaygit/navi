import type { ToolEvent } from "./types";
import type { StepView } from "./tool-events";
import { legacyDetail, legacyDisplay } from "./plain-text";

// How a reply's steps read in the chat (pure, shared by the chat UI and tests).

export type Step = Pick<ToolEvent, "name" | "ok" | "summary" | "undo"> & StepView;

/** A saved step's plain line; older messages only have the summary, which is cleaned. */
export function displayOf(e: Step): string {
  return e.display ?? legacyDisplay({ name: e.name, ok: e.ok, summary: e.summary ?? "" });
}

/**
 * All the plan changes of one reply as one card: its line ("Updated your
 * plan" when there were several), every move behind one arrow, what didn't fit,
 * and one Undo that puts back everything this reply changed in the plan. Undo
 * is offered only when all of it can be undone.
 */
export function planCard(steps: Step[]): { display: string; detail: string[]; leftover?: StepView["leftover"]; undo?: string[] } {
  const changed = steps.filter((s) => !s.unchanged);
  const lines = changed.length ? changed : steps;
  const display = lines.length === 1 ? displayOf(lines[0]) : "Updated your plan";
  const detail = lines.flatMap((s) => (s.detail?.length ? s.detail : s.display === undefined ? legacyDetail({ summary: s.summary ?? "" }) : lines.length > 1 && s.display ? [s.display] : []));
  const leftover = [...steps].reverse().find((s) => s.leftover)?.leftover;
  const ids = changed.flatMap((s) => s.undo ?? []);
  const canUndo = ids.length > 0 && changed.every((s) => (s.undo?.length ?? 0) > 0 && !s.irreversible);
  return { display, detail, ...(leftover ? { leftover } : {}), ...(canUndo ? { undo: ids } : {}) };
}
