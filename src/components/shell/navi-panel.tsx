"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Chat } from "../chat";
import { Stone } from "./stone";
import { usePanel } from "./panel-context";
import { useChatSession } from "./chat-session";
import { viewingLabel } from "@/lib/viewing";
import { chatHref } from "@/lib/chat-session";

type AiStatus = { ready: boolean; mode: string; reason?: string };

/**
 * Everything right of the sidebar. On Home the conversation is the page: Home's
 * greeting and cards sit at the top of the chat's scroll area and the box is at
 * the bottom. On every other page the page is in the middle and the same
 * conversation is in the Navi panel on the right (collapsible; closed during
 * focus).
 *
 * The chat is one component instance in the same place in the tree on every
 * page, so the conversation, a half-typed message, a reply still streaming and
 * a live voice session all survive moving between Home and other pages.
 */
export function Workspace({
  zone,
  banner,
  ai,
  voice,
  focus,
  children,
}: {
  zone: string;
  banner: React.ReactNode;
  ai: AiStatus;
  voice: { ready: boolean; reason?: string };
  /** An open focus session, and how many new things arrived since it began. */
  focus: { waiting: number } | null;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const panel = usePanel();
  const session = useChatSession();
  const [voiceLive, setVoiceLive] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [unread, setUnread] = useState(0);
  const [endVoice, setEndVoice] = useState(0);
  const [startVoice, setStartVoice] = useState(0);

  const isHome = session.isHome;
  const inFocus = !!focus && path === "/focus";
  const open = isHome || (!inFocus && panel.pref === "open");
  const viewing = viewingLabel(path, search, zone);
  const mode = isHome ? "center" : "panel";

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

  // Ctrl/⌘ + J toggles the panel (same key on Windows and Mac). Home has no panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "j" && !isHome) {
        e.preventDefault();
        panel.setPref(panel.pref === "open" ? "collapsed" : "open");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHome, panel]);

  // A link inside the chat that opens another page: offer the way back.
  const onChatClick = (e: React.MouseEvent) => {
    if (!isHome || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href || !href.startsWith("/") || a.target === "_blank") return;
    const to = new URL(href, window.location.origin).pathname;
    // Links in Home's own header are Home, not Navi.
    if (to === "/" || !a.closest("[data-chat-turns]")) return;
    // Stay in the app (no reload), so the chat and the way back survive.
    e.preventDefault();
    session.markFromChat(to);
    router.push(href);
  };

  const { data } = session;
  const backHref = chatHref(session.currentId);
  const missingNotice = data.missing ? (
    <p className="notice notice-warn text-sm" role="status">That chat doesn&apos;t exist anymore. Here&apos;s a new one.</p>
  ) : null;
  const fromChat = !isHome && session.fromChat?.to === path;

  return (
    <>
      {!isHome && (
        <div className="shell-main flex flex-col">
          {banner}
          {fromChat && (
            <div className="px-4 pt-4 md:px-10">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#1C1C1F] py-1 pl-3.5 pr-1 text-[13px] text-dim" role="status">
                <Stone size={12} />
                Navi opened {viewing}
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => router.back()} className="rounded-full px-2.5 py-1 font-medium text-text hover:bg-white/[0.06]">
                  Back to chat
                </button>
              </p>
            </div>
          )}
          <main id="main" className="app-main mx-auto w-full max-w-[1120px] flex-1 px-4 pb-44 md:px-10 md:pb-16">{children}</main>
        </div>
      )}
      <div
        // The same element on every page (only its role and size change), so the chat inside stays mounted.
        role={isHome ? "main" : "complementary"}
        id={isHome ? "main" : undefined}
        aria-label={isHome ? undefined : "Navi"}
        hidden={!open}
        onClickCapture={onChatClick}
        className={
          isHome
            ? "flex h-dvh min-w-0 flex-1 flex-col"
            : "relative my-2.5 mr-2.5 hidden w-[380px] shrink-0 flex-col rounded-[28px] border border-white/[0.08] bg-[#0B0B0C] md:flex [&[hidden]]:!hidden"
        }
      >
        {isHome ? (
          <>
            {banner}
            <div className="mx-auto flex h-14 w-full max-w-[720px] shrink-0 items-center px-4 md:px-0">
              {session.currentId && !data.missing && (
                <h2 className="truncate text-[15px] font-semibold text-[#C8C8CE]" title={session.title ?? undefined}>
                  <span className="sr-only">Chat: </span>
                  {session.title || "New chat"}
                </h2>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2.5 px-[18px] pb-2 pt-4">
            <div className="flex items-center gap-3">
              <Stone size={30} lit live={voiceLive} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={session.title ?? undefined}>{session.title || "Navi"}</span>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-dim hover:bg-white/[0.06] hover:text-text disabled:opacity-40"
                aria-label="New chat"
                title="New chat"
                disabled={voiceLive}
                onClick={session.startBlank}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              <button type="button" onClick={() => panel.setPref("collapsed")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-dim hover:text-text" aria-label="Close the Navi panel (Ctrl J)" title="Close (Ctrl J)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-dim" aria-live="polite">
                Looking at · {viewing}
              </span>
              <Link
                href={backHref}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.07] pl-2.5 pr-3.5 text-[13px] font-medium text-text hover:bg-white/[0.11]"
                title="Open this chat in the middle of Home"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6 9 12l6 6" /></svg>
                Back to chat
              </Link>
            </div>
          </div>
        )}
        <div className={isHome ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1 flex-col px-4 pb-4"}>
          <Chat
            kind="chat"
            variant={mode}
            header={isHome ? children : null}
            notice={missingNotice}
            loading={!!data.pending}
            conversationId={data.missing ? null : data.id}
            initialMessages={data.messages}
            initialActions={data.actions}
            initialUndone={data.undone}
            ai={ai}
            voice={voice}
            viewing={viewing}
            onReply={onReply}
            onVoiceChange={onVoiceChange}
            onDraftChange={onDraftChange}
            onConversationChange={session.adopt}
            focusSignal={session.focusRequest.where === mode ? session.focusRequest.n : 0}
            endVoiceSignal={endVoice}
            startVoiceSignal={startVoice}
          />
        </div>
      </div>

      {!open && (
        <div className="hidden w-[68px] shrink-0 flex-col items-center gap-3 pt-6 md:flex" aria-label="Navi, closed" role="group">
          <button type="button" onClick={() => panel.setPref("open")} className="relative rounded-full" aria-label={`Open Navi${unread ? `, ${unread} new` : hasDraft ? ", unsent message" : ""}`} title="Open Navi (Ctrl J)">
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
                  panel.setPref("open");
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
