import "server-only";
import { serverEnv } from "@/lib/env";

// Model roles and pricing. Model IDs live only here (and in env overrides);
// the rest of the app asks for a role, never a specific model.

export type ModelRole = "fast" | "planner" | "voice";

export function modelFor(role: ModelRole): string {
  const m = serverEnv.models();
  return role === "fast" ? m.fast : role === "planner" ? m.planner : m.voice;
}

/**
 * USD per 1M tokens (Claude) and per minute of audio (Gemini Live).
 * Sources checked 2026-10-30: Anthropic model table (Haiku 5.5 $0.10/$0.50,
 * Sonnet 5.5 $2/$10) and ai.google.dev pricing (gemini-3.8-live audio
 * $0.005/min in, $0.018/min out; text $0.75/$4.50 per 1M). Unknown models are
 * priced at the most expensive known rate so the guard errs on the safe side.
 */
type Price = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
const TOKEN_PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "gemini-3.8-live": { input: 0.75, output: 4.5 },
};
const FALLBACK_PRICE: Price = { input: 10, output: 50 };

export const VOICE_AUDIO_PRICE_PER_MIN = { input: 0.005, output: 0.018 };

export function tokenCost(
  model: string,
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): { usd: number; known: boolean } {
  const price = TOKEN_PRICES[model];
  const p = price ?? FALLBACK_PRICE;
  const usd =
    (usage.input * p.input +
      usage.output * p.output +
      (usage.cacheRead ?? 0) * (p.cacheRead ?? p.input) +
      (usage.cacheWrite ?? 0) * (p.cacheWrite ?? p.input * 1.25)) /
    1_000_000;
  return { usd, known: Boolean(price) };
}

export function voiceCost(inputAudioSeconds: number, outputAudioSeconds: number): number {
  return (inputAudioSeconds / 60) * VOICE_AUDIO_PRICE_PER_MIN.input + (outputAudioSeconds / 60) * VOICE_AUDIO_PRICE_PER_MIN.output;
}

export type AiAvailability =
  | { mode: "anthropic"; ready: true }
  | { mode: "devsim"; ready: true }
  | { mode: "none"; ready: false; reason: string };

export function aiAvailability(): AiAvailability {
  const provider = serverEnv.aiProvider();
  if (provider === "devsim") return { mode: "devsim", ready: true };
  if (serverEnv.anthropicApiKey()) return { mode: "anthropic", ready: true };
  return { mode: "none", ready: false, reason: "No Anthropic API key is configured on the server (ANTHROPIC_API_KEY)." };
}

export function voiceAvailability(): { ready: boolean; reason?: string; model: string } {
  const model = modelFor("voice");
  if (!serverEnv.geminiApiKey()) return { ready: false, reason: "No Gemini API key is configured on the server (GEMINI_API_KEY).", model };
  return { ready: true, model };
}
