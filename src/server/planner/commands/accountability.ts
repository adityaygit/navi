import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import type { Task } from "@/lib/types";
import { blockCategory } from "@/lib/outcomes";

// Context-aware accountability (decision D3). When Navi is about to take work
// off the plan or push it later, and that work is genuinely at risk (a hard
// deadline inside the risk window, a must-do, or something skipped without
// an outside reason 3+ times in 3 weeks), it challenges ONCE for that
// decision, with the evidence and an alternative. Then:
//  - the person reaffirms (or already gave a reason) → it runs, and the
//    decision is recorded so it's never challenged again;
//  - never for the person's own direct edits; never a permanent block.
// Navi doesn't guess motives: the challenge states only recorded facts.

export type Defer = { task_id: string; title: string; decision: "postpone" | "unschedule" | "exclude" };
export type Challenge = { key: string; text: string };

const REASON = /\b(because|since|cause|cuz|i know|anyway|anyways|already|handed (it )?in|turned (it )?in|submitted|sick|tired|exhausted|appointment|emergency|instead|more important|priority|deadline (moved|extended)|extension|can'?t today|no time)\b/i;
export const AVOIDED_TIMES = 3;

/** Did the person already give a reason or insist, in their own words? */
export function gaveReason(text: string | undefined): boolean {
  return !!text && REASON.test(text);
}

async function atRisk(ctx: Ctx, t: Task, riskHours: number): Promise<string | null> {
  const now = DateTime.now();
  if (t.due_is_hard && t.due_at) {
    const due = DateTime.fromISO(t.due_at);
    if (due > now && due <= now.plus({ hours: riskHours })) return `it's due ${due.setZone(ctx.timezone).toFormat("cccc h:mm a")} (hard deadline)`;
  }
  if (t.commitment === "must") return "you marked it must-do";
  const since = now.minus({ days: 21 }).toISODate()!;
  const { data } = await ctx.db.from("plan_blocks").select("status,outcome_reason").eq("task_id", t.id).eq("status", "skipped").gte("plan_date", since);
  const avoided = ((data ?? []) as { status: string; outcome_reason: string | null }[]).filter((b) => blockCategory(b) === "avoided").length;
  if (avoided >= AVOIDED_TIMES) return `it's been skipped ${avoided} times in the last 3 weeks without an outside reason`;
  return null;
}

/**
 * The one challenge to make before this change, or null to go ahead. Records
 * the decision either way, so the same decision is never challenged twice.
 */
export async function challengeFor(ctx: Ctx, defers: Defer[], opts: { reaffirmed?: boolean; reason?: string | null; riskHours: number }): Promise<Challenge | null> {
  if (ctx.actor !== "navi" || !defers.length) return null;
  for (const d of defers) {
    const { data: t } = await ctx.db.from("tasks").select("*").eq("id", d.task_id).maybeSingle();
    if (!t) continue;
    const why = await atRisk(ctx, t as Task, opts.riskHours);
    if (!why) continue;
    const key = `${d.task_id}:${d.decision}:${(t as Task).due_at ?? DateTime.now().setZone(ctx.timezone).toFormat("kkkk-'W'WW")}`;
    const { data: seen } = await ctx.db.from("accountability_checks").select("id,status").eq("context_key", key).maybeSingle();
    const reason = opts.reason ?? (gaveReason(ctx.userMessage) ? ctx.userMessage!.slice(0, 600) : null);
    if (seen) {
      // Challenged before: this is their answer. Respect it, never ask again.
      if (seen.status === "challenged") await ctx.db.from("accountability_checks").update({ status: "reaffirmed", user_reason: reason }).eq("id", seen.id);
      continue;
    }
    if (opts.reaffirmed || reason) {
      await ctx.db.from("accountability_checks").insert({ user_id: ctx.userId, task_id: d.task_id, decision: d.decision, context_key: key, challenge: `Not asked: ${opts.reaffirmed ? "reaffirmed" : "reason given"}`, status: "reaffirmed", user_reason: reason });
      continue;
    }
    const verb = d.decision === "postpone" ? "Pushing it later" : "Taking it off the plan";
    const text = `Before I do that: “${d.title}” matters because ${why}. ${verb} could put it at risk. I could keep a shorter session for it instead. If you still want it off, say so and I'll do it.`;
    await ctx.db.from("accountability_checks").insert({ user_id: ctx.userId, task_id: d.task_id, decision: d.decision, context_key: key, challenge: text.slice(0, 600), status: "challenged" });
    return { key, text };
  }
  return null;
}
