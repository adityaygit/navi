import { useCallback, useEffect, useRef, useState } from "react";
import { api, send as rawSend } from "../api/client";
import { readChatStream, type ChatStreamEvent } from "@shared/chat-stream";
import type { ActionView } from "@shared/actions";
import type { Message, ToolEvent } from "@shared/types";
import { feel } from "../native/haptics";

// One chat with Navi: history, a live reply while it streams, Undo, and the
// person's answers to cards. Same server, same protocol as the website
// (src/lib/chat-stream.ts), sent with the app's bearer token.

export type LiveStep = { id: string; label: string; done: boolean; ok: boolean; display?: string; action?: ActionView; undo?: string[]; readOnly: boolean };
export type Live = { text: string; segment: number; steps: LiveStep[] } | null;

export type ChatState = {
  conversationId: string | null;
  title: string | null;
  messages: Message[];
  actions: Record<string, ActionView>;
  /** Activity ids already undone, so their Undo turns into "Undone". */
  undone: Set<string>;
  live: Live;
  sending: boolean;
  error: string | null;
  loading: boolean;
  /** Counts each time the person switches chat (not when the server names a new one): the thread fades between them. */
  epoch: number;
  /** The reply was stopped by the person; what arrived is kept. */
  stopped: boolean;
};

type ChatPayload = { id: string; title: string | null; messages: Message[]; actions: Record<string, ActionView>; undone: string[] };

// Chats already opened this run: switching back shows them at once, then refreshes quietly.
const seenChats = new Map<string, ChatPayload>();
const remember = (c: ChatPayload) => {
  seenChats.delete(c.id);
  seenChats.set(c.id, c);
  if (seenChats.size > 12) seenChats.delete(seenChats.keys().next().value as string);
};
/** On sign out, so another person on the phone never sees these. */
export function clearChatCache() {
  seenChats.clear();
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

/** `opts.kind` "onboarding": the setup conversation (sent with that kind, history from /api/m/welcome/talk). */
export function useChat(initialId: string | null, opts: { kind?: "chat" | "onboarding" } = {}) {
  const kind = opts.kind ?? "chat";
  const historyPath = (id: string, limit?: number) => (kind === "onboarding" ? "/api/m/welcome/talk" : `/api/m/chats/${id}/messages${limit ? `?limit=${limit}` : ""}`);
  const [state, setState] = useState<ChatState>({ conversationId: initialId, title: null, messages: [], actions: {}, undone: new Set(), live: null, sending: false, error: null, loading: !!initialId, epoch: 0, stopped: false });
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async (id: string | null) => {
    abort.current?.abort();
    if (!id) {
      setState((s) => ({ ...s, conversationId: null, title: null, messages: [], actions: {}, undone: new Set(), live: null, sending: false, loading: false, error: null, stopped: false, epoch: s.epoch + 1 }));
      return;
    }
    // Switching chats: the old one goes at once (nothing lingers); a chat opened before shows from memory while it refreshes.
    const had = kind === "chat" ? seenChats.get(id) : undefined;
    setState((s) =>
      s.conversationId === id
        ? { ...s, loading: !had && !s.messages.length, error: null }
        : { ...s, conversationId: id, title: had?.title ?? null, messages: had?.messages ?? [], actions: had?.actions ?? {}, undone: new Set(had?.undone ?? []), live: null, sending: false, loading: !had, error: null, stopped: false, epoch: s.epoch + 1 },
    );
    try {
      const c = await api<ChatPayload>(historyPath(id));
      if (kind === "chat") remember({ ...c, id });
      setState((s) => (s.conversationId !== id ? s : { ...s, title: c.title, messages: c.messages, actions: c.actions ?? {}, undone: new Set(c.undone ?? []), loading: false }));
    } catch (e) {
      setState((s) => (s.conversationId !== id ? s : { ...s, loading: false, error: s.messages.length ? null : "Couldn't open that chat. Check your connection and try again." }));
      void e;
    }
  }, []);

  // Load when the chosen chat changes, but not when the server just named the
  // chat we're already in (that would cancel the reply that is streaming).
  const idRef = useRef(state.conversationId);
  idRef.current = state.conversationId;
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current && initialId === idRef.current) return;
    booted.current = true;
    void load(initialId);
  }, [initialId, load]);

  // Keep what's on screen as the copy for next time.
  useEffect(() => {
    if (kind === "chat" && state.conversationId && !state.loading && !state.live && state.messages.length && !state.messages.some((m) => m.id.startsWith("local-"))) {
      remember({ id: state.conversationId, title: state.title, messages: state.messages, actions: state.actions, undone: [...state.undone] });
    }
  }, [kind, state.conversationId, state.loading, state.live, state.messages, state.actions, state.undone, state.title]);

  const sendText = useCallback(async (text: string, viewing?: string) => {
    const clientMessageId = uuid();
    const optimistic: Message = { id: `local-${clientMessageId}`, conversation_id: "", role: "user", content: text, modality: "text", tool_events: [], created_at: new Date().toISOString(), client_id: clientMessageId };
    let conversationId: string | null = null;
    setState((s) => {
      conversationId = s.conversationId;
      return { ...s, messages: [...s.messages, optimistic], live: { text: "", segment: 0, steps: [] }, sending: true, error: null, stopped: false };
    });
    const ctl = new AbortController();
    abort.current = ctl;
    const apply = (ev: ChatStreamEvent) => {
      setState((s) => reduce(s, ev, optimistic.id));
      if (ev.type === "done") {
        if (ev.mutated) feel("success");
        // The saved reply's receipts and card states come from the history view.
        void api<ChatPayload>(historyPath(ev.conversationId, 2))
          .then((h) =>
            setState((s) => {
              const byId = new Map(h.messages.map((m) => [m.id, m]));
              return { ...s, messages: s.messages.map((m) => byId.get(m.id) ?? m), actions: { ...s.actions, ...(h.actions ?? {}) } };
            }),
          )
          .catch(() => {});
      }
    };
    try {
      const res = await rawSend("/api/chat", { body: { text, conversationId: kind === "onboarding" ? null : conversationId, stream: true, clientMessageId, viewing: viewing ?? null, ...(kind === "onboarding" ? { kind } : {}) }, signal: ctl.signal });
      if (!res.ok || !res.body) {
        const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => undefined);
        throw new Error(msg || `Navi couldn't answer (${res.status}).`);
      }
      await readChatStream(res.body, apply);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setState((s) => ({ ...s, live: null, sending: false, error: (e as Error).message }));
      feel("warning");
    }
  }, []);

  /** Stop the reply: what has arrived stays on screen, marked as stopped. (The server finishes anything it had already started; it shows up when the chat is opened again.) */
  const stop = useCallback(() => {
    if (!abort.current) return;
    abort.current.abort();
    abort.current = null;
    feel("select");
    setState((s) => {
      if (!s.sending) return s;
      const text = s.live?.text.trim() ?? "";
      const kept: Message[] = text ? [{ id: `stopped-${uuid()}`, conversation_id: s.conversationId ?? "", role: "assistant", content: text, modality: "text", tool_events: [], created_at: new Date().toISOString() } as Message] : [];
      // The person's own message was already sent: it stops looking pending.
      const sent = s.messages.map((m) => (m.id.startsWith("local-") ? { ...m, id: `sent-${m.id.slice(6)}` } : m));
      return { ...s, messages: [...sent, ...kept], live: null, sending: false, stopped: true };
    });
  }, []);

  /** Undo what a reply changed (activity-log ids). */
  const undo = useCallback(async (ids: string[]) => {
    feel("undo");
    setState((s) => ({ ...s, undone: new Set([...s.undone, ...ids]) }));
    try {
      await api("/api/m/undo", { body: { activityIds: ids } });
    } catch (e) {
      setState((s) => {
        const u = new Set(s.undone);
        ids.forEach((i) => u.delete(i));
        return { ...s, undone: u, error: (e as Error).message };
      });
      feel("warning");
    }
  }, []);

  /** Answer a card Navi is waiting on. */
  const decide = useCallback(async (actionId: string, decision: "approve" | "decline") => {
    feel(decision === "approve" ? "success" : "select");
    setState((s) => {
      const a = s.actions[actionId];
      return a ? { ...s, actions: { ...s.actions, [actionId]: { ...a, status: decision === "approve" ? "executing" : "declined" } } } : s;
    });
    try {
      const r = await api<{ action: ActionView }>(`/api/m/approvals/${actionId}/decide`, { body: { decision } });
      setState((s) => ({ ...s, actions: { ...s.actions, [actionId]: r.action } }));
    } catch (e) {
      setState((s) => {
        const a = s.actions[actionId];
        return { ...s, error: (e as Error).message, actions: a ? { ...s.actions, [actionId]: { ...a, status: "proposed" } } : s.actions };
      });
      feel("warning");
    }
  }, []);

  return { state, load, sendText, stop, undo, decide };
}

function reduce(s: ChatState, ev: ChatStreamEvent, optimisticId: string): ChatState {
  const live = s.live ?? { text: "", segment: 0, steps: [] };
  switch (ev.type) {
    case "user":
      return { ...s, conversationId: ev.conversationId, title: ev.title ?? s.title, messages: s.messages.map((m) => (m.id === optimisticId ? ev.userMessage : m)) };
    case "text":
      // Text from an earlier pass was narration before tools ran; show only the latest pass.
      return { ...s, live: ev.segment > live.segment ? { ...live, text: ev.delta, segment: ev.segment } : { ...live, text: live.text + ev.delta } };
    case "reset":
      return { ...s, live: { text: "", segment: 0, steps: [] } };
    case "step_start":
      return { ...s, live: { ...live, steps: [...live.steps, { id: ev.id, label: ev.label, done: false, ok: true, readOnly: ev.readOnly }] } };
    case "step_end":
      return {
        ...s,
        live: { ...live, steps: live.steps.map((st) => (st.id === ev.id ? { ...st, done: true, ok: ev.ok, display: ev.display, action: ev.action, undo: ev.undo, readOnly: ev.readOnly } : st)) },
        actions: ev.action ? { ...s.actions, [ev.action.id]: ev.action } : s.actions,
      };
    case "done":
      return {
        ...s,
        conversationId: ev.conversationId,
        title: ev.title ?? s.title,
        messages: [...s.messages.filter((m) => m.id !== optimisticId && m.id !== ev.userMessage.id), ev.userMessage, ev.assistantMessage],
        actions: { ...s.actions, ...(ev.actions ?? {}) },
        live: null,
        sending: false,
        error: ev.error ?? null,
      };
    case "error":
      return { ...s, live: null, sending: false, error: ev.message };
  }
  return s;
}

/** The person-facing lines of a saved reply's steps. */
export function visibleSteps(events: ToolEvent[]): ToolEvent[] {
  return events.filter((e) => e.action_id || (e.display && !e.unchanged));
}
