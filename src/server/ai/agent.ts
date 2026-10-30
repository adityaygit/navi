import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Ctx } from "@/server/context";
import type { ToolEvent } from "@/lib/types";
import { serverEnv } from "@/lib/env";
import { aiAvailability, modelFor, tokenCost, type ModelRole } from "./config";
import { assertBudget, BudgetExceededError, recordUsage } from "./budget";
import { jsonSchemaFor, runTool, toolsFor } from "./tools";
import { runDevSim } from "./devsim";

export type AgentMode = "chat" | "onboarding" | "capture";

export type AgentRequest = {
  ctx: Ctx;
  mode: AgentMode;
  role: Exclude<ModelRole, "voice">;
  system: string;
  context: string;
  history: { role: "user" | "assistant"; content: string }[];
  userText: string;
  purpose: string;
};

export type AgentResult = {
  text: string;
  toolEvents: ToolEvent[];
  mutated: boolean;
  model: string;
  simulated: boolean;
  costUsd: number;
  error?: "budget" | "unavailable" | "provider";
};

const MAX_ITERATIONS = 8;
const MAX_TOKENS = 8000;

export async function runAgent(req: AgentRequest): Promise<AgentResult> {
  const availability = aiAvailability();
  if (availability.mode === "devsim") return runDevSim(req);
  if (!availability.ready) {
    return {
      text: `I can't think right now: ${availability.reason} Your message is saved, and anything you capture still goes to your inbox for manual review.`,
      toolEvents: [],
      mutated: false,
      model: "none",
      simulated: false,
      costUsd: 0,
      error: "unavailable",
    };
  }
  try {
    return await runAnthropic(req, modelFor(req.role), true);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return { text: err.message, toolEvents: [], mutated: false, model: "none", simulated: false, costUsd: 0, error: "budget" };
    }
    // Fallback model for availability problems on the planner role.
    const fallback = serverEnv.models().plannerFallback;
    const retriable =
      err instanceof Anthropic.NotFoundError ||
      err instanceof Anthropic.InternalServerError ||
      (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503));
    if (req.role === "planner" && retriable && fallback !== modelFor("planner")) {
      try {
        const r = await runAnthropic(req, fallback, false);
        return { ...r, text: r.text };
      } catch (err2) {
        err = err2;
      }
    }
    console.error("AI provider error:", err instanceof Error ? err.message : err);
    const message =
      err instanceof Anthropic.AuthenticationError
        ? "The AI provider rejected the server's API key."
        : err instanceof Anthropic.RateLimitError
          ? "The AI provider is rate-limiting requests right now. Try again in a minute."
          : "The AI provider had a problem handling that.";
    return { text: `${message} Nothing was lost; your message is saved.`, toolEvents: [], mutated: false, model: "none", simulated: false, costUsd: 0, error: "provider" };
  }
}

async function runAnthropic(req: AgentRequest, model: string, allowServerFallback: boolean): Promise<AgentResult> {
  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey()!, maxRetries: 2 });
  const tools = toolsFor(req.mode).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: jsonSchemaFor(t) as Anthropic.Beta.BetaTool["input_schema"],
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...req.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: req.userText },
  ];
  const useFallbacks = allowServerFallback && serverEnv.refusalFallbacks() && model.startsWith("claude-sonnet");
  const toolEvents: ToolEvent[] = [];
  let mutated = false;
  let costUsd = 0;
  let finalText = "";
  // Pessimistic reserve for one call: full max_tokens of output.
  const reserve = tokenCost(model, { input: 20000, output: MAX_TOKENS }).usd;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    await assertBudget(reserve);
    const response = await client.beta.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [
        { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
        { type: "text", text: req.context },
      ],
      tools,
      messages,
      output_config: { effort: req.role === "fast" ? "low" : "medium" },
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const u = response.usage;
    costUsd += await recordUsage({
      userId: req.ctx.userId,
      provider: "anthropic",
      model: response.model ?? model,
      role: req.role,
      purpose: req.purpose,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    });

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) finalText = text;

    if (response.stop_reason === "refusal") {
      finalText = "I can't help with that one. Nothing was changed.";
      break;
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      if (response.stop_reason === "max_tokens" && !finalText) finalText = "That got too long; please ask again more narrowly.";
      break;
    }
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    // Run sequentially: tools mutate shared state and later calls may depend on earlier ones.
    for (const use of toolUses) {
      const result = await runTool({ ...req.ctx, actor: "navi" }, use.name, use.input);
      if (result.mutated) mutated = true;
      if (use.name !== "get_overview" && use.name !== "recall" && use.name !== "search_items") {
        toolEvents.push({ name: use.name, ok: result.ok, summary: result.summary });
      }
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        is_error: !result.ok,
        content: JSON.stringify({ ok: result.ok, summary: result.summary, data: result.data ?? null }).slice(0, 30000),
      });
    }
    messages.push({ role: "user", content: results });
    if (i === MAX_ITERATIONS - 1 && !finalText) finalText = "I did what I could; here's where things stand.";
  }
  return { text: finalText || "Done.", toolEvents, mutated, model, simulated: false, costUsd };
}
