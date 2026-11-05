"use client";
import Link from "next/link";
import { useState } from "react";
import { ChatList, type ChatSummary } from "./chat-list";

/** Chat list beside the conversation on wide screens; a toggleable panel on phones. */
export function ChatShell({ chats, currentId, title, children }: { chats: ChatSummary[]; currentId: string | null; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-[calc(100dvh-10rem)] gap-4 md:h-[calc(100dvh-6rem)]">
      <aside aria-label="Your chats" className="hidden w-72 shrink-0 flex-col md:flex">
        <ChatList chats={chats} currentId={currentId} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <h1 className="h1 min-w-0 flex-1 truncate">{title}</h1>
          {!open && currentId && (
            <Link href="/chat?new=1" className="btn btn-sm md:hidden" aria-label="New chat">New</Link>
          )}
          <button type="button" className="btn btn-sm md:hidden" aria-expanded={open} aria-controls="chat-list-panel" onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : `Chats${chats.length ? ` (${chats.length})` : ""}`}
          </button>
        </div>
        {open ? (
          <div id="chat-list-panel" className="flex min-h-0 flex-1 flex-col md:hidden">
            <ChatList chats={chats} currentId={currentId} onNavigate={() => setOpen(false)} />
          </div>
        ) : null}
        <div className={`min-h-0 flex-1 flex-col ${open ? "hidden md:flex" : "flex"}`}>{children}</div>
      </div>
    </div>
  );
}
