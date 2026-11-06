import { requireCtx } from "@/server/context";
import { findChat, listConversations, listMessages } from "@/server/ai/chat";
import { aiAvailability, voiceAvailability } from "@/server/ai/config";
import { Chat } from "@/components/chat";
import { ChatShell } from "@/components/chat-shell";

export const metadata = { title: "Navi" };

// /chat          → the most recent chat (or a fresh one if there are none)
// /chat?c=<id>   → that chat
// /chat?new=1    → a blank chat; it is created when the first message is sent
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string; new?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const chats = await listConversations(ctx);
  const requested = sp.c ? (chats.find((c) => c.id === sp.c) ?? (await findChat(ctx, sp.c))) : null;
  const current = requested ?? (sp.c || sp.new ? null : (chats[0] ?? null));
  const [messages, approvals] = await Promise.all([
    current ? listMessages(ctx, current.id) : Promise.resolve([]),
    // Open approvals show as cards on the reply that asked for them.
    ctx.db.from("approvals").select("id,summary,action_type").eq("status", "pending").order("created_at", { ascending: false }).limit(50),
  ]);
  const ai = aiAvailability();
  return (
    <ChatShell chats={chats} currentId={current?.id ?? null} title={current?.title || "New chat"}>
      {sp.c && !requested && <p className="notice notice-warn text-sm" role="status">That chat doesn&apos;t exist anymore. Here&apos;s a new one.</p>}
      <Chat
        kind="chat"
        conversationId={current?.id ?? null}
        initialMessages={messages}
        approvals={approvals.data ?? []}
        ai={ai.ready ? { ready: true, mode: ai.mode } : { ready: false, mode: "none", reason: ai.reason }}
        voice={voiceAvailability()}
      />
    </ChatShell>
  );
}
