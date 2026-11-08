"use server";
import { requireApiCtx } from "@/server/context";
import { loadChat } from "@/server/chat-view";
import type { ChatData } from "@/lib/chat-session";

/**
 * Opens a chat in the centre (or the panel) without reloading the page.
 * Read-only, so no views are refreshed.
 */
export async function openChatAction(id: string): Promise<ChatData> {
  const ctx = await requireApiCtx();
  return loadChat(ctx, String(id));
}
