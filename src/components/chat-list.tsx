"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { deleteChatAction, renameChatAction } from "@/app/(app)/actions";

export type ChatSummary = { id: string; title: string | null; updated_at: string };

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const noSubscribe = () => () => {};

/** The user's chats: open, start, rename, delete, filter. */
export function ChatList({ chats, currentId, onNavigate }: { chats: ChatSummary[]; currentId: string | null; onNavigate?: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Times are shown in the device's own time zone, so only once on the device (the server's zone may differ).
  const onDevice = useSyncExternalStore(noSubscribe, () => true, () => false);

  const q = query.trim().toLowerCase();
  const shown = q ? chats.filter((c) => (c.title ?? "").toLowerCase().includes(q)) : chats;

  function rename(id: string) {
    const title = draft.trim();
    setEditing(null);
    if (!title || title === chats.find((c) => c.id === id)?.title) return;
    startTransition(async () => {
      const r = await renameChatAction(id, title);
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  }

  function remove(id: string, title: string) {
    if (!confirm(`Delete “${title}”? Its messages are removed for good. Anything Navi already added to your tasks, plan or inbox stays.`)) return;
    startTransition(async () => {
      const r = await deleteChatAction(id);
      if (!r.ok) return setError(r.error);
      setError(null);
      if (id === currentId) router.replace("/chat");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Link href="/chat?new=1" className="btn btn-primary w-full justify-center" onClick={onNavigate}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        New chat
      </Link>
      <span className="eyebrow px-3 pb-0.5 pt-2 text-[12px] text-dim">Chats</span>
      {chats.length > 4 && (
        <>
          <label htmlFor="chat-filter" className="sr-only">Find a chat</label>
          <input id="chat-filter" type="search" className="input w-full" placeholder="Find a chat" value={query} onChange={(e) => setQuery(e.target.value)} />
        </>
      )}
      {error && <p role="alert" className="notice notice-danger text-xs">{error}</p>}
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Chats" aria-busy={pending}>
        {shown.length === 0 && <li className="dim px-3 py-1 text-sm">{q ? "No chats match." : "No chats yet."}</li>}
        {shown.map((c) => {
          const title = c.title || "Untitled chat";
          const current = c.id === currentId;
          return (
            <li key={c.id} className={`group flex items-center gap-1 rounded-[10px] transition-colors ${current ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}>
              {editing === c.id ? (
                <form
                  className="flex flex-1 items-center gap-1 p-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename(c.id);
                  }}
                >
                  <label htmlFor={`rename-${c.id}`} className="sr-only">Chat name</label>
                  <input
                    id={`rename-${c.id}`}
                    className="input min-h-9 flex-1 py-1 text-sm"
                    value={draft}
                    maxLength={80}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => rename(c.id)}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                  />
                </form>
              ) : (
                <>
                  <Link
                    href={`/chat?c=${c.id}`}
                    aria-current={current ? "page" : undefined}
                    onClick={onNavigate}
                    className="flex min-h-12 min-w-0 flex-1 flex-col justify-center px-3 py-1.5"
                  >
                    <span className={`truncate text-[15px] ${current ? "font-semibold" : ""}`}>{title}</span>
                    <span className={`num text-[13px] ${current ? "muted" : "dim"}`} >{onDevice ? when(c.updated_at) : "\u00a0"}</span>
                  </Link>
                  <span className={`flex shrink-0 ${current ? "" : "md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"}`}>
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
                  <button type="button" className="btn btn-ghost btn-sm shrink-0 px-2 text-xs text-muted" aria-label={`Delete ${title}`} onClick={() => remove(c.id, title)}>
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
