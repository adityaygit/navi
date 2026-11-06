"use client";
import Link from "next/link";
import { useState } from "react";
import { ChatList, type ChatSummary } from "./chat-list";

/** Chat list beside the conversation on wide screens; a toggleable panel on phones. */
export function ChatShell({ chats, currentId, title, children }: { chats: ChatSummary[]; currentId: string | null; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-[calc(100dvh-10rem)] gap-5 md:h-[calc(100dvh-7rem)]">
      <aside aria-label="Your chats" className="surf hidden w-[280px] shrink-0 flex-col p-2.5 md:flex">
        <ChatList chats={chats} currentId={currentId} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3 md:gap-4 md:rounded-[14px] md:border md:border-border md:bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] md:p-6 md:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="flex items-center gap-2 md:border-b md:border-border md:pb-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] md:text-[24px]">{title}</h1>
            <span className="dim hidden text-[13px] md:block">Text and voice share this history</span>
          </div>
          {!open && currentId && (
            <Link href="/chat?new=1" className="btn btn-sm md:hidden" aria-label="New chat">New</Link>
          )}
          <button type="button" className="btn btn-sm md:hidden" aria-expanded={open} aria-controls="chat-list-panel" onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : `Chats${chats.length ? ` (${chats.length})` : ""}`}
          </button>
        </div>
        {open ? (
          <div id="chat-list-panel" className="surf flex min-h-0 flex-1 flex-col p-2.5 md:hidden">
            <ChatList chats={chats} currentId={currentId} onNavigate={() => setOpen(false)} />
          </div>
        ) : null}
        <div className={`min-h-0 flex-1 flex-col ${open ? "hidden md:flex" : "flex"}`}>{children}</div>
      </div>
    </div>
  );
}
