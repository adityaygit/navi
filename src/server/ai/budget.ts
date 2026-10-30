import "server-only";
import { DateTime } from "luxon";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { tokenCost } from "./config";

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
 * Called before every provider request. `reserveUsd` is a pessimistic estimate
 * of the call about to be made, so a single large call can't blow past the cap.
 */
export async function assertBudget(reserveUsd = 0): Promise<BudgetStatus> {
  const status = await getBudgetStatus();
  if (status.spentUsd + reserveUsd > status.capUsd) throw new BudgetExceededError(status);
  return status;
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
export async function approveBudgetOverride(userId: string, extraUsd: number) {
  if (!(extraUsd > 0 && extraUsd <= 20)) throw new Error("Override must be between $0 and $20");
  const admin = createSupabaseAdmin();
  const { error } = await admin
    .from("budget_overrides")
    .upsert({ budget_day: budgetDay(), extra_usd: extraUsd, approved_by: userId });
  if (error) throw new Error(error.message);
}
