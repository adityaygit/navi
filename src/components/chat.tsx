"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Message } from "@/lib/types";
import { announceChange, newClientId, offlineQueue, flushQueue } from "@/lib/offline-queue";
import { VoiceSession } from "./voice-session";

type AiStatus = { ready: boolean; mode: string; reason?: string };

export function Chat({
  kind,
  initialMessages,
  ai,
  voice,
  compact = false,
  placeholder,
}: {
  kind: "chat" | "onboarding";
  initialMessages: Message[];
  ai: AiStatus;
  voice: { ready: boolean; reason?: string };
  compact?: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const draftKey = `navi:chat-draft:${kind}`;

  useEffect(() => {
    try { setText(localStorage.getItem(draftKey) ?? ""); } catch {}
  }, [draftKey]);
  useEffect(() => setMessages(initialMessages), [initialMessages]);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages.length]);

  function setDraft(v: string) {
    setText(v);
    try { localStorage.setItem(draftKey, v); } catch {}
  }

  async function send(content: string, modality: "text" | "voice" = "text") {
    const value = content.trim();
    if (!value || sending) return;
    setError(null);
    if (!navigator.onLine) {
      // Conversation needs the network; keep the words safe as a capture instead.
      await offlineQueue.add({ client_id: newClientId(), raw_text: value, source: "offline", captured_at: new Date().toISOString(), attempts: 0 });
      setDraft("");
      setError("You're offline, so Navi can't reply. Your message was saved as a capture and will sync to your inbox.");
      return;
    }
    setSending(true);
    const optimistic: Message = { id: `tmp-${Date.now()}`, conversation_id: "", role: "user", content: value, modality, tool_events: [], created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setDraft("");
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, text: value, modality }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), body.userMessage, body.assistantMessage]);
      if (body.mutated) {
        announceChange();
        router.refresh();
      }
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setDraft(value);
      setError(err instanceof Error ? err.message : "Couldn't reach Navi. Your message is still in the box.");
      void flushQueue();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${compact ? "" : "gap-3"}`}>
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && (
          <p className="muted text-sm">
            {kind === "onboarding" ? "Say hi to start. You can type or talk." : "Ask Navi anything, dump what's on your mind, or say “plan my day”."}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[15px] ${m.role === "user" ? "bg-accent text-accent-text" : "border border-border bg-surface"}`}>
              {m.content}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {m.modality === "voice" && <span className="badge">voice</span>}
              {m.tool_events?.map((e, i) => (
                <span key={i} className={`badge ${e.ok ? "badge-ok" : "badge-danger"}`} title={e.name}>
                  {e.summary}
                </span>
              ))}
            </div>
          </div>
        ))}
        {sending && <div className="muted text-sm" role="status">Navi is thinking…</div>}
        <div ref={endRef} />
      </div>
      {error && <p role="alert" className="notice notice-danger text-sm">{error}</p>}
      {voiceOpen && (
        <VoiceSession
          kind={kind}
          onClose={() => setVoiceOpen(false)}
          onTurnSaved={() => {
            announceChange();
            router.refresh();
          }}
        />
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor={`chat-input-${kind}`} className="sr-only">Message Navi</label>
        <textarea
          id={`chat-input-${kind}`}
          rows={compact ? 2 : 2}
          className="input min-h-11 flex-1 resize-none"
          placeholder={placeholder ?? "Message Navi"}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => setVoiceOpen((v) => !v)}
          aria-pressed={voiceOpen}
          title={voice.ready ? "Talk to Navi" : voice.reason}
        >
          {voiceOpen ? "Close voice" : "Talk"}
        </button>
        <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
