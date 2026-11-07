"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Message } from "@/lib/types";
import type { ActionView } from "@/lib/actions";
import { Chat } from "../chat";
import { Stone } from "./stone";
import { usePanel } from "./panel-context";
import { viewingLabel } from "@/lib/viewing";
import { createChatAction } from "@/app/(app)/client-actions";

type AiStatus = { ready: boolean; mode: string; reason?: string };

/**
 * The Navi panel: one conversation that stays put while the person moves
 * between pages. It lives in the app layout, so the conversation, a half-typed
 * message and a live voice session all survive navigation. Collapsed, it is a
 * slim dock that says what's waiting. During focus it closes on its own and
 * holds non-urgent things; the saved open/closed choice is untouched, so it
 * comes back as it was when focus ends.
 */
export function NaviPanel({
  zone,
  conversation,
  ai,
  voice,
  focus,
}: {
  zone: string;
  conversation: { id: string | null; messages: Message[]; actions: Record<string, ActionView>; undone: string[] };
  ai: AiStatus;
  voice: { ready: boolean; reason?: string };
  /** An open focus session, and how many new things arrived since it began. */
  focus: { waiting: number } | null;
}) {
  const path = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const panel = usePanel();
  const [voiceLive, setVoiceLive] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [unread, setUnread] = useState(0);
  const [endVoice, setEndVoice] = useState(0);
  const [startVoice, setStartVoice] = useState(0);
  const [creating, startCreating] = useTransition();

  const isHome = path === "/";
  const inFocus = !!focus && path === "/focus";
  // Leaving Home closes a panel that was only opened from Home's box.
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    if (lastPath === "/" && panel.homeOpen) panel.setHomeOpen(false);
  }
  const open = inFocus ? false : isHome ? panel.homeOpen : panel.pref === "open";
  const viewing = viewingLabel(path, search, zone);

  const onReply = useCallback(() => {
    if (!open) setUnread((n) => n + 1);
  }, [open]);
  const onVoiceChange = useCallback((v: boolean) => setVoiceLive(v), []);
  const onDraftChange = useCallback((v: boolean) => setHasDraft(v), []);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setUnread(0);
  }

  // Home's "Talk" button.
  useEffect(() => {
    const onStart = () => setStartVoice((n) => n + 1);
    window.addEventListener("navi:start-voice", onStart);
    return () => window.removeEventListener("navi:start-voice", onStart);
  }, []);

  // Ctrl/⌘ + J toggles the panel (same key on Windows and Mac).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (isHome) panel.setHomeOpen(!panel.homeOpen);
        else panel.setPref(panel.pref === "open" ? "collapsed" : "open");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHome, panel]);

  if (path.startsWith("/chat")) return null;

  const show = () => (isHome ? panel.setHomeOpen(true) : panel.setPref("open"));
  const hide = () => (isHome ? panel.setHomeOpen(false) : panel.setPref("collapsed"));
  // Home without the panel open shows nothing here: Home has its own box.
  const dockVisible = !open && !(isHome && !voiceLive);

  return (
    <>
      <aside
        aria-label="Navi"
        hidden={!open}
        className="relative my-2.5 mr-2.5 hidden w-[380px] shrink-0 flex-col rounded-[28px] border border-white/[0.08] bg-[#0B0B0C] md:flex [&[hidden]]:!hidden"
      >
        <header className="flex items-center gap-3 px-[18px] pb-2 pt-4">
          <Stone size={30} lit live={voiceLive} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold">Navi</span>
            <span className="mt-0.5 inline-flex w-fit max-w-full items-center gap-1.5 truncate rounded-full bg-white/[0.06] px-2 py-0.5 text-[12px] text-dim" aria-live="polite">
              Looking at · {viewing}
            </span>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-dim hover:bg-white/[0.06] hover:text-text disabled:opacity-40"
            aria-label="New chat"
            title="New chat"
            disabled={creating || voiceLive}
            onClick={() => startCreating(async () => { await createChatAction(); router.refresh(); })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button type="button" onClick={hide} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.05] text-dim hover:text-text" aria-label="Close the Navi panel (Ctrl J)" title="Close (Ctrl J)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          <Chat
            kind="chat"
            variant="panel"
            conversationId={conversation.id}
            initialMessages={conversation.messages}
            initialActions={conversation.actions}
            initialUndone={conversation.undone}
            ai={ai}
            voice={voice}
            viewing={viewing}
            onReply={onReply}
            onVoiceChange={onVoiceChange}
            onDraftChange={onDraftChange}
            endVoiceSignal={endVoice}
            startVoiceSignal={startVoice}
          />
        </div>
      </aside>

      {dockVisible && (
        <div className="hidden w-[68px] shrink-0 flex-col items-center gap-3 pt-6 md:flex" aria-label="Navi, closed">
          <button type="button" onClick={show} className="relative rounded-full" aria-label={`Open Navi${unread ? `, ${unread} new` : hasDraft ? ", unsent message" : ""}`} title="Open Navi (Ctrl J)">
            <Stone size={36} lit live={voiceLive} className={inFocus ? "opacity-50 grayscale" : ""} />
            {unread > 0 && !inFocus && <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-text px-1 text-[11px] font-bold text-black">{unread}</span>}
            {!unread && hasDraft && !inFocus && (
              <span className="absolute -bottom-1 -right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-black bg-[#2A2A2E]" aria-hidden="true">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#F5F5F7" strokeWidth="2.6" strokeLinecap="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
              </span>
            )}
          </button>
          {inFocus && focus.waiting > 0 && <span className="text-center text-[12px] leading-tight text-dim">{focus.waiting}<br />waiting</span>}
          {voiceLive ? (
            <>
              <span className="text-[12px] font-medium text-[var(--navi-text)]" role="status">Live</span>
              <button type="button" onClick={() => setEndVoice((n) => n + 1)} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F2A7A0] text-black" aria-label="End voice">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 14c4-4 12-4 16 0l-2 2.5-3-1.5v-2c-2-.6-4-.6-6 0v2l-3 1.5z" /></svg>
              </button>
            </>
          ) : (
            !inFocus && (
              <button
                type="button"
                onClick={() => {
                  show();
                  setStartVoice((n) => n + 1);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-text hover:bg-white/[0.1]"
                aria-label="Talk to Navi"
                title={voice.ready ? "Talk to Navi" : voice.reason}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
              </button>
            )
          )}
        </div>
      )}
    </>
  );
}
