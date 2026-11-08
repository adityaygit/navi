import Link from "next/link";
import { requireCtx } from "@/server/context";
import { listConversations } from "@/server/ai/chat";
import { ChatList } from "@/components/chat-list";

export const metadata = { title: "All chats · Navi" };

/** Every chat, newest first. The sidebar shows the latest ten and links here. */
export default async function AllChatsPage() {
  const ctx = await requireCtx();
  const chats = (await listConversations(ctx)).map(({ id, title, updated_at }) => ({ id, title, updated_at }));
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-[28px] font-semibold tracking-[-0.02em]">All chats</h1>
        <Link href="/" className="flex h-10 items-center rounded-full bg-text px-4 text-[14px] font-semibold text-black">New chat</Link>
      </div>
      <ChatList chats={chats} />
    </div>
  );
}
