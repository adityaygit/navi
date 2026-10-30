import { requireCtx } from "@/server/context";
import { getOrCreateConversation, listMessages } from "@/server/ai/chat";
import { aiAvailability, voiceAvailability } from "@/server/ai/config";
import { Chat } from "@/components/chat";

export const metadata = { title: "Navi" };

export default async function ChatPage() {
  const ctx = await requireCtx();
  const conversationId = await getOrCreateConversation(ctx, "chat");
  const messages = await listMessages(ctx, conversationId);
  const ai = aiAvailability();
  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col gap-3 md:h-[calc(100dvh-6rem)]">
      <h1 className="h1">Navi</h1>
      <Chat kind="chat" initialMessages={messages} ai={ai.ready ? { ready: true, mode: ai.mode } : { ready: false, mode: "none", reason: ai.reason }} voice={voiceAvailability()} />
    </div>
  );
}
