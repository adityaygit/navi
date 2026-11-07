import "server-only";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import type { Message, ToolEvent } from "@/lib/types";
import { relevantMemories } from "@/server/domain/memory";
import { runAgent, type AgentMode } from "./agent";
import { CHAT_SYSTEM, ONBOARDING_SYSTEM } from "./prompts";
import { runTool } from "./tools";
import { nowIn } from "@/lib/time";
import { UserFacingError } from "@/server/http";
import type { AgentEvent, ChatStreamEvent } from "@/lib/chat-stream";
import type { ActionView } from "@/lib/actions";
import { autonomyFrom } from "@/lib/actions";
import { actionStatusForModel, actionViews, revertedAmong } from "@/server/domain/approvals";

// Text and voice share each conversation's history: every turn is stored, so
// the dashboard, chat and voice all see the same context. The user can keep
// many separate chats (each with its own, shorter history) and switch between
// them; onboarding is one dedicated conversation.

export type ConversationSummary = { id: string; title: string | null; updated_at: string; created_at: string };

const NEW_CHAT_TITLE = "New chat";

export async function getOrCreateConversation(ctx: Ctx, kind: "chat" | "onboarding"): Promise<string> {
  if (kind === "onboarding") {
    const profile = await getProfile(ctx);
    if (profile.onboarding_conversation_id) return profile.onboarding_conversation_id;
  } else {
    const { data } = await ctx.db
      .from("conversations")
      .select("id")
      .eq("kind", "chat")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data.id;
  }
  return createConversation(ctx, kind);
}

export async function createConversation(ctx: Ctx, kind: "chat" | "onboarding" = "chat"): Promise<string> {
  const { data, error } = await ctx.db
    .from("conversations")
    .insert({ user_id: ctx.userId, kind, title: kind === "onboarding" ? "Getting set up" : NEW_CHAT_TITLE })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (kind === "onboarding") {
    await ctx.db.from("profiles").update({ onboarding_conversation_id: data.id, onboarding_status: "in_progress" }).eq("id", ctx.userId);
  }
  return data.id;
}

/** The user's chats, most recently active first (onboarding is not listed). */
export async function listConversations(ctx: Ctx, limit = 200): Promise<ConversationSummary[]> {
  const { data, error } = await ctx.db
    .from("conversations")
    .select("id,title,updated_at,created_at")
    .eq("kind", "chat")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ConversationSummary[];
}

/** The chat with this id, or null if it doesn't exist or isn't the user's (RLS). */
export async function findChat(ctx: Ctx, id: string): Promise<ConversationSummary | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await ctx.db.from("conversations").select("id,title,updated_at,created_at").eq("id", id).eq("kind", "chat").maybeSingle();
  return (data as ConversationSummary | null) ?? null;
}

/**
 * The conversation a turn or voice session belongs to: onboarding always uses
 * its own; a chat uses the given one (which must be the user's) or, with no
 * id, starts a new chat.
 */
export async function resolveConversation(ctx: Ctx, kind: "chat" | "onboarding", conversationId?: string | null): Promise<string> {
  if (kind === "onboarding") return getOrCreateConversation(ctx, "onboarding");
  if (!conversationId) return createConversation(ctx, "chat");
  const chat = await findChat(ctx, conversationId);
  if (!chat) throw new UserFacingError("That chat no longer exists. Start a new one.", 404);
  return chat.id;
}

export async function renameConversation(ctx: Ctx, id: string, title: string): Promise<void> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) throw new Error("A chat needs a name");
  const { data, error } = await ctx.db.from("conversations").update({ title: clean }).eq("id", id).eq("kind", "chat").select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("That chat no longer exists");
}

/** Deletes a chat and its messages. Items it created stay; their link to the chat is cleared. */
export async function deleteConversation(ctx: Ctx, id: string): Promise<void> {
  const { data, error } = await ctx.db.from("conversations").delete().eq("id", id).eq("kind", "chat").select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("That chat no longer exists");
}

/** A short name for a chat, taken from its first message. */
export function titleFromText(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= 48) return line || NEW_CHAT_TITLE;
  const cut = line.slice(0, 48);
  const space = cut.lastIndexOf(" ");
  return `${(space > 24 ? cut.slice(0, space) : cut).replace(/[,.;:!?-]+$/, "")}…`;
}

/** Names a still-unnamed chat after its first message; call before saving that message. */
export async function nameNewChat(ctx: Ctx, conversationId: string, text: string) {
  if (!text.trim()) return;
  const { count } = await ctx.db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("role", "user");
  if (count) return;
  await ctx.db
    .from("conversations")
    .update({ title: titleFromText(text) })
    .eq("id", conversationId)
    .eq("kind", "chat")
    .in("title", [NEW_CHAT_TITLE, "Navi"]);
}

export async function listMessages(ctx: Ctx, conversationId: string, limit = 60): Promise<Message[]> {
  const { data } = await ctx.db
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Message[]).reverse();
}

export async function saveMessage(
  ctx: Ctx,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  modality: "text" | "voice",
  toolEvents: ToolEvent[] = [],
): Promise<Message> {
  const { data, error } = await ctx.db
    .from("messages")
    .insert({ user_id: ctx.userId, conversation_id: conversationId, role, content, modality, tool_events: toolEvents })
    .select()
    .single();
  if (error) throw new Error(error.message);
  await ctx.db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  return data as Message;
}

const PLANNER_CUES = /\b(plan|schedule|week|prioriti|reorgani|broke|behind|overwhelm|review|goal|deadline|realistic|strategy)\b/i;

/** Context block appended after the cached system prompt. */
export async function buildContext(ctx: Ctx, query: string, mode: AgentMode | "voice"): Promise<string> {
  const [overview, memories] = await Promise.all([runTool(ctx, "get_overview", {}), relevantMemories(ctx, query)]);
  const mem = memories.length
    ? memories.map((m) => `- (${m.kind}, ${m.origin}${m.origin === "inferred" ? `, confidence ${m.confidence}` : ""}) ${m.content}`).join("\n")
    : "(none yet)";
  return [
    `Mode: ${mode}.`,
    `Current state (a snapshot taken at the start of this ${mode === "voice" ? "voice session" : "turn"}; call the read tools for other dates or anything that may have changed since):`,
    String(overview.data ?? ""),
    "",
    "What you remember about the user:",
    mem,
  ].join("\n");
}

export type TurnResult = {
  conversationId: string;
  title?: string | null;
  userMessage: Message;
  assistantMessage: Message;
  mutated: boolean;
  simulated: boolean;
  error?: string;
  actions?: Record<string, ActionView>;
};

/** Action cards and Undo state for these messages: what each card shows, and which automatic changes were undone. */
export async function messageActions(ctx: Ctx, messages: Message[]): Promise<{ actions: Record<string, ActionView>; undone: string[] }> {
  const events = messages.flatMap((m) => m.tool_events ?? []);
  const [actions, reverted] = await Promise.all([
    actionViews(ctx, events.flatMap((e) => (e.action_id ? [e.action_id] : []))),
    revertedAmong(ctx, events.flatMap((e) => e.undo ?? [])),
  ]);
  return { actions, undone: [...reverted] };
}

/**
 * What Navi did in an earlier reply, as its own history shows it. Cards say
 * how they ended up (the person may have approved, declined or changed them
 * since), and automatic changes the person undid say so, so the next reply
 * acknowledges the decision instead of repeating or re-proposing it.
 */
function actionsTaken(m: Message, actions: Record<string, ActionView>, undone: Set<string>): string {
  const lines = m.tool_events.map((e) => {
    const card = e.action_id ? actions[e.action_id] : undefined;
    if (card) return `${e.name}: ${card.verb} “${card.subject}” [action ${card.id}] — ${actionStatusForModel(card)}`;
    const undoneNote = e.undo?.length && e.undo.every((id) => undone.has(id)) ? " — the user undid this" : "";
    return `${e.name}: ${e.summary}${undoneNote}`;
  });
  return `${m.content}\n[Actions taken: ${lines.join("; ")}]`;
}

/**
 * One conversation turn: saves the user's message, runs Navi, saves the reply.
 * `onEvent` (optional) receives live progress for a streaming client: the
 * saved user message, then each step and piece of text as it happens. The
 * result and what is stored are the same with or without it.
 */
export async function handleTurn(
  ctx: Ctx,
  input: { kind: "chat" | "onboarding"; text: string; modality: "text" | "voice"; conversationId?: string | null },
  onEvent?: (event: Exclude<ChatStreamEvent, { type: "done" } | { type: "error" }>) => void,
): Promise<TurnResult> {
  const conversationId = await resolveConversation(ctx, input.kind, input.conversationId);
  const prior = await listMessages(ctx, conversationId, 24);
  if (input.kind === "chat" && !prior.some((m) => m.role === "user")) await nameNewChat(ctx, conversationId, input.text);
  const before = await messageActions(ctx, prior);
  const undone = new Set(before.undone);
  const history = prior
    .filter((m) => m.role !== "system" && m.content.trim())
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.tool_events.length ? actionsTaken(m, before.actions, undone) : m.content,
    }));
  const userMessage = await saveMessage(ctx, conversationId, "user", input.text, input.modality);
  if (onEvent) {
    const { data: named } = await ctx.db.from("conversations").select("title").eq("id", conversationId).maybeSingle();
    onEvent({ type: "user", userMessage, conversationId, title: named?.title ?? null });
  }
  const profile = await getProfile(ctx);
  const turnCtx: Ctx = { ...ctx, conversationId, autonomy: autonomyFrom(profile.preferences) };
  const mode: AgentMode = input.kind === "onboarding" ? "onboarding" : "chat";
  const context = await buildContext(turnCtx, input.text, mode);
  const result = await runAgent({
    ctx: turnCtx,
    mode,
    role: mode === "onboarding" || PLANNER_CUES.test(input.text) ? "planner" : "fast",
    system: mode === "onboarding" ? ONBOARDING_SYSTEM : CHAT_SYSTEM,
    context: `${context}\nUser's local time: ${nowIn(profile.timezone).toFormat("cccc yyyy-LL-dd HH:mm ZZ")}`,
    history,
    userText: input.text,
    purpose: mode === "onboarding" ? "onboarding" : "chat",
    onEvent: onEvent ? (event: AgentEvent) => onEvent(event) : undefined,
  });
  const assistantMessage = await saveMessage(ctx, conversationId, "assistant", result.text, input.modality, result.toolEvents);
  const [{ data: conv }, after] = await Promise.all([
    ctx.db.from("conversations").select("title").eq("id", conversationId).maybeSingle(),
    messageActions(ctx, [assistantMessage]),
  ]);
  return { conversationId, title: conv?.title ?? null, userMessage, assistantMessage, mutated: result.mutated, simulated: result.simulated, error: result.error, actions: after.actions };
}
