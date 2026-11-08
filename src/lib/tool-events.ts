import type { ToolEvent } from "./types";

// The saved form of one tool step (messages.tool_events), shared by text chat,
// the simulator and voice (whose client builds it from /api/voice/tool).

/** What a step tells the person, besides the model's exact summary. */
export type StepView = Pick<ToolEvent, "display" | "detail" | "plan" | "leftover" | "irreversible" | "unchanged">;

export type ToolOutcome = StepView & { ok: boolean; summary: string; actionId?: string | null; undo?: string[] };

/** The person-facing fields of a step, without empty ones. */
export function stepView(result: StepView): StepView {
  return {
    ...(result.display ? { display: result.display } : {}),
    ...(result.detail?.length ? { detail: result.detail.slice(0, 40) } : {}),
    ...(result.plan ? { plan: true } : {}),
    ...(result.leftover ? { leftover: { line: result.leftover.line, options: result.leftover.options.slice(0, 4) } } : {}),
    ...(result.irreversible ? { irreversible: true } : {}),
    ...(result.unchanged ? { unchanged: true } : {}),
  };
}

/** The saved form of a step: what the reply lists as an action taken. */
export function toolEventOf(name: string, result: ToolOutcome): ToolEvent {
  return {
    name,
    ok: result.ok,
    summary: result.summary,
    ...stepView(result),
    ...(result.actionId ? { action_id: result.actionId } : {}),
    ...(result.undo?.length && !result.actionId ? { undo: result.undo } : {}),
  };
}
