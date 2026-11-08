import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { BetaMessageStream } from "@anthropic-ai/sdk/lib/BetaMessageStream";
import type { Ctx } from "@/server/context";
import type { ToolEvent } from "@/lib/types";
import { serverEnv } from "@/lib/env";
import { aiAvailability, modelFor, tokenCost, type ModelRole } from "./config";
import { BudgetExceededError, reserveBudget, settleUsage } from "./budget";
import { jsonSchemaFor, runTool, toolsFor } from "./tools";
import { runDevSim } from "./devsim";
import { READ_ONLY_TOOLS } from "@/lib/tool-names";
import type { AgentEvent } from "@/lib/chat-stream";
import { emitter, stepEndEvent, stepStartEvent, toolEventOf } from "./live";
import { actionViews } from "@/server/domain/approvals";
import { legacyDisplay } from "@/lib/plain-text";
import { stepDone } from "@/lib/tool-labels";

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
  /**
   * Live progress for a streaming client: each tool step as it starts and
   * finishes, and reply text as it is written. Purely a view: the result (and
   * what gets saved) is the same with or without it.
   */
  onEvent?: (event: AgentEvent) => void;
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
        // Anything shown live from the failed attempt is discarded before the retry.
        emitter(req)({ type: "reset" });
        const r = await runAnthropic(req, fallback, false);
        return { ...r, text: r.text };
      } catch (err2) {
        err = err2;
      }
    }
    console.error("AI provider error:", err instanceof Error ? err.message : err);
    return { text: `${providerMessage(err)} Nothing was lost; your message is saved.`, toolEvents: [], mutated: false, model: "none", simulated: false, costUsd: 0, error: "provider" };
  }
}

function providerMessage(err: unknown) {
  if (err instanceof BudgetExceededError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "The AI provider rejected the server's API key.";
  if (err instanceof Anthropic.RateLimitError) return "The AI provider is rate-limiting requests right now. Try again in a minute.";
  return "The AI provider had a problem handling that.";
}

async function runAnthropic(req: AgentRequest, model: string, allowServerFallback: boolean): Promise<AgentResult> {
  const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey()!, maxRetries: 2 });
  const tools = toolsFor(req.mode, { plannerV2: req.ctx.plannerV2 }).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: jsonSchemaFor(t) as Anthropic.Beta.BetaTool["input_schema"],
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...req.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: req.userText },
  ];
  const useFallbacks = allowServerFallback && serverEnv.refusalFallbacks() && model.startsWith("claude-sonnet");
  const emit = emitter(req);
  const toolEvents: ToolEvent[] = [];
  let mutated = false;
  let costUsd = 0;
  let finalText = "";
  // Tool steps already shown as started (streaming announces them early).
  const started = new Set<string>();
  // Steps shown as started but not finished yet (id → tool name).
  const open = new Map<string, string>();
  const startStep = (id: string, name: string) => {
    if (started.has(id)) return;
    started.add(id);
    open.set(id, name);
    emit(stepStartEvent(id, name));
  };
  // Pessimistic reserve for one call: full max_tokens of output.
  const reserve = tokenCost(model, { input: 20000, output: MAX_TOKENS }).usd;

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Hold back the worst case for this call atomically, then settle to the real usage.
      const reservation = await reserveBudget({ userId: req.ctx.userId, provider: "anthropic", model, role: req.role, purpose: req.purpose, amountUsd: reserve });
      let response: Anthropic.Beta.BetaMessage;
      const params = {
        model,
        max_tokens: MAX_TOKENS,
        system: [
          { type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } },
          { type: "text" as const, text: req.context },
        ],
        tools,
        messages,
        output_config: { effort: req.role === "fast" ? ("low" as const) : ("medium" as const) },
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      };
      try {
        if (req.onEvent) {
          // Streamed: text appears as it is written and each tool step shows
          // as soon as the model starts it. The SDK's own accumulator builds
          // the same final message the non-streaming call returns.
          const raw = await client.beta.messages.create({ ...params, stream: true });
          const stream = BetaMessageStream.fromReadableStream(raw.toReadableStream());
          const segment = i;
          stream.on("text", (delta) => {
            if (delta) emit({ type: "text", delta, segment });
          });
          stream.on("streamEvent", (event) => {
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") startStep(event.content_block.id, event.content_block.name);
          });
          response = await stream.finalMessage();
        } else {
          response = await client.beta.messages.create(params);
        }
      } catch (err) {
        await settleUsage(reservation, { costUsd: 0, ok: false }, model);
        throw err;
      }
      const u = response.usage;
      costUsd += await settleUsage(
        reservation,
        {
          model: response.model ?? model,
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        },
        model,
      );

      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) finalText = text;

      if (response.stop_reason === "refusal") {
        finalText = mutated
          ? `I can't continue with that one. Already done before I stopped: ${toolEvents.map((e) => e.display || legacyDisplay(e) || stepDone(e.name, e.ok)).join("; ")}.`
          : "I can't help with that one. Nothing was changed.";
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
        startStep(use.id, use.name);
        // userMessage: the person's own words this turn, held by the server (see complete_task).
        const result = await runTool({ ...req.ctx, actor: "navi", userMessage: req.userText }, use.name, use.input);
        open.delete(use.id);
        const action = result.actionId && req.onEvent ? (await actionViews(req.ctx, [result.actionId]))[result.actionId] : undefined;
        emit(stepEndEvent(use.id, use.name, result.ok, result, { action, undo: result.actionId ? undefined : result.undo }));
        if (result.mutated) mutated = true;
        if (!READ_ONLY_TOOLS.includes(use.name)) toolEvents.push(toolEventOf(use.name, result));
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: !result.ok,
          content: JSON.stringify({ ok: result.ok, summary: result.summary, action_id: result.actionId ?? null, data: result.data ?? null }).slice(0, 30000),
        });
      }
      messages.push({ role: "user", content: results });
      if (i === MAX_ITERATIONS - 1 && !finalText) finalText = "I did what I could; here's where things stand.";
    }
  } catch (err) {
    // Once a step has changed something, don't start over (that could repeat
    // it on a backup model): say exactly what was done before it stopped.
    if (!toolEvents.length) throw err;
    console.error("AI provider error mid-turn:", err instanceof Error ? err.message : err);
    const done = toolEvents.map((e) => `${e.ok ? "" : "(didn't work) "}${e.display || legacyDisplay(e) || stepDone(e.name, e.ok)}`).join("; ");
    return {
      text: `I got partway before stopping. Done so far: ${done}. Then: ${providerMessage(err)} Check those before asking again.`,
      toolEvents,
      mutated,
      model,
      simulated: false,
      costUsd,
      error: err instanceof BudgetExceededError ? "budget" : "provider",
    };
  } finally {
    // A step the model began but that never ran (stopped, refused, failed) must not look done.
    for (const [id, name] of open) emit(stepEndEvent(id, name, false));
    open.clear();
  }
  return { text: finalText || "Done.", toolEvents, mutated, model, simulated: false, costUsd };
}
