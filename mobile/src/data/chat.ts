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
};

type ChatPayload = { id: string; title: string | null; messages: Message[]; actions: Record<string, ActionView>; undone: string[] };

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

export function useChat(initialId: string | null) {
  const [state, setState] = useState<ChatState>({ conversationId: initialId, title: null, messages: [], actions: {}, undone: new Set(), live: null, sending: false, error: null, loading: !!initialId });
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async (id: string | null) => {
    abort.current?.abort();
    if (!id) {
      setState((s) => ({ ...s, conversationId: null, title: null, messages: [], actions: {}, undone: new Set(), live: null, loading: false, error: null }));
      return;
    }
    // Switching chats: clear the old one at once, so nothing from it lingers.
    setState((s) => (s.conversationId === id ? { ...s, loading: true, error: null } : { ...s, conversationId: id, title: null, messages: [], actions: {}, undone: new Set(), live: null, loading: true, error: null }));
    try {
      const c = await api<ChatPayload>(`/api/m/chats/${id}/messages`);
      setState((s) => (s.conversationId !== id ? s : { ...s, title: c.title, messages: c.messages, actions: c.actions ?? {}, undone: new Set(c.undone ?? []), loading: false }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: "Couldn't open that chat. Check your connection and try again." }));
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

  const sendText = useCallback(async (text: string, viewing?: string) => {
    const clientMessageId = uuid();
    const optimistic: Message = { id: `local-${clientMessageId}`, conversation_id: "", role: "user", content: text, modality: "text", tool_events: [], created_at: new Date().toISOString(), client_id: clientMessageId };
    let conversationId: string | null = null;
    setState((s) => {
      conversationId = s.conversationId;
      return { ...s, messages: [...s.messages, optimistic], live: { text: "", segment: 0, steps: [] }, sending: true, error: null };
    });
    const ctl = new AbortController();
    abort.current = ctl;
    const apply = (ev: ChatStreamEvent) => {
      setState((s) => reduce(s, ev, optimistic.id));
      if (ev.type === "done" && ev.mutated) feel("success");
    };
    try {
      const res = await rawSend("/api/chat", { body: { text, conversationId, stream: true, clientMessageId, viewing: viewing ?? null }, signal: ctl.signal });
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

  return { state, load, sendText, undo, decide };
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
