import "server-only";
import type { Ctx } from "@/server/context";
import { findChat, listMessages, messageActions } from "@/server/ai/chat";
import type { ChatData } from "@/lib/chat-session";

/**
 * One chat with its recent messages and the action cards they carry, as the
 * centre chat and the Navi panel show it. A chat that doesn't exist (deleted,
 * or not the person's) comes back as `missing`.
 */
export async function loadChat(ctx: Ctx, id: string): Promise<ChatData> {
  const chat = await findChat(ctx, id);
  if (!chat) return { id, title: null, messages: [], actions: {}, undone: [], missing: true };
  const messages = await listMessages(ctx, chat.id);
  const { actions, undone } = await messageActions(ctx, messages);
  return { id: chat.id, title: chat.title, messages, actions, undone };
}
