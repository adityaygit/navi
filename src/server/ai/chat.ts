import "server-only";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import type { Message, ToolEvent } from "@/lib/types";
import { relevantMemories } from "@/server/domain/memory";
import { runAgent, type AgentMode } from "./agent";
import { CHAT_SYSTEM, ONBOARDING_SYSTEM } from "./prompts";
import { runTool } from "./tools";
import { nowIn } from "@/lib/time";

// One conversation history shared by text and voice. Every turn is stored,
// so the dashboard, chat and voice all see the same context.

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
  const { data, error } = await ctx.db
    .from("conversations")
    .insert({ user_id: ctx.userId, kind, title: kind === "onboarding" ? "Getting set up" : "Navi" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (kind === "onboarding") {
    await ctx.db.from("profiles").update({ onboarding_conversation_id: data.id, onboarding_status: "in_progress" }).eq("id", ctx.userId);
  }
  return data.id;
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
    "Current state:",
    String(overview.data ?? ""),
    "",
    "What you remember about the user:",
    mem,
  ].join("\n");
}

export type TurnResult = {
  conversationId: string;
  userMessage: Message;
  assistantMessage: Message;
  mutated: boolean;
  simulated: boolean;
  error?: string;
};

export async function handleTurn(
  ctx: Ctx,
  input: { kind: "chat" | "onboarding"; text: string; modality: "text" | "voice" },
): Promise<TurnResult> {
  const conversationId = await getOrCreateConversation(ctx, input.kind);
  const history = (await listMessages(ctx, conversationId, 24))
    .filter((m) => m.role !== "system" && m.content.trim())
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.tool_events.length
        ? `${m.content}\n[Actions taken: ${m.tool_events.map((e) => `${e.name}: ${e.summary}`).join("; ")}]`
        : m.content,
    }));
  const userMessage = await saveMessage(ctx, conversationId, "user", input.text, input.modality);
  const turnCtx: Ctx = { ...ctx, conversationId };
  const mode: AgentMode = input.kind === "onboarding" ? "onboarding" : "chat";
  const context = await buildContext(turnCtx, input.text, mode);
  const profile = await getProfile(ctx);
  const result = await runAgent({
    ctx: turnCtx,
    mode,
    role: mode === "onboarding" || PLANNER_CUES.test(input.text) ? "planner" : "fast",
    system: mode === "onboarding" ? ONBOARDING_SYSTEM : CHAT_SYSTEM,
    context: `${context}\nUser's local time: ${nowIn(profile.timezone).toFormat("cccc yyyy-LL-dd HH:mm ZZ")}`,
    history,
    userText: input.text,
    purpose: mode === "onboarding" ? "onboarding" : "chat",
  });
  const assistantMessage = await saveMessage(ctx, conversationId, "assistant", result.text, input.modality, result.toolEvents);
  return { conversationId, userMessage, assistantMessage, mutated: result.mutated, simulated: result.simulated, error: result.error };
}
