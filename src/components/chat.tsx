"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Message } from "@/lib/types";
import { announceChange, newClientId, offlineQueue, flushQueue } from "@/lib/offline-queue";
import { readChatStream, CHAT_STREAM_CONTENT_TYPE, type ChatStreamEvent, type TurnDone } from "@/lib/chat-stream";
import { VoiceSession } from "./voice-session";
import { LiveNavi, NaviMessage, UserBubble, type LiveItem } from "./chat-turn";
import { ActionsContext } from "./action-card";
import type { ActionView } from "@/lib/actions";
import { Pebble } from "./pebble";
import { createChatAction } from "@/app/(app)/actions";
import { usePanelOptional } from "./shell/panel-context";

/** A failed turn, with the server's reason code when it gave one (see /api/chat). */
class TurnError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

type AiStatus = { ready: boolean; mode: string; reason?: string };

// Stable defaults: fresh {} / [] each render would look like new server data every time.
const NO_ACTIONS: Record<string, ActionView> = {};
const NO_UNDONE: string[] = [];

/** Applies one stream event to the live reply being drawn. */
function applyEvent(items: LiveItem[], event: ChatStreamEvent, nextChunk: () => number): LiveItem[] {
  switch (event.type) {
    case "reset":
      return [];
    case "step_start":
      if (items.some((i) => i.kind === "step" && i.id === event.id)) return items;
      return [...items, { kind: "step", id: event.id, name: event.name, label: event.label, readOnly: event.readOnly, status: "running" }];
    case "step_end":
      return items.map((i) => (i.kind === "step" && i.id === event.id ? { ...i, status: event.ok ? "ok" : "failed", doneLabel: event.label, summary: event.summary, action: event.action } : i));
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
  initialActions = NO_ACTIONS,
  initialUndone = NO_UNDONE,
  ai,
  voice,
  placeholder,
  variant = "page",
  viewing,
  onVoiceChange,
  onDraftChange,
  onReply,
  endVoiceSignal = 0,
  startVoiceSignal = 0,
  emptyState,
  header,
  notice,
  loading = false,
  focusSignal = 0,
  onConversationChange,
}: {
  kind: "chat" | "onboarding";
  /** The chat being continued; null starts a new chat on the first message. Unused for onboarding. */
  conversationId?: string | null;
  initialMessages: Message[];
  /** Cards for the actions these messages proposed, as they are now. */
  initialActions?: Record<string, ActionView>;
  /** Automatic changes in these messages that were already undone. */
  initialUndone?: string[];
  ai: AiStatus;
  voice: { ready: boolean; reason?: string };
  placeholder?: string;
  /**
   * "panel": the Navi panel beside other pages (compact composer).
   * "center": the chat in the centre of Home, under Home's own header.
   */
  variant?: "page" | "panel" | "center";
  /** What the person has open ("My day, Friday"), sent with each message. */
  viewing?: string;
  onVoiceChange?: (live: boolean) => void;
  onDraftChange?: (hasDraft: boolean) => void;
  /** Called when a reply from Navi has been added. */
  onReply?: () => void;
  /** Changing this number ends a voice session from outside (the dock's hang-up). */
  endVoiceSignal?: number;
  /** Changing this number starts voice from outside (the dock's microphone). */
  startVoiceSignal?: number;
  /** Shown instead of the default hint while there are no messages. */
  emptyState?: React.ReactNode;
  /** Centre only: Home's greeting and cards, at the top of the scroll area (dimmed once the chat starts). */
  header?: React.ReactNode;
  /** A line above the conversation (e.g. "That chat doesn't exist anymore"). */
  notice?: React.ReactNode;
  /** The chat's messages are still loading. */
  loading?: boolean;
  /** Changing this number puts the cursor in the message box (New chat). */
  focusSignal?: number;
  /** A new chat was created by its first message (or for voice). */
  onConversationChange?: (id: string) => void;
}) {
  const panel = usePanelOptional();
  const isPanel = variant === "panel";
  const isCenter = variant === "center";
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
      // Another chat (or a new one): its own messages, read from the bottom.
      setMessages(initialMessages);
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
    setSeenConv(id);
    // The shell points the URL (on Home) and the sidebar list at it.
    onConversationChange?.(id);
  }

  async function openVoice() {
    if (voiceOpen || kind !== "chat" || conversationId) return setVoiceOpen((v) => !v);
    // Voice needs a conversation to save into before it starts.
    const r = await createChatAction();
    if (!r.ok || !r.data) return setError(r.ok ? "Couldn't start a new chat" : r.error);
    adopt(r.data);
    setVoiceOpen(true);
  }

  // Action cards: the server's view, updated by taps, stream events and refreshes.
  const [actions, setActions] = useState<Record<string, ActionView>>(initialActions);
  const [undone, setUndone] = useState<Set<string>>(() => new Set(initialUndone));

  // Adopt fresh server data (after router.refresh) without an extra effect pass.
  const [seenInitial, setSeenInitial] = useState(initialMessages);
  if (seenInitial !== initialMessages) {
    setSeenInitial(initialMessages);
    // Mid-turn, the in-flight messages stay until the turn settles.
    if (!sending) setMessages(initialMessages);
  }
  const [seenActions, setSeenActions] = useState(initialActions);
  if (seenActions !== initialActions) {
    setSeenActions(initialActions);
    setActions((a) => ({ ...a, ...initialActions }));
  }
  const [seenUndone, setSeenUndone] = useState(initialUndone);
  if (seenUndone !== initialUndone) {
    setSeenUndone(initialUndone);
    setUndone((u) => new Set([...u, ...initialUndone]));
  }

  // Each action is shown in full on the newest message that mentions it (e.g.
  // after "make it Friday" the updated card sits under that reply); older
  // mentions shrink to one line, so it's always clear which card to tap.
  const actionState = useMemo(() => {
    const latest = new Map<string, string>();
    for (const m of messages) for (const e of m.tool_events ?? []) if (e.action_id) latest.set(e.action_id, m.id);
    for (const i of live ?? []) if (i.kind === "step" && i.action) latest.set(i.action.id, "live");
    return {
      actions,
      setAction: (v: ActionView) => setActions((a) => ({ ...a, [v.id]: v })),
      undone,
      markUndone: (ids: string[]) => setUndone((u) => new Set([...u, ...ids])),
      latest,
    };
  }, [actions, undone, messages, live]);
  useEffect(() => {
    // Restoring an unsent draft from this device's storage (an external system).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setText(localStorage.getItem(draftKey) ?? ""); } catch {}
  }, [draftKey]);
  // Follow the conversation as it grows, unless the person scrolled up to read.
  // Another chat opens at its newest message.
  useLayoutEffect(() => {
    stick.current = true;
  }, [conversationId]);
  // A new chat in the centre starts at the top, where Home's header is.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (isCenter && messages.length === 0 && !live) el.scrollTop = 0;
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, live, isCenter]);

  function setDraft(v: string) {
    setText(v);
    try { localStorage.setItem(draftKey, v); } catch {}
  }

  // Tell the dock about a half-typed message and a live voice session.
  useEffect(() => onDraftChange?.(text.trim().length > 0), [text, onDraftChange]);
  useEffect(() => onVoiceChange?.(voiceOpen), [voiceOpen, onVoiceChange]);
  const [seenEnd, setSeenEnd] = useState(endVoiceSignal);
  if (seenEnd !== endVoiceSignal) {
    setSeenEnd(endVoiceSignal);
    setVoiceOpen(false);
  }

  useEffect(() => {
    // A request from outside (the dock's microphone), not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (startVoiceSignal && !voiceOpen) void openVoice();
    // Only a new signal starts voice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startVoiceSignal]);

  // The same message sent again (after a failure) reuses its id, so the server
  // can tell a retry from a new message and never answers it twice.
  const retry = useRef<{ text: string; id: string } | null>(null);

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
    const clientMessageId = retry.current?.text === value ? retry.current.id : crypto.randomUUID();
    retry.current = { text: value, id: clientMessageId };
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
        body: JSON.stringify({ kind, conversationId, text: value, modality, stream: true, clientMessageId, ...(viewing ? { viewing } : {}) }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new TurnError(body.error ?? `Error ${res.status}`, body.code);
      }
      if (!(res.headers.get("content-type") ?? "").includes(CHAT_STREAM_CONTENT_TYPE)) {
        turn.done = (await res.json()) as TurnDone; // a server that answered in one piece
      } else {
        let failure: TurnError | null = null;
        await readChatStream(res.body, (event) => {
          if (event.type === "user") {
            const userMessage = event.userMessage;
            turn.saved = userMessage;
            setMessages((m) => m.map((x) => (x.id === optimistic.id ? userMessage : x)));
          } else if (event.type === "done") turn.done = event;
          else if (event.type === "error") failure = new TurnError(event.message, event.code);
          else {
            // A step that proposed or changed an action carries its newest card.
            if (event.type === "step_end" && event.action) {
              const view = event.action;
              setActions((a) => ({ ...a, [view.id]: view }));
            }
            setLive((items) => applyEvent(items ?? [], event, () => ++chunkId.current));
          }
        });
        if (failure) throw failure;
      }
      const result = turn.done;
      if (!result) throw new TypeError("stream ended early");
      retry.current = null;
      // One update: the live reply is replaced by the saved one (announced once).
      setLive(null);
      if (result.actions) setActions((a) => ({ ...a, ...result.actions }));
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id && x.id !== result.userMessage.id), result.userMessage, result.assistantMessage]);
      const isNew = kind === "chat" && result.conversationId !== conversationId;
      if (result.mutated) announceChange();
      onReply?.();
      if (isNew) adopt(result.conversationId);
      // Chats re-sort by recent activity, so refresh the list as well as any changed data.
      else if (result.mutated || kind === "chat") router.refresh();
    } catch (err) {
      setLive(null);
      const code = err instanceof TurnError ? err.code : undefined;
      if (code === "turn_in_progress") {
        // This exact message reached Navi before and is still being answered.
        retry.current = null;
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        setError("Navi is still answering that message. Its reply will show here.");
        router.refresh();
      } else if (code === "turn_incomplete") {
        // An earlier attempt died without a reply: send it again as a new message.
        retry.current = null;
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        if (fromDraft) setDraft(value);
        setError("That message didn't get an answer. It's back in the box; send it again.");
      } else if (turn.saved) {
        retry.current = null;
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

  // A page asked Navi something (Home's box, "Ask Navi to help", the palette).
  const shared = isPanel || isCenter;
  const ask = shared ? panel?.pendingAsk : null;
  const draftAsk = shared ? panel?.pendingDraft : null;
  useEffect(() => {
    if (!ask || sending) return;
    panel?.consume(ask.id);
    // A message handed over by a page (Home's box, the palette), sent once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void send(ask.text, "text", false);
    // send is recreated each render; the ask id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.id, sending]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!draftAsk) return;
    panel?.consume(draftAsk.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(draftAsk.text);
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftAsk?.id]);
  // New chat: the cursor goes to the box (after the centre/panel box is drawn).
  const focused = useRef(0);
  useEffect(() => {
    if (!focusSignal || focused.current === focusSignal || !inputRef.current) return;
    focused.current = focusSignal;
    inputRef.current.focus();
  }, [focusSignal, variant]);

  const hasChat = messages.length > 0 || !!live;
  const keySend = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(text);
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  const micIcon = <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;
  const sendIcon = (size: number) => <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>;

  const unavailable = !ai.ready && (
    <p className="notice notice-warn" role="status">
      Navi's AI isn't available: {ai.reason} You can still use the dashboard and capture to your inbox.
    </p>
  );
  const devsim = ai.mode === "devsim" && (
    <p className="notice notice-warn text-xs" role="status">
      Development mode: replies come from a rule-based simulator, not a real AI model.
    </p>
  );
  const turns = (
    <>
      {messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} message={m} /> : <NaviMessage key={m.id} message={m} />))}
      {live && <LiveNavi items={live} />}
      {sending && <div className="sr-only" role="status">Navi is thinking…</div>}
    </>
  );
  const errorLine = error && <p role="alert" className="notice notice-danger text-sm">{error}</p>;
  const voicePanel = voiceOpen && (
    <VoiceSession
      kind={kind}
      conversationId={kind === "chat" ? conversationId : null}
      onClose={() => setVoiceOpen(false)}
      onTurnSaved={() => {
        announceChange();
        router.refresh();
      }}
    />
  );
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // The centre of Home: Home's own header at the top of one scroll area, the
  // conversation under it, and the box at the bottom.
  if (isCenter) {
    return (
      <ActionsContext.Provider value={actionState}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={logRef} onScroll={onScroll} className="chat-log min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 md:px-10" role="region" aria-label="Home and conversation" tabIndex={0}>
            {header && <div className={`transition-opacity duration-300 ${hasChat ? "opacity-40 hover:opacity-100 focus-within:opacity-100" : ""}`}>{header}</div>}
            <div className={`mx-auto flex w-full max-w-[720px] flex-col gap-6 ${hasChat || notice || loading ? "pb-6 pt-8" : ""}`} role="log" aria-live="polite" aria-label="Conversation" data-chat-turns>
              {notice}
              {hasChat && devsim}
              {loading && !hasChat && <p className="text-[15px] text-dim" role="status">Opening the chat…</p>}
              {turns}
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-[720px] shrink-0 flex-col gap-3 px-4 pb-7 pt-2 md:px-0">
            {unavailable}
            {errorLine}
            {voicePanel}
            <form
              className="composer flex min-h-[58px] w-full items-end gap-2.5 rounded-[29px] border border-white/[0.09] bg-[rgba(28,28,31,0.92)] py-2 pl-5 pr-2 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
              onSubmit={submit}
            >
              <label htmlFor="chat-input-center" className="sr-only">Message Navi</label>
              <textarea
                id="chat-input-center"
                ref={inputRef}
                rows={1}
                className="bare-field max-h-48 min-h-[42px] min-w-0 flex-1 resize-none px-0 py-[10px] text-[15px] leading-snug text-text [field-sizing:content] placeholder:text-[#8E8E96]"
                placeholder={placeholder ?? "Tell Navi anything — a plan, a worry, a to-do"}
                value={text}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={keySend}
              />
              {text.trim() ? (
                <button type="submit" aria-label="Send" disabled={sending} className="flex h-[42px] shrink-0 items-center gap-2 rounded-[21px] bg-text px-4 font-semibold text-black disabled:opacity-40">
                  Send
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void openVoice()}
                  aria-pressed={voiceOpen}
                  title={voice.ready ? "Talk to Navi" : voice.reason}
                  className="flex h-[42px] shrink-0 items-center gap-2 rounded-[21px] bg-[var(--navi-text)] px-4 font-semibold text-[var(--navi-ink)]"
                >
                  {micIcon}
                  {voiceOpen ? "Close voice" : "Talk"}
                </button>
              )}
            </form>
          </div>
        </div>
      </ActionsContext.Provider>
    );
  }

  return (
    <ActionsContext.Provider value={actionState}>
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {unavailable}
      {devsim}
      <div
        ref={logRef}
        onScroll={onScroll}
        className="chat-log flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain py-3 pr-1"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        // Scrollable, so reachable by keyboard.
        tabIndex={0}
      >
        {notice}
        {loading && !hasChat && <p className="m-auto text-[14px] text-dim" role="status">Opening the chat…</p>}
        {!hasChat && !loading && emptyState}
        {!hasChat && !loading && !emptyState && (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 py-8 text-center">
            {!isPanel && <Pebble size={56} mood="idle" float />}
            <p className="muted text-[15px]">
              {kind === "onboarding" ? "Say hi to start. You can type or talk." : isPanel ? "Ask about what's on this page, or tell Navi anything." : "Ask Navi anything, dump what's on your mind, or say “plan my day”."}
            </p>
          </div>
        )}
        {turns}
      </div>
      {errorLine}
      {voicePanel}
      {isPanel ? (
        <form className="flex shrink-0 items-end gap-2 rounded-[26px] border border-white/[0.08] bg-white/[0.06] py-1.5 pl-[18px] pr-1.5" onSubmit={submit}>
          <label htmlFor="panel-input" className="sr-only">Message Navi</label>
          <textarea
            id="panel-input"
            ref={inputRef}
            rows={1}
            className="max-h-40 min-h-10 bare-field flex-1 resize-none px-0 py-2.5 text-[15px] leading-snug text-text [field-sizing:content] placeholder:text-dim"
            placeholder={placeholder ?? "Talk to Navi…"}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keySend}
          />
          {text.trim() ? (
            <button type="submit" aria-label="Send" disabled={sending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-text text-black disabled:opacity-40">
              {sendIcon(16)}
            </button>
          ) : (
            <button type="button" onClick={() => void openVoice()} aria-pressed={voiceOpen} aria-label={voiceOpen ? "End voice" : "Talk to Navi"} title={voice.ready ? "Talk to Navi" : voice.reason} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${voiceOpen ? "bg-[var(--navi-text)] text-black" : "bg-white/[0.08] text-text"}`}>
              {micIcon}
            </button>
          )}
        </form>
      ) : (
      <form
        className={`lg composer flex shrink-0 gap-1 rounded-[22px] py-2 pl-4 pr-2 md:flex-col md:items-stretch md:py-3 md:pl-5 md:pr-3 ${text ? "flex-col" : "items-center"}`}
        onSubmit={submit}
      >
        <label htmlFor={`chat-input-${kind}`} className="sr-only">Message Navi</label>
        <textarea
          id={`chat-input-${kind}`}
          ref={inputRef}
          rows={1}
          className={`max-h-32 min-h-11 w-full min-w-0 bare-field resize-none ${text ? "" : "flex-1 md:flex-none"} px-0 py-2 md:max-h-40 text-[17px] leading-snug text-text [field-sizing:content] placeholder:text-dim`}
          placeholder={placeholder ?? "Tell Navi anything…"}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={keySend}
        />
        <div className="flex shrink-0 items-center justify-end gap-2">
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
            {sendIcon(18)}
          </button>
        </div>
      </form>
      )}
    </div>
    </ActionsContext.Provider>
  );
}
