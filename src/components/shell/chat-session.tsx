"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CHAT_COOKIE, chatHref, type ChatData, type ChatSummary } from "@/lib/chat-session";
import { openChatAction } from "@/app/(app)/chat-actions";
import { setShellCookie } from "./panel-context";

/**
 * The one current conversation, shared by the centre chat on Home and the
 * Navi panel on every other page, so the two never diverge. On Home the URL
 * names it (`/?c=<id>`, or none for a new chat), so back/forward and reloads
 * keep it; elsewhere it is whatever was open last (also kept in a cookie so a
 * reload of /tasks shows the same chat). Its messages come from the layout on
 * a full load and from openChatAction when the person switches chats.
 */
type SessionApi = {
  isHome: boolean;
  currentId: string | null;
  /** The chat to draw; `pending` while a switched-to chat is loading. */
  data: ChatData & { pending?: boolean };
  title: string | null;
  chats: ChatSummary[];
  moreChats: boolean;
  /** The chat's first message created it on the server. */
  adopt: (id: string) => void;
  /** A blank chat: in the centre on Home, in the panel elsewhere. */
  startBlank: () => void;
  /** After deleting a chat: if it was open, a blank one takes its place. */
  forget: (id: string) => void;
  /** Ask the composer in the centre or the panel to take focus (New chat). */
  focusRequest: { n: number; where: "center" | "panel" };
  requestFocus: (where: "center" | "panel") => void;
  /** A link inside the chat took the person to another page. */
  fromChat: { from: string; to: string } | null;
  markFromChat: (to: string) => void;
};

const Ctx = createContext<SessionApi | null>(null);
const BLANK: ChatData = { id: null, title: null, messages: [], actions: {}, undone: [] };
const NO_MESSAGES: ChatData["messages"] = [];
const NO_ACTIONS: ChatData["actions"] = {};
const NO_UNDONE: string[] = [];

export function ChatSessionProvider({ server, chats, moreChats, children }: { server: ChatData; chats: ChatSummary[]; moreChats: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const isHome = path === "/";
  const urlId = isHome ? search.get("c") || null : null;

  // Off Home, the chat that was open last stays open.
  const [sticky, setSticky] = useState<string | null>(isHome ? urlId : server.id);
  if (isHome && sticky !== urlId) setSticky(urlId);
  const currentId = isHome ? urlId : sticky;

  const [loaded, setLoaded] = useState<ChatData | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ n: number; where: "center" | "panel" }>({ n: 0, where: "center" });
  const [fromChat, setFromChat] = useState<{ from: string; to: string } | null>(null);
  // Forgotten once the person moves on (anywhere but the chat or the page Navi opened).
  if (fromChat && path !== fromChat.from && path !== fromChat.to) setFromChat(null);

  const ready: ChatData | null = currentId === null ? BLANK : server.id === currentId ? server : loaded?.id === currentId ? loaded : null;
  const data = useMemo<ChatData & { pending?: boolean }>(
    () => ready ?? { id: currentId, title: null, messages: NO_MESSAGES, actions: NO_ACTIONS, undone: NO_UNDONE, pending: true },
    [ready, currentId],
  );

  // A chat the layout didn't load (picked in the sidebar, back/forward): fetch it.
  useEffect(() => {
    if (!data.pending || !currentId) return;
    let cancelled = false;
    openChatAction(currentId)
      .then((r) => !cancelled && setLoaded(r))
      .catch(() => !cancelled && setLoaded({ ...BLANK, id: currentId, missing: true }));
    return () => {
      cancelled = true;
    };
  }, [data.pending, currentId]);

  // Remember the open chat, so a reload of another page keeps it in the panel.
  useEffect(() => setShellCookie(CHAT_COOKIE, currentId ?? "new"), [currentId]);

  const adopt = useCallback(
    (id: string) => {
      // The chat already holds these messages; keep handing it the same ones.
      setLoaded({ id, title: null, messages: data.messages, actions: data.actions, undone: data.undone });
      setShellCookie(CHAT_COOKIE, id);
      if (isHome) router.replace(chatHref(id), { scroll: false });
      else setSticky(id);
      // The sidebar lists the new chat.
      router.refresh();
    },
    [data, isHome, router],
  );

  const startBlank = useCallback(() => {
    if (isHome) router.push("/");
    else setSticky(null);
    setFocusRequest((f) => ({ n: f.n + 1, where: isHome ? "center" : "panel" }));
  }, [isHome, router]);

  const forget = useCallback(
    (id: string) => {
      if (id !== currentId) return;
      if (isHome) router.replace("/");
      else setSticky(null);
    },
    [currentId, isHome, router],
  );

  const api = useMemo<SessionApi>(
    () => ({
      isHome,
      currentId,
      data,
      title: currentId ? (chats.find((c) => c.id === currentId)?.title ?? data.title) : null,
      chats,
      moreChats,
      adopt,
      startBlank,
      forget,
      focusRequest,
      requestFocus: (where: "center" | "panel") => setFocusRequest((f) => ({ n: f.n + 1, where })),
      fromChat,
      markFromChat: (to: string) => setFromChat(to === path ? null : { from: path, to }),
    }),
    [isHome, currentId, data, chats, moreChats, adopt, startBlank, forget, focusRequest, fromChat, path],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useChatSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChatSession outside ChatSessionProvider");
  return v;
}
