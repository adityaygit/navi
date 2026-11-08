import "server-only";
import { isReadOnlyTool, stepDoing, stepDone } from "@/lib/tool-labels";
import type { AgentEvent } from "@/lib/chat-stream";
import type { ActionView } from "@/lib/actions";
import { stepView, type StepView } from "@/lib/tool-events";

export { toolEventOf } from "@/lib/tool-events";

// Live progress events for a streaming chat client (see src/lib/chat-stream.ts),
// shared by the real model loop and the development simulator.

/** Calls the listener, never letting a broken listener break the turn. */
export function emitter(req: { onEvent?: (event: AgentEvent) => void }): (event: AgentEvent) => void {
  return (event) => {
    if (!req.onEvent) return;
    try {
      req.onEvent(event);
    } catch {
      // A disconnected client must not stop the work; the turn still finishes and saves.
    }
  };
}

export function stepStartEvent(id: string, name: string): AgentEvent {
  return { type: "step_start", id, name, label: stepDoing(name), readOnly: isReadOnlyTool(name) };
}

/** A finished step for the live view: the person sees `view` (its plain line and detail), never the model's summary. */
export function stepEndEvent(id: string, name: string, ok: boolean, view: StepView = {}, extra: { action?: ActionView; undo?: string[] } = {}): AgentEvent {
  const readOnly = isReadOnlyTool(name);
  return { type: "step_end", id, name, ok, label: stepDone(name, ok), readOnly, ...(readOnly ? {} : stepView(view)), ...(extra.action ? { action: extra.action } : {}), ...(extra.undo?.length ? { undo: extra.undo } : {}) };
}
