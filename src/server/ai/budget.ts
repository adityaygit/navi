import "server-only";
import { DateTime } from "luxon";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { tokenCost, VOICE_AUDIO_PRICE_PER_MIN } from "./config";

// Conservative aggregate testing guard for all AI providers (text + voice).
// Spend is recorded from each provider response's own usage numbers and
// priced locally, so it is an estimate; provider billing may lag or differ.
// The day resets at local midnight in NAVI_BUDGET_TIMEZONE (default UTC).
// This app-side guard cannot absolutely cap charges: set provider-side
// spend limits too (see docs/OPERATIONS.md).

export class BudgetExceededError extends Error {
  constructor(public status: BudgetStatus) {
    super(
      `Today's AI testing budget ($${status.capUsd.toFixed(2)}) is used up ($${status.spentUsd.toFixed(2)} spent). ` +
        `New AI calls are paused until ${status.resetsAt} or until you approve an override in Settings.`,
    );
  }
}

export type BudgetStatus = {
  day: string;
  spentUsd: number;
  capUsd: number;
  baseCapUsd: number;
  overrideUsd: number;
  remainingUsd: number;
  ratio: number;
  warn: boolean;
  exceeded: boolean;
  hasUnpricedUsage: boolean;
  resetsAt: string;
  timezone: string;
};

export function budgetDay(at: Date = new Date()): string {
  return DateTime.fromJSDate(at).setZone(serverEnv.budgetTimezone()).toISODate()!;
}

export async function getBudgetStatus(): Promise<BudgetStatus> {
  const admin = createSupabaseAdmin();
  const day = budgetDay();
  const [{ data: rows }, { data: override }] = await Promise.all([
    admin.from("ai_usage").select("cost_usd,cost_is_estimate,model").eq("budget_day", day),
    admin.from("budget_overrides").select("extra_usd").eq("budget_day", day).maybeSingle(),
  ]);
  const spentUsd = (rows ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  const baseCapUsd = serverEnv.dailyBudgetUsd();
  const overrideUsd = override ? Number(override.extra_usd) : 0;
  const capUsd = baseCapUsd + overrideUsd;
  const ratio = capUsd > 0 ? spentUsd / capUsd : 1;
  const zone = serverEnv.budgetTimezone();
  return {
    day,
    spentUsd,
    capUsd,
    baseCapUsd,
    overrideUsd,
    remainingUsd: Math.max(0, capUsd - spentUsd),
    ratio,
    warn: ratio >= serverEnv.budgetWarnRatio(),
    exceeded: spentUsd >= capUsd,
    hasUnpricedUsage: false,
    resetsAt: DateTime.now().setZone(zone).plus({ days: 1 }).startOf("day").toFormat("LLL d, h:mm a ZZZZ"),
    timezone: zone,
  };
}

/**
 * Read-only check (e.g. before offering voice). It doesn't hold anything back,
 * so provider calls use reserveBudget instead.
 */
export async function assertBudget(reserveUsd = 0): Promise<BudgetStatus> {
  const status = await getBudgetStatus();
  if (status.spentUsd + reserveUsd > status.capUsd) throw new BudgetExceededError(status);
  return status;
}

export class RateLimitedError extends Error {}

type UsageIdentity = {
  userId: string | null;
  provider: "anthropic" | "google" | "devsim";
  model: string;
  role: string;
  purpose: string;
};

/**
 * Before a provider call: atomically (one locked step in the database, see
 * migration 20261102000001) check the cap and record a pending row for the
 * pessimistic estimate `amountUsd`, so simultaneous calls can't all squeeze
 * under the cap. Settle the row with settleUsage once the real usage is known.
 * `rateLimit` additionally caps how many rows of this purpose the user may
 * create per window. Returns the reservation's ai_usage id.
 */
export async function reserveBudget(
  entry: UsageIdentity & { amountUsd: number; rateLimit?: { max: number; windowSeconds: number } },
): Promise<string> {
  const admin = createSupabaseAdmin();
  const day = budgetDay();
  const { data: override } = await admin.from("budget_overrides").select("extra_usd").eq("budget_day", day).maybeSingle();
  const cap = serverEnv.dailyBudgetUsd() + (override ? Number(override.extra_usd) : 0);
  const { data, error } = await admin.rpc("ai_reserve", {
    p_user: entry.userId,
    p_provider: entry.provider,
    p_model: entry.model,
    p_role: entry.role,
    p_purpose: entry.purpose,
    p_amount: Math.max(0, entry.amountUsd),
    p_day: day,
    p_cap: cap,
    p_rate_max: entry.rateLimit?.max ?? null,
    p_rate_window_seconds: entry.rateLimit?.windowSeconds ?? null,
  });
  if (error) throw new Error(`Could not reserve AI budget: ${error.message}`);
  const r = data as { ok: boolean; id?: string; reason?: string };
  if (r.ok && r.id) return r.id;
  if (r.reason === "rate_limited") throw new RateLimitedError("Too many voice sessions started in the last few minutes. Wait a bit and try again.");
  throw new BudgetExceededError(await getBudgetStatus());
}

/** Replace a reservation with the call's real usage (or zero if the call failed). Returns the cost. */
export async function settleUsage(
  id: string,
  actual: { model?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number; ok?: boolean },
  model: string,
): Promise<number> {
  const priced = actual.model ?? model;
  const cost =
    actual.costUsd ??
    tokenCost(priced, { input: actual.inputTokens ?? 0, output: actual.outputTokens ?? 0, cacheRead: actual.cacheReadTokens, cacheWrite: actual.cacheWriteTokens }).usd;
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("ai_usage")
    .update({
      model: priced,
      input_tokens: actual.inputTokens ?? 0,
      output_tokens: actual.outputTokens ?? 0,
      cached_input_tokens: actual.cacheReadTokens ?? 0,
      cost_usd: cost,
      ok: actual.ok ?? true,
    })
    .eq("id", id);
  if (error) console.error("ai_usage settle failed:", error.message);
  return cost;
}

// Voice: one reservation per minted Live token. The token stops working after
// VOICE_TOKEN_MINUTES, and VOICE_RESERVE_USD covers that much two-way audio
// (VOICE_TWO_WAY_USD_PER_MIN ≈ $0.023/min), so a client that never reports its
// usage is still charged. The reservation is held while the session may still
// be running; once it ends (the client reports hang-up, or the token's
// lifetime has passed) it is settled to max(reported, elapsed estimate), where
// the elapsed estimate is the server-measured minutes from mint to end (or to
// expiry) at the two-way rate, capped at the reserve. The reservation row's
// audio_seconds records that measured session length (0 = still open).
export const VOICE_TOKEN_MINUTES = 10;
export const VOICE_RESERVE_USD = 0.25;
export const VOICE_TWO_WAY_USD_PER_MIN = VOICE_AUDIO_PRICE_PER_MIN.input + VOICE_AUDIO_PRICE_PER_MIN.output;
export const VOICE_MINTS_PER_WINDOW = { max: 6, windowSeconds: 10 * 60 };
export const VOICE_SESSION_PURPOSE = "voice-session";
/** After this, a session that never reported its end is treated as ended at token expiry. */
const VOICE_EXPIRY_GRACE_SECONDS = 60;

/** The least a session that lasted `seconds` is charged, whatever it reported. */
export function voiceElapsedFloorUsd(seconds: number): number {
  return Math.min(VOICE_RESERVE_USD, (Math.max(0, seconds) / 60) * VOICE_TWO_WAY_USD_PER_MIN);
}

type VoiceSessionRow = { id: string; created_at: string; audio_seconds: number | string; ok: boolean };

/**
 * Brings a session's reservation in line with what is known: still open →
 * the full reserve; ended (or expired, which marks it ended at expiry) → the
 * elapsed estimate. Either way the session costs max(that, reported).
 */
async function settleVoiceSession(row: VoiceSessionRow, now = Date.now()): Promise<void> {
  if (!row.ok) return; // a failed mint was released to $0 and stays there
  const admin = createSupabaseAdmin();
  let ended = Number(row.audio_seconds);
  const lifetime = VOICE_TOKEN_MINUTES * 60;
  if (!(ended > 0) && now - Date.parse(row.created_at) > (lifetime + VOICE_EXPIRY_GRACE_SECONDS) * 1000) {
    // Never reported its end: it can't have run past the token's lifetime.
    await admin.from("ai_usage").update({ audio_seconds: lifetime }).eq("id", row.id).eq("audio_seconds", 0);
    // An end report may have landed first; whichever was recorded counts.
    const { data } = await admin.from("ai_usage").select("audio_seconds").eq("id", row.id).single();
    ended = Number(data?.audio_seconds ?? lifetime) || lifetime;
  }
  const floor = ended > 0 ? voiceElapsedFloorUsd(ended) : VOICE_RESERVE_USD;
  const { error } = await admin.rpc("ai_voice_settle", { p_session: row.id, p_reserve: floor });
  if (error) console.error("voice settle failed:", error.message);
}

/** Settles this user's sessions whose token has expired without an end report. */
export async function settleExpiredVoiceSessions(userId: string): Promise<number> {
  const admin = createSupabaseAdmin();
  const cutoff = new Date(Date.now() - (VOICE_TOKEN_MINUTES * 60 + VOICE_EXPIRY_GRACE_SECONDS) * 1000).toISOString();
  const { data } = await admin
    .from("ai_usage")
    .select("id,created_at,audio_seconds,ok")
    .eq("user_id", userId)
    .eq("purpose", VOICE_SESSION_PURPOSE)
    .eq("ok", true)
    .eq("audio_seconds", 0)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(50);
  for (const row of (data ?? []) as VoiceSessionRow[]) await settleVoiceSession(row);
  return data?.length ?? 0;
}

/**
 * The client hung up (or replaced the session): record the server-measured
 * session length once, and settle. Someone else's session id is ignored.
 */
export async function endVoiceSession(userId: string, sessionId: string): Promise<{ ended: boolean; elapsedSeconds?: number }> {
  const admin = createSupabaseAdmin();
  const { data: row } = await admin
    .from("ai_usage")
    .select("id,created_at,audio_seconds,ok")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("purpose", VOICE_SESSION_PURPOSE)
    .maybeSingle();
  if (!row || !row.ok) return { ended: false };
  if (!(Number(row.audio_seconds) > 0)) {
    const elapsed = Math.min(VOICE_TOKEN_MINUTES * 60, Math.max(1, (Date.now() - Date.parse(row.created_at as string)) / 1000));
    // Only the first end report counts.
    await admin.from("ai_usage").update({ audio_seconds: elapsed }).eq("id", sessionId).eq("audio_seconds", 0);
  }
  const { data: fresh } = await admin.from("ai_usage").select("id,created_at,audio_seconds,ok").eq("id", sessionId).single();
  await settleVoiceSession(fresh as VoiceSessionRow);
  return { ended: true, elapsedSeconds: Number(fresh?.audio_seconds ?? 0) };
}

export async function reserveVoiceSession(userId: string, model: string): Promise<string> {
  // Release what this user's expired, never-ended sessions no longer need before checking the cap.
  await settleExpiredVoiceSessions(userId);
  return reserveBudget({
    userId,
    provider: "google",
    model,
    role: "voice",
    purpose: VOICE_SESSION_PURPOSE,
    amountUsd: VOICE_RESERVE_USD,
    rateLimit: VOICE_MINTS_PER_WINDOW,
  });
}

/**
 * Records one reported voice turn against its session. Reported seconds are
 * clamped to what the session could physically have used (each direction at
 * most the time since the token was minted), and the session as a whole is
 * charged max(reserved, reported) — never both — where "reserved" is the full
 * reserve while the session is open and the elapsed estimate once it ended.
 */
export async function recordVoiceTurn(args: {
  userId: string;
  sessionId?: string | null;
  model: string;
  inputAudioSeconds: number;
  outputAudioSeconds: number;
  inputTokens: number;
  outputTokens: number;
  price: (inSec: number, outSec: number, inTok: number, outTok: number) => number;
}): Promise<{ costUsd: number; inSec: number; outSec: number; sessionId: string | null }> {
  const admin = createSupabaseAdmin();
  let inSec = Math.max(0, args.inputAudioSeconds);
  let outSec = Math.max(0, args.outputAudioSeconds);
  let sessionId: string | null = null;
  // Without a known session a single turn can't be longer than a token lives.
  let limit = VOICE_TOKEN_MINUTES * 60;
  let usedBefore = 0;
  if (args.sessionId) {
    const { data: session } = await admin
      .from("ai_usage")
      .select("id,created_at")
      .eq("id", args.sessionId)
      .eq("user_id", args.userId)
      .eq("purpose", VOICE_SESSION_PURPOSE)
      .maybeSingle();
    if (session) {
      sessionId = session.id as string;
      limit = Math.min(VOICE_TOKEN_MINUTES * 60 + 60, (Date.now() - Date.parse(session.created_at as string)) / 1000 + 5);
      const { data: turns } = await admin.from("ai_usage").select("audio_seconds").eq("session_id", sessionId);
      usedBefore = (turns ?? []).reduce((s, t) => s + Number(t.audio_seconds), 0);
    }
  }
  inSec = Math.min(inSec, limit);
  outSec = Math.min(outSec, limit);
  // Both directions together can't exceed twice the session's lifetime.
  const room = Math.max(0, 2 * limit - usedBefore);
  if (sessionId && inSec + outSec > room) {
    const scale = room / (inSec + outSec);
    inSec *= scale;
    outSec *= scale;
  }
  const inTok = Math.min(Math.max(0, Math.round(args.inputTokens)), 2_000_000);
  const outTok = Math.min(Math.max(0, Math.round(args.outputTokens)), 2_000_000);
  const costUsd = args.price(inSec, outSec, inTok, outTok);
  if (!(inSec || outSec || inTok || outTok)) return { costUsd: 0, inSec, outSec, sessionId };
  const { error } = await admin.from("ai_usage").insert({
    user_id: args.userId,
    provider: "google",
    model: args.model,
    role: "voice",
    purpose: "voice",
    input_tokens: inTok,
    output_tokens: outTok,
    audio_seconds: inSec + outSec,
    cost_usd: costUsd,
    cost_is_estimate: true,
    budget_day: budgetDay(),
    ok: true,
    session_id: sessionId,
  });
  if (error) console.error("ai_usage insert failed:", error.message);
  if (sessionId) {
    // Re-read just before settling: the session may have ended meanwhile.
    const { data: row } = await admin.from("ai_usage").select("id,created_at,audio_seconds,ok").eq("id", sessionId).single();
    if (row) await settleVoiceSession(row as VoiceSessionRow);
  }
  // A report is also a chance to release this user's expired sessions.
  await settleExpiredVoiceSessions(args.userId);
  return { costUsd, inSec, outSec, sessionId };
}

export async function recordUsage(entry: {
  userId: string | null;
  provider: "anthropic" | "google" | "devsim";
  model: string;
  role: string;
  purpose: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  audioSeconds?: number;
  costUsd?: number;
  ok?: boolean;
}): Promise<number> {
  let cost = entry.costUsd ?? 0;
  let estimate = true;
  if (entry.costUsd === undefined && entry.provider !== "devsim") {
    const c = tokenCost(entry.model, {
      input: entry.inputTokens ?? 0,
      output: entry.outputTokens ?? 0,
      cacheRead: entry.cacheReadTokens,
      cacheWrite: entry.cacheWriteTokens,
    });
    cost = c.usd;
    estimate = true;
  }
  const admin = createSupabaseAdmin();
  const { error } = await admin.from("ai_usage").insert({
    user_id: entry.userId,
    provider: entry.provider,
    model: entry.model,
    role: entry.role,
    purpose: entry.purpose,
    input_tokens: entry.inputTokens ?? 0,
    output_tokens: entry.outputTokens ?? 0,
    cached_input_tokens: entry.cacheReadTokens ?? 0,
    audio_seconds: entry.audioSeconds ?? 0,
    cost_usd: cost,
    cost_is_estimate: estimate,
    budget_day: budgetDay(),
    ok: entry.ok ?? true,
  });
  if (error) console.error("ai_usage insert failed:", error.message);
  return cost;
}

/** Owner-approved extra spend for today only (max $20). */
/**
 * The cap is shared by every user, so only the budget owner may raise it:
 * accounts listed in NAVI_ADMIN_EMAILS. With no list, development allows
 * anyone (single local user) and production allows no one.
 */
export function canApproveBudgetOverride(email: string | null | undefined): boolean {
  const admins = serverEnv.adminEmails();
  if (admins.length === 0) return process.env.NODE_ENV !== "production";
  return !!email && admins.includes(email.toLowerCase());
}

export async function approveBudgetOverride(userId: string, email: string | null | undefined, extraUsd: number) {
  if (!canApproveBudgetOverride(email)) throw new Error("Only the budget owner can raise the daily AI budget (set NAVI_ADMIN_EMAILS).");
  if (!(extraUsd > 0 && extraUsd <= 20)) throw new Error("Override must be between $0 and $20");
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("budget_overrides")
    .upsert({ budget_day: budgetDay(), extra_usd: extraUsd, approved_by: userId });
  if (error) throw new Error(error.message);
}
