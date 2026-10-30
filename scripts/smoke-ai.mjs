#!/usr/bin/env node
// Checks that the configured AI providers really work, with a few tiny calls
// (well under one cent in total):
//   1. each Claude model role is accessible (model lookup, then a one-line reply)
//   2. a Gemini Live ephemeral token can be minted and a live session answers
//
//   node scripts/smoke-ai.mjs            # both providers
//   node scripts/smoke-ai.mjs anthropic  # or: gemini
//
// Reads keys from the environment or .env.local and never prints them. Calls
// are recorded in ai_usage (when Supabase is configured) so they count toward
// the daily testing budget, and the script refuses to run if today's budget is
// already used up.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const only = process.argv[2];
const env = process.env;
const roles = {
  fast: env.NAVI_MODEL_FAST || "claude-haiku-5-5",
  planner: env.NAVI_MODEL_PLANNER || "claude-sonnet-5-5",
};
const voiceModel = env.NAVI_MODEL_VOICE || "gemini-3.8-live";
const PRICES = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] }; // $/MTok in, out
const results = [];
let liveSession = null;
const ok = (name, detail) => results.push({ name, ok: true, detail });
const fail = (name, detail) => results.push({ name, ok: false, detail });

async function supabase() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
const budgetDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: env.NAVI_BUDGET_TIMEZONE || "UTC" }).format(new Date());

async function checkBudget(db) {
  if (!db) return;
  const cap = Number(env.NAVI_DAILY_BUDGET_USD || 2);
  const { data } = await db.from("ai_usage").select("cost_usd").eq("budget_day", budgetDay());
  const spent = (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  if (spent >= cap) throw new Error(`Today's AI testing budget is used up ($${spent.toFixed(4)} of $${cap}).`);
  console.log(`Budget today: $${spent.toFixed(4)} of $${cap} used.`);
}

async function record(db, row) {
  if (!db) return;
  await db.from("ai_usage").insert({ ...row, purpose: "smoke-test", budget_day: budgetDay() });
}

async function anthropic(db) {
  if (!env.ANTHROPIC_API_KEY) return fail("anthropic", "ANTHROPIC_API_KEY is not set");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  for (const [role, model] of Object.entries(roles)) {
    try {
      const info = await client.models.retrieve(model);
      const res = await client.messages.create({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with exactly: OK" }] });
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      const [pin, pout] = PRICES[model] ?? [10, 50];
      const cost = (res.usage.input_tokens * pin + res.usage.output_tokens * pout) / 1e6;
      await record(db, { provider: "anthropic", model, role, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, cost_usd: cost });
      ok(`claude ${role} (${model})`, `"${info.display_name ?? model}" replied "${text.slice(0, 20)}" · ${res.usage.input_tokens}+${res.usage.output_tokens} tokens ≈ $${cost.toFixed(6)}`);
    } catch (e) {
      fail(`claude ${role} (${model})`, `${e.status ?? ""} ${e.message}`.trim());
    }
  }
}

async function gemini(db) {
  if (!env.GEMINI_API_KEY) return fail("gemini live", "GEMINI_API_KEY is not set");
  const { GoogleGenAI, Modality } = await import("@google/genai");
  const server = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const now = Date.now();
  let token;
  try {
    token = await server.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 5 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        liveConnectConstraints: { model: voiceModel, config: { responseModalities: [Modality.AUDIO], outputAudioTranscription: {} } },
      },
    });
    ok("gemini token", "single-use ephemeral token minted (the API key never leaves the server)");
  } catch (e) {
    return fail("gemini token", e.message);
  }
  // Connect the way the browser does: with the token, not the key.
  const client = new GoogleGenAI({ apiKey: token.name });
  const started = Date.now();
  let transcript = "";
  let audioBytes = 0;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no reply within 20s")), 20_000);
      client.live
        .connect({
          model: voiceModel,
          config: { responseModalities: [Modality.AUDIO], outputAudioTranscription: {} },
          callbacks: {
            onmessage: (m) => {
              transcript += m.serverContent?.outputTranscription?.text ?? "";
              for (const p of m.serverContent?.modelTurn?.parts ?? []) audioBytes += p.inlineData?.data ? Buffer.from(p.inlineData.data, "base64").length : 0;
              if (m.serverContent?.turnComplete) {
                clearTimeout(timer);
                resolve();
              }
            },
            onerror: (e) => reject(new Error(e.message ?? "socket error")),
            onclose: (e) => e?.code && e.code !== 1000 && reject(new Error(`closed: ${e.code} ${e.reason ?? ""}`)),
          },
        })
        .then((session) => {
          session.sendClientContent({ turns: [{ role: "user", parts: [{ text: "Say OK." }] }], turnComplete: true });
          liveSession = session;
        }, reject);
    });
    liveSession?.close();
    const outSec = audioBytes / 2 / 24000;
    const cost = (outSec / 60) * 0.018;
    await record(db, { provider: "google", model: voiceModel, role: "voice", audio_seconds: outSec, cost_usd: cost });
    ok(`gemini live (${voiceModel})`, `spoke ${outSec.toFixed(1)}s of audio, transcript "${transcript.trim().slice(0, 40)}" in ${((Date.now() - started) / 1000).toFixed(1)}s ≈ $${cost.toFixed(6)}`);
  } catch (e) {
    liveSession?.close();
    fail(`gemini live (${voiceModel})`, e.message);
  }
}
try {
  const db = await supabase();
  await checkBudget(db);
  if (!only || only === "anthropic") await anthropic(db);
  if (!only || only === "gemini") await gemini(db);
} catch (e) {
  fail("setup", e.message);
}
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}: ${r.detail}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
