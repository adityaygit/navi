"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteChatAction, renameChatAction } from "@/app/(app)/actions";
import { connectionError } from "@/lib/connection";
import { chatHref, type ChatSummary } from "@/lib/chat-session";
import { useChatSession } from "./chat-session";

/** Rename / delete for one chat. Throws nothing: a dropped connection becomes an error line. */
export function useChatEdits() {
  const router = useRouter();
  const session = useChatSession();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const rename = (chat: ChatSummary, title: string) => {
    const clean = title.trim();
    if (!clean || clean === chat.title) return;
    start(async () => {
      const r = await renameChatAction(chat.id, clean).catch(() => ({ ok: false as const, error: connectionError() }));
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  };
  const remove = (chat: ChatSummary) => {
    const title = chat.title || "Untitled chat";
    if (!confirm(`Delete “${title}”? Its messages are removed for good. Anything Navi already added to your tasks, plan or inbox stays.`)) return false;
    start(async () => {
      const r = await deleteChatAction(chat.id).catch(() => ({ ok: false as const, error: connectionError() }));
      if (!r.ok) return setError(r.error);
      setError(null);
      session.forget(chat.id);
      router.refresh();
    });
    return true;
  };
  return { rename, remove, pending, error };
}

/** The sidebar's recent chats: open one in the centre; ⋯ to rename or delete. */
export function SidebarChats() {
  const session = useChatSession();
  const edits = useChatEdits();
  const { chats } = session;
  if (chats.length === 0) return null;
  return (
    <>
      <div className="mb-2 mt-[26px] px-3 text-[12.5px] font-medium text-dim" id="chats-label">Chats</div>
      {edits.error && <p role="alert" className="mx-2 mb-1 text-[12.5px] text-clash">{edits.error}</p>}
      <ul aria-labelledby="chats-label" className="flex flex-col" aria-busy={edits.pending}>
        {chats.map((c) => (
          <ChatRow key={c.id} chat={c} current={c.id === session.currentId} edits={edits} />
        ))}
      </ul>
      {session.moreChats && (
        <Link href="/chats" className="flex h-[34px] items-center rounded-[12px] px-3 text-[13.5px] text-dim hover:bg-white/[0.04] hover:text-text">
          All chats
        </Link>
      )}
    </>
  );
}

function ChatRow({ chat, current, edits }: { chat: ChatSummary; current: boolean; edits: ReturnType<typeof useChatEdits> }) {
  const title = chat.title || "Untitled chat";
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Open: the first item takes focus; a click elsewhere or Escape closes it.
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.scrollIntoView({ block: "nearest" });
    menuRef.current?.querySelector("button")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (renaming) {
    const finish = (save: boolean) => {
      setRenaming(false);
      if (save) edits.rename(chat, draft);
      // Back to the row's menu button, so keyboard users don't lose their place.
      requestAnimationFrame(() => trigger.current?.focus());
    };
    return (
      <li className="px-1 py-0.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            finish(true);
          }}
        >
          <label htmlFor={`rename-${chat.id}`} className="sr-only">Chat name</label>
          <input
            id={`rename-${chat.id}`}
            className="bare-field h-[30px] w-full rounded-[10px] !bg-white/[0.08] px-2.5 text-[14px] text-text"
            value={draft}
            maxLength={80}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                finish(false);
              }
            }}
          />
        </form>
      </li>
    );
  }

  return (
    <li className={`group relative flex h-[34px] items-center rounded-[12px] ${current ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}>
      <Link
        href={chatHref(chat.id)}
        aria-current={current ? "true" : undefined}
        className={`flex h-full min-w-0 flex-1 items-center pl-3 pr-8 text-[14px] ${current ? "text-text" : "text-[#C8C8CE]"}`}
        title={title}
      >
        <span className="truncate">{title}</span>
      </Link>
      <button
        ref={trigger}
        type="button"
        aria-label={`Options for ${title}`}
        aria-haspopup="true"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
        className={`absolute right-1 flex h-[26px] w-[26px] items-center justify-center rounded-full text-dim hover:bg-white/[0.08] hover:text-text focus-visible:opacity-100 ${menu || current ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
      </button>
      {menu && (
        <div ref={menuRef} className="absolute right-0 top-[36px] z-40 flex w-40 flex-col rounded-[14px] border border-white/[0.08] bg-[#1C1C1F] p-1 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
          <button
            type="button"
            className="flex h-9 items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] text-text hover:bg-white/[0.06]"
            onClick={() => {
              setMenu(false);
              setDraft(title);
              setRenaming(true);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
            Rename
          </button>
          <button
            type="button"
            className="flex h-9 items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] text-clash hover:bg-white/[0.06]"
            onClick={() => {
              setMenu(false);
              if (!edits.remove(chat)) trigger.current?.focus();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
