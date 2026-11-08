import type { Message } from "@/lib/types";
import type { ActionView } from "@/lib/actions";

/** A chat as the centre chat and the Navi panel show it. */
export type ChatData = {
  /** null: a new chat that starts with its first message. */
  id: string | null;
  title: string | null;
  messages: Message[];
  actions: Record<string, ActionView>;
  undone: string[];
  /** The URL named a chat that doesn't exist (deleted, or someone else's). */
  missing?: boolean;
};

export type ChatSummary = { id: string; title: string | null; updated_at: string };

/** Cookie that remembers which chat the panel shows, so a reload keeps it. */
export const CHAT_COOKIE = "navi_chat";

/** How many recent chats the sidebar lists. */
export const SIDEBAR_CHATS = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isChatId = (v: string | null | undefined): v is string => !!v && UUID.test(v);

/** The URL of a chat in the centre of Home; null is a new chat. */
export function chatHref(id: string | null): string {
  return id ? `/?c=${id}` : "/";
}

/**
 * Which chat to show. On Home the URL decides (`/?c=<id>`, or a new chat).
 * On other pages it is the chat the person last had open (the cookie), or,
 * the first time, their most recent chat.
 */
export function pickChatId(path: string, search: URLSearchParams, cookie: string | undefined, latestId: string | null): string | null {
  if (path === "/") return search.get("c") || null;
  if (cookie === "new") return null;
  if (isChatId(cookie)) return cookie;
  return latestId;
}
