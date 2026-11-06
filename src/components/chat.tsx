"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Message } from "@/lib/types";
import { announceChange, newClientId, offlineQueue, flushQueue } from "@/lib/offline-queue";
import { readChatStream, CHAT_STREAM_CONTENT_TYPE, type ChatStreamEvent, type TurnDone } from "@/lib/chat-stream";
import { VoiceSession } from "./voice-session";
import { LiveNavi, NaviMessage, UserBubble, type LiveItem, type PendingApproval } from "./chat-turn";
import { Pebble } from "./pebble";
import { createChatAction } from "@/app/(app)/actions";

type AiStatus = { ready: boolean; mode: string; reason?: string };

const QUICK_PROMPTS = ["My plan broke", "What's next?", "Review my day"];

/** Applies one stream event to the live reply being drawn. */
function applyEvent(items: LiveItem[], event: ChatStreamEvent, nextChunk: () => number): LiveItem[] {
  switch (event.type) {
    case "reset":
      return [];
    case "step_start":
      if (items.some((i) => i.kind === "step" && i.id === event.id)) return items;
      return [...items, { kind: "step", id: event.id, name: event.name, label: event.label, readOnly: event.readOnly, status: "running" }];
    case "step_end":
      return items.map((i) => (i.kind === "step" && i.id === event.id ? { ...i, status: event.ok ? "ok" : "failed", doneLabel: event.label, summary: event.summary } : i));
    case "text": {
      const last = items[items.length - 1];
      const chunk = { id: nextChunk(), text: event.delta };
      if (last?.kind === "text" && last.segment === event.segment) return [...items.slice(0, -1), { ...last, chunks: [...last.chunks, chunk] }];
      return [...items, { kind: "text", segment: event.segment, chunks: [chunk] }];
    }
    default:
      return items;
  }
}

export function Chat({
  kind,
  conversationId: initialConversationId = null,
  initialMessages,
  approvals = [],
  ai,
  voice,
  placeholder,
}: {
  kind: "chat" | "onboarding";
  /** The chat being continued; null starts a new chat on the first message. Unused for onboarding. */
  conversationId?: string | null;
  initialMessages: Message[];
  /** Pending approvals, shown as cards on the reply that asked for them. */
  approvals?: PendingApproval[];
  ai: AiStatus;
  voice: { ready: boolean; reason?: string };
  placeholder?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // The reply being streamed; null when no turn is in flight.
  const [live, setLive] = useState<LiveItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const chunkId = useRef(0);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const draftKey = kind === "chat" ? `navi:chat-draft:chat:${conversationId ?? "new"}` : `navi:chat-draft:${kind}`;
  // Switched to another chat: anything bound to the old one (voice, errors) ends.
  const [seenConv, setSeenConv] = useState(initialConversationId);
  if (seenConv !== initialConversationId) {
    setSeenConv(initialConversationId);
    if (initialConversationId !== conversationId) {
      setConversationId(initialConversationId);
      setVoiceOpen(false);
      setError(null);
    }
  }

  /** A brand-new chat now exists on the server: point the URL (and the chat list) at it. */
  function adopt(id: string) {
    if (kind !== "chat" || id === conversationId) return;
    try {
      const pending = localStorage.getItem(draftKey);
      localStorage.removeItem(draftKey);
      if (pending) localStorage.setItem(`navi:chat-draft:chat:${id}`, pending);
    } catch {}
    setConversationId(id);
    router.replace(`/chat?c=${id}`, { scroll: false });
  }

  async function openVoice() {
    if (voiceOpen || kind !== "chat" || conversationId) return setVoiceOpen((v) => !v);
    // Voice needs a conversation to save into before it starts.
    const r = await createChatAction();
    if (!r.ok || !r.data) return setError(r.ok ? "Couldn't start a new chat" : r.error);
    adopt(r.data);
    setVoiceOpen(true);
  }

  // Adopt fresh server data (after router.refresh) without an extra effect pass.
  const [seenInitial, setSeenInitial] = useState(initialMessages);
  if (seenInitial !== initialMessages) {
    setSeenInitial(initialMessages);
    // Mid-turn, the in-flight messages stay until the turn settles.
    if (!sending) setMessages(initialMessages);
  }
  useEffect(() => {
    // Restoring an unsent draft from this device's storage (an external system).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setText(localStorage.getItem(draftKey) ?? ""); } catch {}
  }, [draftKey]);
  // Follow the conversation as it grows, unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  function setDraft(v: string) {
    setText(v);
    try { localStorage.setItem(draftKey, v); } catch {}
  }

  async function send(content: string, modality: "text" | "voice" = "text", fromDraft = true) {
    const value = content.trim();
    if (!value || sending) return;
    setError(null);
    if (!navigator.onLine) {
      // Conversation needs the network; keep the words safe as a capture instead.
      await offlineQueue.add({ client_id: newClientId(), raw_text: value, source: "offline", captured_at: new Date().toISOString(), attempts: 0 });
      if (fromDraft) setDraft("");
      setError("You're offline, so Navi can't reply. Your message was saved as a capture and will sync to your inbox.");
      return;
    }
    setSending(true);
    stick.current = true;
    const optimistic: Message = { id: `tmp-${++chunkId.current}`, conversation_id: "", role: "user", content: value, modality, tool_events: [], created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setLive([]);
    if (fromDraft) setDraft("");
    // Filled in by stream events: the user message once stored, and the finished turn.
    const turn: { saved: Message | null; done: TurnDone | null } = { saved: null, done: null };
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: CHAT_STREAM_CONTENT_TYPE },
        body: JSON.stringify({ kind, conversationId, text: value, modality, stream: true }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      if (!(res.headers.get("content-type") ?? "").includes(CHAT_STREAM_CONTENT_TYPE)) {
        turn.done = (await res.json()) as TurnDone; // a server that answered in one piece
      } else {
        let failure: string | null = null;
        await readChatStream(res.body, (event) => {
          if (event.type === "user") {
            const userMessage = event.userMessage;
            turn.saved = userMessage;
            setMessages((m) => m.map((x) => (x.id === optimistic.id ? userMessage : x)));
          } else if (event.type === "done") turn.done = event;
          else if (event.type === "error") failure = event.message;
          else setLive((items) => applyEvent(items ?? [], event, () => ++chunkId.current));
        });
        if (failure) throw new Error(failure);
      }
      const result = turn.done;
      if (!result) throw new TypeError("stream ended early");
      // One update: the live reply is replaced by the saved one (announced once).
      setLive(null);
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id && x.id !== result.userMessage.id), result.userMessage, result.assistantMessage]);
      const isNew = kind === "chat" && result.conversationId !== conversationId;
      if (result.mutated) announceChange();
      if (isNew) adopt(result.conversationId);
      // Chats re-sort by recent activity, so refresh the list as well as any changed data.
      else if (result.mutated || kind === "chat") router.refresh();
    } catch (err) {
      setLive(null);
      if (turn.saved) {
        // The message reached Navi and is stored; the reply may still land. Don't offer to resend it.
        setError(err instanceof Error && !(err instanceof TypeError) ? err.message : "Lost the connection while Navi was replying. Your message was saved; the reply will show here once it's done.");
        router.refresh();
      } else {
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        if (fromDraft) setDraft(value);
        // A network failure (TypeError) gets a plain explanation, not the browser's wording.
        setError(err instanceof Error && !(err instanceof TypeError) ? err.message : "Couldn't reach Navi, so there's no reply. Your message is still in the box; send it again when you're connected.");
      }
      void flushQueue();
    } finally {
      setSending(false);
    }
  }

  const quick = kind === "chat" && (
    <>
      {QUICK_PROMPTS.map((q) => (
        <button key={q} type="button" className="surf inline-flex h-9 shrink-0 items-center pointer-coarse:h-11 whitespace-nowrap rounded-full px-3.5 text-[14px] text-[#d8d9dc] transition-colors hover:text-text disabled:opacity-45" disabled={sending} onClick={() => void send(q, "text", false)}>
          {q}
        </button>
      ))}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!ai.ready && (
        <p className="notice notice-warn" role="status">
          Navi's AI isn't available: {ai.reason} You can still use the dashboard and capture to your inbox.
        </p>
      )}
      {ai.mode === "devsim" && (
        <p className="notice notice-warn text-xs" role="status">
          Development mode: replies come from a rule-based simulator, not a real AI model.
        </p>
      )}
      <div
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="chat-log flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain py-3 pr-1"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        // Scrollable, so reachable by keyboard.
        tabIndex={0}
      >
        {messages.length === 0 && !live && (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 py-8 text-center">
            <Pebble size={56} mood="idle" float />
            <p className="muted text-[15px]">
              {kind === "onboarding" ? "Say hi to start. You can type or talk." : "Ask Navi anything, dump what's on your mind, or say “plan my day”."}
            </p>
          </div>
        )}
        {messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} message={m} /> : <NaviMessage key={m.id} message={m} approvals={approvals} />))}
        {live && <LiveNavi items={live} />}
        {sending && <div className="sr-only" role="status">Navi is thinking…</div>}
      </div>
      {error && <p role="alert" className="notice notice-danger text-sm">{error}</p>}
      {voiceOpen && (
        <VoiceSession
          kind={kind}
          conversationId={kind === "chat" ? conversationId : null}
          onClose={() => setVoiceOpen(false)}
          onTurnSaved={() => {
            announceChange();
            router.refresh();
          }}
        />
      )}
      {quick && !voiceOpen && !text && <div className="chat-quick -mx-1 flex shrink-0 gap-2 overflow-x-auto px-1 md:hidden">{quick}</div>}
      <form
        className={`lg composer flex shrink-0 gap-1 rounded-[22px] py-2 pl-4 pr-2 md:flex-col md:items-stretch md:py-3 md:pl-5 md:pr-3 ${text ? "flex-col" : "items-center"}`}
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor={`chat-input-${kind}`} className="sr-only">Message Navi</label>
        <textarea
          id={`chat-input-${kind}`}
          rows={1}
          className={`max-h-32 min-h-11 w-full min-w-0 resize-none ${text ? "" : "flex-1 md:flex-none"} bg-transparent py-2 md:max-h-40 text-[17px] leading-snug text-text outline-none [field-sizing:content] placeholder:text-dim focus-visible:outline-none`}
          placeholder={placeholder ?? "Tell Navi anything…"}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden min-w-0 flex-1 flex-wrap gap-2 md:flex">{quick}</div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="btn h-11 gap-2 px-4"
              onClick={() => void openVoice()}
              aria-pressed={voiceOpen}
              title={voice.ready ? "Talk to Navi" : voice.reason}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
              {voiceOpen ? "Close voice" : "Talk"}
            </button>
            <button
              type="submit"
              aria-label="Send"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f2f2f2] text-[#060608] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={sending || !text.trim()}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
