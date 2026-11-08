"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { chatHref, type ChatSummary } from "@/lib/chat-session";
import { useChatEdits } from "./shell/sidebar-chats";
import { useChatSession } from "./shell/chat-session";

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const noSubscribe = () => () => {};

/** Every chat (the sidebar lists only the latest ten): find, open, rename, delete. */
export function ChatList({ chats }: { chats: ChatSummary[] }) {
  const session = useChatSession();
  const edits = useChatEdits();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Times are shown in the device's own time zone, so only once on the device (the server's zone may differ).
  const onDevice = useSyncExternalStore(noSubscribe, () => true, () => false);

  const q = query.trim().toLowerCase();
  const shown = q ? chats.filter((c) => (c.title ?? "").toLowerCase().includes(q)) : chats;

  return (
    <div className="flex flex-col gap-3">
      {chats.length > 4 && (
        <>
          <label htmlFor="chat-filter" className="sr-only">Find a chat</label>
          <input id="chat-filter" type="search" className="input w-full" placeholder="Find a chat" value={query} onChange={(e) => setQuery(e.target.value)} />
        </>
      )}
      {edits.error && <p role="alert" className="notice notice-danger text-sm">{edits.error}</p>}
      <ul className="flex flex-col gap-0.5" aria-label="Chats" aria-busy={edits.pending}>
        {shown.length === 0 && <li className="dim px-3 py-1 text-sm">{q ? "No chats match." : "No chats yet."}</li>}
        {shown.map((c) => {
          const title = c.title || "Untitled chat";
          const current = c.id === session.currentId;
          return (
            <li key={c.id} className={`group flex items-center gap-1 rounded-[14px] transition-colors ${current ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}>
              {editing === c.id ? (
                <form
                  className="flex flex-1 items-center gap-1 p-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setEditing(null);
                    edits.rename(c, draft);
                  }}
                >
                  <label htmlFor={`rename-all-${c.id}`} className="sr-only">Chat name</label>
                  <input
                    id={`rename-all-${c.id}`}
                    className="input min-h-9 flex-1 py-1 text-sm"
                    value={draft}
                    maxLength={80}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                      setEditing(null);
                      edits.rename(c, draft);
                    }}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                  />
                </form>
              ) : (
                <>
                  <Link href={chatHref(c.id)} aria-current={current ? "true" : undefined} className="flex min-h-12 min-w-0 flex-1 flex-col justify-center px-3 py-1.5">
                    <span className={`truncate text-[15px] ${current ? "font-semibold" : ""}`}>{title}</span>
                    <span className="num text-[13px] text-dim">{onDevice ? when(c.updated_at) : " "}</span>
                  </Link>
                  <span className="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm shrink-0 px-2 text-xs text-muted"
                      aria-label={`Rename ${title}`}
                      onClick={() => {
                        setDraft(c.title ?? "");
                        setEditing(c.id);
                      }}
                    >
                      Rename
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm shrink-0 px-2 text-xs text-muted" aria-label={`Delete ${title}`} onClick={() => edits.remove(c)}>
                      Delete
                    </button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
