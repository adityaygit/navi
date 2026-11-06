import type { Message } from "./types";

// The live chat protocol. POST /api/chat with `stream: true` answers with
// newline-delimited JSON (application/x-ndjson), one event per line, in order:
//
//   user        the saved user message, and the chat it went to
//   step_start  a tool step began                     (0..n, each later ends)
//   step_end    that step finished, ok or not, with the tool's own summary
//   text        a piece of reply text as it is written (segment = model pass;
//               text in a pass that then runs tools is narration, not the reply)
//   reset       discard what was shown live (the provider retried on a backup model)
//   done        the turn is saved: the same body the JSON response returns
//   error       the turn failed; nothing more follows
//
// What `done` carries is exactly what is stored, so a reload shows the same
// thing. Read-only steps stream (so the person sees Navi looking) but, as
// before, aren't saved as actions taken.

export type AgentEvent =
  | { type: "step_start"; id: string; name: string; label: string; readOnly: boolean }
  | { type: "step_end"; id: string; name: string; ok: boolean; label: string; summary: string; readOnly: boolean }
  | { type: "text"; delta: string; segment: number }
  | { type: "reset" };

export type TurnDone = {
  conversationId: string;
  title?: string | null;
  userMessage: Message;
  assistantMessage: Message;
  mutated: boolean;
  simulated: boolean;
  error?: string;
};

export type ChatStreamEvent =
  | AgentEvent
  | { type: "user"; userMessage: Message; conversationId: string; title: string | null }
  | ({ type: "done" } & TurnDone)
  | { type: "error"; message: string; status: number };

export const CHAT_STREAM_CONTENT_TYPE = "application/x-ndjson";

/** Reads an NDJSON response body, calling `onEvent` for each event as it arrives. */
export async function readChatStream(body: ReadableStream<Uint8Array>, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    onEvent(JSON.parse(trimmed) as ChatStreamEvent);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      flush(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  flush(buffer);
}
