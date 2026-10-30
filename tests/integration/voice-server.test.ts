import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ctxFor, resetUser, userClient } from "./helpers";

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

let db: Awaited<ReturnType<typeof userClient>>["db"];
let userId = "";

beforeAll(async () => {
  ({ db, userId } = await userClient("bob@navi.test"));
  await resetUser(userId);
  vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
});
afterAll(() => vi.unstubAllEnvs());

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
    expect(Date.parse(String(args.expireTime)) - before).toBeLessThanOrEqual(31 * 60_000);
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
