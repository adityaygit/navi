import { redirect } from "next/navigation";
import { chatHref, isChatId } from "@/lib/chat-session";

// The chat lives in the centre of Home now. Old links keep working:
// /chat → a new chat on Home; /chat?c=<id> → that chat on Home.
export default async function OldChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  redirect(chatHref(isChatId(c) ? c : null));
}
