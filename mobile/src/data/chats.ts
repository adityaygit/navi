import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

export type ChatSummary = { id: string; title: string | null; updated_at: string };

const LAST = "navi.lastChat";
const RESUME_MS = 6 * 60 * 60 * 1000;

/** The chat to reopen: the one you were in, if you used it in the last few hours. Otherwise a fresh start. */
export function chatToResume(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST) || "null") as { id: string; at: number } | null;
    return v && Date.now() - v.at < RESUME_MS ? v.id : null;
  } catch {
    return null;
  }
}

export function rememberChat(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST, JSON.stringify({ id, at: Date.now() }));
    else localStorage.removeItem(LAST);
  } catch {
    /* storage blocked */
  }
}

export function useChatList(open: boolean) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const refresh = useCallback(() => {
    api<{ chats: ChatSummary[] }>("/api/m/chats")
      .then((r) => setChats(r.chats))
      .catch(() => setChats((c) => c ?? []));
  }, []);
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);
  return { chats, refresh };
}
