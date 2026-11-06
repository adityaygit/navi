import "server-only";
import { isReadOnlyTool, stepDoing, stepDone } from "@/lib/tool-labels";
import type { AgentEvent } from "@/lib/chat-stream";

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

export function stepEndEvent(id: string, name: string, ok: boolean, summary: string): AgentEvent {
  const readOnly = isReadOnlyTool(name);
  return { type: "step_end", id, name, ok, label: stepDone(name, ok), summary: readOnly ? "" : summary, readOnly };
}
