import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { admin, ctxFor, resetUser, userClient } from "./helpers";

// The real Claude tool loop (runAgent → runAnthropic) with only the network
// call replaced: request shape, tool execution against the real database,
// tool results fed back, usage recorded for the served model, refusals,
// planner fallback, and the budget stop. No API key or spend involved.

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Fake extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      super(opts);
      (this as unknown as { beta: unknown }).beta = { messages: { create } };
    }
  }
  return { ...actual, default: Fake };
});

const { runAgent } = await import("@/server/ai/agent");
const { default: RealAnthropic } = await import("@anthropic-ai/sdk");

let db: Awaited<ReturnType<typeof userClient>>["db"];
let userId = "";

const reply = (over: Partial<Anthropic.Beta.BetaMessage>): Anthropic.Beta.BetaMessage =>
  ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    stop_reason: "end_turn",
    content: [],
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    ...over,
  }) as unknown as Anthropic.Beta.BetaMessage;

const request = (role: "fast" | "planner", userText: string) => ({
  ctx: ctxFor(db, userId),
  mode: "chat" as const,
  role,
  system: "SYSTEM",
  context: "CONTEXT",
  history: [],
  userText,
  purpose: "test",
});

beforeAll(async () => {
  ({ db, userId } = await userClient("bob@navi.test"));
  await resetUser(userId);
});
beforeEach(() => {
  create.mockReset();
  vi.stubEnv("NAVI_AI_PROVIDER", "anthropic");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await admin().from("ai_usage").delete().eq("user_id", userId).eq("purpose", "test");
});

describe("Claude tool loop", () => {
  it("runs requested tools for real, returns their results, and records usage", async () => {
    create
      .mockResolvedValueOnce(
        reply({
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Let me put that in your inbox." },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "propose_items",
              input: { items: [{ kind: "task", payload: { title: "Book flights home" }, source_excerpt: "book flights home", origin: "stated", confidence: 0.9 }] },
            },
          ] as Anthropic.Beta.BetaContentBlock[],
        }),
      )
      .mockResolvedValueOnce(reply({ content: [{ type: "text", text: "Added “Book flights home” to your inbox." }] as Anthropic.Beta.BetaContentBlock[] }));

    const r = await runAgent(request("fast", "I need to book flights home"));

    expect(r).toMatchObject({ text: "Added “Book flights home” to your inbox.", mutated: true, simulated: false, model: "claude-haiku-5-5" });
    expect(r.toolEvents).toEqual([expect.objectContaining({ name: "propose_items", ok: true })]);
    const first = create.mock.calls[0][0];
    expect(first).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low" } });
    expect(first.system[0]).toEqual({ type: "text", text: "SYSTEM", cache_control: { type: "ephemeral" } });
    expect(first.tool_choice).toBeUndefined(); // forced tool choice is a 400 on current models
    expect(first.betas).toBeUndefined(); // no server-side fallback on Haiku
    expect(first.tools.map((t: { name: string }) => t.name)).toContain("propose_items");
    const second = create.mock.calls[1][0];
    const toolResult = second.messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1", is_error: false });
    expect(JSON.parse(toolResult.content)).toMatchObject({ ok: true });
    // The assistant turn is passed back whole (append-only history).
    expect(second.messages.at(-2)).toEqual({ role: "assistant", content: expect.arrayContaining([expect.objectContaining({ type: "tool_use", id: "toolu_1" })]) });

    const { data: proposal } = await db.from("proposals").select("status,payload").eq("source_excerpt", "book flights home").single();
    expect(proposal).toMatchObject({ status: "pending", payload: { title: "Book flights home" } });
    const { count } = await admin().from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("purpose", "test");
    expect(count).toBe(2);
  });

  it("reports a failed tool to the model instead of hiding it", async () => {
    create
      .mockResolvedValueOnce(reply({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "toolu_bad", name: "complete_task", input: { id: "not-a-uuid" } }] as Anthropic.Beta.BetaContentBlock[] }))
      .mockResolvedValueOnce(reply({ content: [{ type: "text", text: "I couldn't find that task." }] as Anthropic.Beta.BetaContentBlock[] }));
    const r = await runAgent(request("fast", "mark it done"));
    const toolResult = create.mock.calls[1][0].messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ tool_use_id: "toolu_bad", is_error: true });
    expect(r.toolEvents).toEqual([expect.objectContaining({ name: "complete_task", ok: false })]);
    expect(r.mutated).toBe(false);
  });

  it("uses server-side refusal fallbacks on the planner and records the model that actually answered", async () => {
    create.mockResolvedValueOnce(reply({ model: "claude-opus-5-5", content: [{ type: "text", text: "Here's a realistic week." }] as Anthropic.Beta.BetaContentBlock[] }));
    const r = await runAgent(request("planner", "plan my week"));
    expect(create.mock.calls[0][0]).toMatchObject({ model: "claude-sonnet-5-5", betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "medium" } });
    expect(r.text).toBe("Here's a realistic week.");
    const { data } = await admin().from("ai_usage").select("model").eq("user_id", userId).eq("purpose", "test").order("created_at", { ascending: false }).limit(1).single();
    expect(data!.model).toBe("claude-opus-5-5");
  });

  it("says plainly when the request was declined and changes nothing", async () => {
    create.mockResolvedValueOnce(reply({ stop_reason: "refusal", content: [{ type: "text", text: "partial" }] as Anthropic.Beta.BetaContentBlock[] }));
    const r = await runAgent(request("fast", "something declined"));
    expect(r.text).toBe("I can't help with that one. Nothing was changed.");
    expect(r.mutated).toBe(false);
  });

  it("falls back to the backup model when the planner model is unavailable", async () => {
    create
      .mockRejectedValueOnce(new RealAnthropic.NotFoundError(404, { type: "error", error: { type: "not_found_error", message: "model not found" } }, "model not found", new Headers()))
      .mockResolvedValueOnce(reply({ content: [{ type: "text", text: "Planned with the backup model." }] as Anthropic.Beta.BetaContentBlock[] }));
    const r = await runAgent(request("planner", "plan my day"));
    expect(create.mock.calls[1][0].model).toBe("claude-haiku-5-5");
    expect(create.mock.calls[1][0].betas).toBeUndefined();
    expect(r).toMatchObject({ text: "Planned with the backup model.", model: "claude-haiku-5-5" });
  });

  it("explains provider errors without losing anything", async () => {
    create.mockRejectedValueOnce(new RealAnthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }, "bad key", new Headers()));
    const r = await runAgent(request("fast", "hello"));
    expect(r).toMatchObject({ error: "provider", text: expect.stringMatching(/rejected the server's API key.*Nothing was lost/) });
  });

  it("stops before calling the model when the daily budget is used up", async () => {
    const a = admin();
    const { budgetDay } = await import("@/server/ai/budget");
    const { data: row } = await a.from("ai_usage").insert({ user_id: userId, provider: "anthropic", model: "claude-sonnet-5-5", role: "planner", purpose: "budget-fill", cost_usd: 5, budget_day: budgetDay() }).select("id").single();
    try {
      const r = await runAgent(request("fast", "hello"));
      expect(r.error).toBe("budget");
      expect(create).not.toHaveBeenCalled();
    } finally {
      await a.from("ai_usage").delete().eq("id", row!.id);
    }
  });
});
