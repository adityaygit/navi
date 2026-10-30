import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, ctxFor, resetUser, userClient } from "./helpers";

// Server half of real-time voice with only Google's token endpoint mocked:
// the session carries the shared text+voice history, Navi's memory and the
// same tools as chat, and the minted token is single-use, short-lived and
// locks model, instructions and tools so the browser can't change them.

const createToken = vi.fn(async () => ({ name: "auth_tokens/minted" }));
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class FakeGenAI {
    authTokens = { create: createToken };
    constructor(public opts: unknown) {}
  }
  return { ...actual, GoogleGenAI: FakeGenAI };
});

const { buildVoiceSession, mintVoiceToken } = await import("@/server/ai/voice");
type Decl = { name?: string };
const declaredNames = (tools: unknown) => ((tools as { functionDeclarations: Decl[] }[])[0].functionDeclarations ?? []).map((f) => f.name);
const { saveMessage, getOrCreateConversation } = await import("@/server/ai/chat");
const budget = await import("@/server/ai/budget");
const { tokenCost, voiceCost } = await import("@/server/ai/config");

let db: Awaited<ReturnType<typeof userClient>>["db"];
let userId = "";

beforeAll(async () => {
  ({ db, userId } = await userClient("bob@navi.test"));
  await resetUser(userId);
  vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
});
const clearUsage = () => admin().from("ai_usage").delete().eq("user_id", userId).in("purpose", ["voice-session", "voice", "race-test", "race-fill"]);
afterAll(async () => {
  vi.unstubAllEnvs();
  await clearUsage();
});

describe("voice session setup", () => {
  it("shares history, memory and tools with chat, and mints a locked single-use token", async () => {
    const ctx = ctxFor(db, userId);
    const conv = await getOrCreateConversation(ctx, "chat");
    await saveMessage(ctx, conv, "user", "I typed this earlier", "text");
    await saveMessage(ctx, conv, "assistant", "And I answered in text", "text");
    await db.from("memories").insert({ user_id: userId, kind: "profile", content: "Prefers short answers", origin: "stated" });

    const { conversationId, config } = await buildVoiceSession(ctx, "chat");
    expect(conversationId).toBe(conv);
    const system = String(config.systemInstruction);
    expect(system).toContain("User: I typed this earlier");
    expect(system).toContain("Navi: And I answered in text");
    expect(system).toContain("Prefers short answers");
    expect(config).toMatchObject({ inputAudioTranscription: {}, outputAudioTranscription: {}, sessionResumption: {} });
    const names = declaredNames(config.tools);
    expect(names).toEqual(expect.arrayContaining(["propose_items", "create_task", "plan_day", "recover_plan", "remember", "request_external_action", "get_plan", "get_inbox", "search_items"]));
    // The session's state is a snapshot; voice is told to read other days and the inbox with tools.
    expect(system).toContain(`call get_plan with date "tomorrow"`);
    expect(system).toMatch(/Current state \(a snapshot taken at the start of this voice session/);
    expect(system).toMatch(/Tomorrow's plan \(/);
    expect(names).not.toContain("mark_onboarding_ready");

    const before = Date.now();
    const minted = await mintVoiceToken(config, "resume-me");
    expect(minted.token).toBe("auth_tokens/minted");
    const args = (createToken.mock.calls[0] as unknown as [{ config: Record<string, unknown> }])[0].config;
    expect(args.uses).toBe(1);
    expect(Date.parse(String(args.newSessionExpireTime)) - before).toBeLessThanOrEqual(61_000);
    // The token lives only as long as its budget reservation covers (10 min).
    expect(Date.parse(String(args.expireTime)) - before).toBeLessThanOrEqual(10 * 60_000 + 1000);
    expect(args.liveConnectConstraints).toMatchObject({
      model: "gemini-3.8-live",
      config: { systemInstruction: config.systemInstruction, tools: config.tools, sessionResumption: { handle: "resume-me" } },
    });
    // The browser gets the token, never the key.
    expect(JSON.stringify(minted)).not.toContain("test-key-not-real");
  });

  it("offers onboarding its own, narrower tool set", async () => {
    const { config } = await buildVoiceSession(ctxFor(db, userId), "onboarding");
    const names = declaredNames(config.tools).sort();
    expect(names).toEqual(["get_overview", "mark_onboarding_ready", "propose_items", "remember", "update_settings"]);
  });
});

// Security review M2/L2: voice spend no longer depends on what the browser reports.
describe("voice budget is enforced server-side", () => {
  const price = (model: string) => (inSec: number, outSec: number, inTok: number, outTok: number) =>
    Math.max(voiceCost(inSec, outSec), tokenCost(model, { input: inTok, output: outTok }).usd);
  const sessionTotal = async (id: string) => {
    const { data } = await admin().from("ai_usage").select("cost_usd").or(`id.eq.${id},session_id.eq.${id}`);
    return (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  };

  it("reserves the token's whole lifetime when it's minted and limits how many a person can mint", async () => {
    await clearUsage();
    vi.stubEnv("NAVI_DAILY_BUDGET_USD", "1000");
    const ids: string[] = [];
    for (let i = 0; i < budget.VOICE_MINTS_PER_WINDOW.max; i++) ids.push(await budget.reserveVoiceSession(userId, "gemini-3.8-live"));
    const { data: rows } = await admin().from("ai_usage").select("cost_usd,purpose").in("id", ids);
    expect(rows!.every((r) => Number(r.cost_usd) === budget.VOICE_RESERVE_USD && r.purpose === "voice-session")).toBe(true);
    await expect(budget.reserveVoiceSession(userId, "gemini-3.8-live")).rejects.toBeInstanceOf(budget.RateLimitedError);
    vi.unstubAllEnvs();
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    await clearUsage();
  });

  it("charges a session max(reserved, reported) once, and clamps impossible reported audio", async () => {
    vi.stubEnv("NAVI_DAILY_BUDGET_USD", "1000");
    const model = "gemini-3.8-live";
    const id = await budget.reserveVoiceSession(userId, model);
    // A client claiming an hour of audio on a token minted a moment ago.
    const inflated = await budget.recordVoiceTurn({ userId, sessionId: id, model, inputAudioSeconds: 3600, outputAudioSeconds: 3600, inputTokens: 0, outputTokens: 0, price: price(model) });
    expect(inflated.inSec).toBeLessThan(15);
    expect(inflated.outSec).toBeLessThan(15);
    // Reported so far is under the reserve: the session still costs exactly the reserve.
    expect(await sessionTotal(id)).toBeCloseTo(budget.VOICE_RESERVE_USD, 6);
    // Reported token usage beyond the reserve: the session costs what was reported, not reserve + reported.
    const big = await budget.recordVoiceTurn({ userId, sessionId: id, model, inputAudioSeconds: 0, outputAudioSeconds: 0, inputTokens: 100_000, outputTokens: 50_000, price: price(model) });
    expect(big.costUsd).toBeCloseTo(tokenCost(model, { input: 100_000, output: 50_000 }).usd, 6);
    expect(await sessionTotal(id)).toBeCloseTo(inflated.costUsd + big.costUsd, 6);
    const { data: reservation } = await admin().from("ai_usage").select("cost_usd").eq("id", id).single();
    expect(Number(reservation!.cost_usd)).toBe(0);
    // Someone else's session id is ignored (no reconciling against it).
    const { userId: aliceId } = await userClient("alice@navi.test");
    const foreign = await budget.recordVoiceTurn({ userId: aliceId, sessionId: id, model, inputAudioSeconds: 2, outputAudioSeconds: 2, inputTokens: 0, outputTokens: 0, price: price(model) });
    expect(foreign.sessionId).toBeNull();
    await admin().from("ai_usage").delete().eq("user_id", aliceId).eq("purpose", "voice");
    vi.unstubAllEnvs();
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    await clearUsage();
  });

  it("lets only as many simultaneous calls through as the budget can cover", async () => {
    const before = await budget.getBudgetStatus();
    // Leave room for exactly one $0.10 call.
    const { data: fill } = await admin()
      .from("ai_usage")
      .insert({ user_id: userId, provider: "anthropic", model: "claude-sonnet-5-5", role: "planner", purpose: "race-fill", cost_usd: before.capUsd - before.spentUsd - 0.15, budget_day: budget.budgetDay() })
      .select("id")
      .single();
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => budget.reserveBudget({ userId, provider: "anthropic", model: "claude-sonnet-5-5", role: "planner", purpose: "race-test", amountUsd: 0.1 })),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected" && r.reason instanceof budget.BudgetExceededError)).toHaveLength(5);
    } finally {
      await admin().from("ai_usage").delete().eq("id", fill!.id);
      await clearUsage();
    }
  });
});
