import "server-only";
import type { Ctx } from "@/server/context";
import type { PlanningRule } from "@/lib/types";
import { logActivity } from "./activity";

// Planning preferences Navi applies (decision D5), with their source, scope
// and confidence, all inspectable and editable by the person:
//   - stated: the person said it ("ELA things always take me longer") → active.
//   - inferred/observed: Navi's guess from evidence → "suggested", never
//     applied until the person confirms it (an assumption never silently
//     becomes a rule).
//   - a one-time exception is a day fact (day_exceptions) or a single task's
//     estimate, never a rule; `expires_on` makes a rule temporary.
// The planner reads only active, unexpired rules (plan-v2 estimateScales /
// loadCapRule).

export type RuleInput = {
  kind: PlanningRule["kind"];
  scope: PlanningRule["scope"];
  scope_id?: string | null;
  params: Record<string, unknown>;
  source: PlanningRule["source"];
  confidence?: number | null;
  note?: string | null;
  expires_on?: string | null;
};

function cleanParams(kind: PlanningRule["kind"], params: Record<string, unknown>): Record<string, unknown> {
  if (kind === "estimate_scale") {
    const f = Number(params.factor);
    if (!Number.isFinite(f) || f < 0.5 || f > 3) throw new Error("An estimate scale needs factor between 0.5 and 3 (e.g. 1.5 = takes 50% longer).");
    return { factor: Math.round(f * 100) / 100 };
  }
  const c = Number(params.cap);
  if (!Number.isFinite(c) || c < 0.1 || c > 1) throw new Error("A daily load cap needs cap between 0.1 and 1 (share of free time to fill).");
  const days = Array.isArray(params.days) ? (params.days as unknown[]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : null;
  return { cap: Math.round(c * 100) / 100, ...(days?.length ? { days } : {}) };
}

export async function addPlanningRule(ctx: Ctx, input: RuleInput): Promise<PlanningRule> {
  const params = cleanParams(input.kind, input.params);
  const scopeId = input.scope === "global" ? null : input.scope_id ?? null;
  if (input.scope !== "global" && !scopeId) throw new Error(`A ${input.scope} rule needs the ${input.scope}'s id.`);
  const status = input.source === "stated" ? "active" : "suggested";
  const confidence = input.source === "stated" ? 1 : Math.min(0.8, Math.max(0.1, input.confidence ?? 0.5));
  const { data, error } = await ctx.db
    .from("planning_rules")
    .insert({ user_id: ctx.userId, kind: input.kind, scope: input.scope, scope_id: scopeId, params, source: input.source, confidence, status, note: input.note ?? null, expires_on: input.expires_on ?? null })
    .select("*")
    .single();
  if (error) throw new Error(`Could not save that: ${error.message}`);
  await logActivity(ctx, { action: "create", entityType: "planning_rules", entityId: data.id, summary: `${status === "active" ? "Planning rule" : "Suggested planning rule"}: ${describeRule(data as PlanningRule)}`, before: null, after: data, reversible: true });
  return data as PlanningRule;
}

export async function listPlanningRules(ctx: Ctx): Promise<PlanningRule[]> {
  const { data, error } = await ctx.db.from("planning_rules").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanningRule[];
}

export async function changePlanningRule(ctx: Ctx, id: string, change: { action: "confirm" | "pause" | "resume" | "remove" | "edit"; params?: Record<string, unknown>; expires_on?: string | null; note?: string | null }): Promise<string> {
  const { data: before } = await ctx.db.from("planning_rules").select("*").eq("id", id).maybeSingle();
  if (!before) throw new Error("That planning rule doesn't exist (or isn't yours).");
  const rule = before as PlanningRule;
  if (change.action === "remove") {
    const { error } = await ctx.db.from("planning_rules").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await logActivity(ctx, { action: "delete", entityType: "planning_rules", entityId: id, summary: `Removed planning rule: ${describeRule(rule)}`, before: rule, reversible: false });
    return `Removed: ${describeRule(rule)}`;
  }
  const patch: Record<string, unknown> = {};
  if (change.action === "confirm") Object.assign(patch, { status: "active", source: rule.source === "stated" ? "stated" : rule.source, confidence: 1 });
  if (change.action === "pause") patch.status = "paused";
  if (change.action === "resume") patch.status = rule.confidence >= 1 || rule.source === "stated" ? "active" : "suggested";
  if (change.params) patch.params = cleanParams(rule.kind, { ...rule.params, ...change.params });
  if (change.expires_on !== undefined) patch.expires_on = change.expires_on;
  if (change.note !== undefined) patch.note = change.note;
  if (!Object.keys(patch).length) return "Nothing to change.";
  const { data, error } = await ctx.db.from("planning_rules").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  const prior: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) prior[k] = (rule as Record<string, unknown>)[k];
  await logActivity(ctx, { action: "update", entityType: "planning_rules", entityId: id, summary: `Changed planning rule: ${describeRule(data as PlanningRule)}`, before: prior, after: patch, reversible: true });
  return `Now: ${describeRule(data as PlanningRule)}`;
}

export function describeRule(r: Pick<PlanningRule, "kind" | "scope" | "params" | "status" | "source" | "expires_on">): string {
  const where = r.scope === "global" ? "everything" : `this ${r.scope}`;
  const what =
    r.kind === "estimate_scale"
      ? `estimates for ${where} ×${(r.params as { factor: number }).factor}`
      : `fill at most ${Math.round(Number((r.params as { cap: number }).cap) * 100)}% of free time${Array.isArray((r.params as { days?: number[] }).days) ? ` on ${((r.params as { days: number[] }).days).map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join("/")}` : ""}`;
  return `${what} (${r.status === "suggested" ? "suggested, not applied until you confirm" : r.status}; ${r.source}${r.expires_on ? `; until ${r.expires_on}` : ""})`;
}
