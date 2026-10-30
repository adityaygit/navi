import "server-only";
import { Behavior, GoogleGenAI, Modality, type FunctionDeclaration, type LiveConnectConfig } from "@google/genai";
import type { Ctx } from "@/server/context";
import { serverEnv } from "@/lib/env";
import { buildContext, getOrCreateConversation, listMessages } from "./chat";
import { CHAT_SYSTEM, ONBOARDING_SYSTEM } from "./prompts";
import { jsonSchemaFor, toolsFor } from "./tools";
import { modelFor } from "./config";

// Real-time voice through the Gemini Live API. The browser connects directly
// to Gemini with a short-lived, single-use ephemeral token whose model,
// instructions and tool list are locked server-side, so the API key never
// reaches the client. Tool calls come back to our server (/api/voice/tool)
// and run through the same permissioned tools as text chat; transcripts are
// saved into the same conversation (/api/voice/turn). Raw audio is never stored.
//
// Verified against @google/genai 2.32 types and ai.google.dev docs (2026-10-30);
// not yet exercised against the live service because no GEMINI_API_KEY is set.

const VOICE_STYLE = `

You are speaking aloud in a real-time voice conversation. Keep replies short and natural (one to three sentences), ask one question at a time, never read IDs, URLs or long lists aloud, and say briefly what you did after using a tool. If the user interrupts, stop and listen.`;

export function voiceFunctionDeclarations(kind: "chat" | "onboarding"): FunctionDeclaration[] {
  return toolsFor(kind === "onboarding" ? "onboarding" : "voice").map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: jsonSchemaFor(t),
    // Wait for our tool result before speaking, so Navi never claims an action it hasn't done.
    behavior: Behavior.BLOCKING,
  }));
}

export async function buildVoiceSession(ctx: Ctx, kind: "chat" | "onboarding") {
  const conversationId = await getOrCreateConversation(ctx, kind);
  const recent = await listMessages(ctx, conversationId, 12);
  const history = recent
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === "user" ? "User" : "Navi"}${m.modality === "voice" ? " (voice)" : ""}: ${m.content.slice(0, 600)}`)
    .join("\n");
  const context = await buildContext({ ...ctx, conversationId }, recent.at(-1)?.content ?? "", "voice");
  const system =
    (kind === "onboarding" ? ONBOARDING_SYSTEM : CHAT_SYSTEM) +
    VOICE_STYLE +
    `\n\n${context}\n\nRecent conversation (text and voice share this history):\n${history || "(none yet)"}`;

  const config: LiveConnectConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: system,
    tools: [{ functionDeclarations: voiceFunctionDeclarations(kind) }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: {},
  };
  return { conversationId, config };
}

export async function mintVoiceToken(config: LiveConnectConfig, resumeHandle?: string | null) {
  const apiKey = serverEnv.geminiApiKey();
  if (!apiKey) throw new Error("Voice is not configured (GEMINI_API_KEY missing)");
  const model = modelFor("voice");
  const client = new GoogleGenAI({ apiKey });
  const now = Date.now();
  const lockedConfig: LiveConnectConfig = resumeHandle ? { ...config, sessionResumption: { handle: resumeHandle } } : config;
  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
      // Lock model, instructions and tools so the client can't change them.
      liveConnectConstraints: { model, config: lockedConfig },
    },
  });
  if (!token.name) throw new Error("Gemini did not return a token");
  return { token: token.name, model, config: lockedConfig };
}
