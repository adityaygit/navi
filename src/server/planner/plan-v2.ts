import "server-only";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import type { AvailabilityRule, CalendarEvent, DayException, OccurrenceOverride, PlanBlock, Profile, Routine, Task } from "@/lib/types";
import { planningPrefs } from "@/lib/planner-flag";
import { nowIn } from "@/lib/time";
import { wakeBed } from "@/server/day";
import { logActivity } from "@/server/domain/activity";
import { requestApproval } from "@/server/domain/approvals";
import { summarizeDayPlan, summarizeWeekPlan, type PlanChange } from "@/lib/plan-summary";
import { learnedEstimateRatio } from "./scheduler";
import { buildDayModel, isWakeBedDefault, typicalHoursFor, type DayModel } from "./day-model";
import { scheduleDayV2, type SchedulerV2Output } from "./scheduler-v2";
import { clarificationFor, shortfalls, tradeoffs, type Shortfall } from "./horizon";

// Planner v2 persistence. A planning run works out the plan for one or more
// days and saves it as ONE change set (plan_changesets): the exact block
// inserts, moves and deletes against the current plan, applied in one locked
// database step (apply_plan_changeset) and undone the same way
// (revert_plan_changeset). Blocks that stay put keep their ids. A run can
// instead be *proposed*: nothing changes until the person approves its card.
// Never touches fixed, user-made, pinned, started or marked blocks, never
// marks work done, never drops a task.

const KEEP_STATUSES = ["in_progress", "done", "partial", "skipped", "missed", "rest", "interrupted"];

export type PlanTrigger = "button" | "chat" | "voice" | "tick" | "recovery" | "event_change" | "overrun" | "onboarding";

export type PlanResultV2 = SchedulerV2Output & {
  date: string;
  moved: number;
  estimateSamples: number;
  estimateRatio: number;
  model: DayModel;
  shortfalls: Shortfall[];
  tradeoffs: string[];
  clarification: string | null;
  proposed: boolean;
};

export type PlanRun = {
  results: PlanResultV2[];
  changesetId: string | null;
  status: "applied" | "proposed" | "unchanged";
  actionId: string | null;
  summary: string;
  undo: string[];
  /** What the run changes, for the chat card's disclosure. */
  changes: PlanChange[];
};

type Op =
  | { op: "insert"; block: { id: string; task_id: string | null; routine_id: string | null; title: string; plan_date: string; starts_at: string; ends_at: string; reason: string; basis: string | null; assumption: string | null } }
  | { op: "update"; id: string; title: string; moved: boolean; before: Record<string, unknown>; after: Record<string, unknown> }
  | { op: "delete"; id: string; before: Record<string, unknown> }
  | { op: "status"; id: string; title: string; before: { status: string; outcome_reason: string | null }; after: { status: string; outcome_reason: string | null } };

type Inputs = Awaited<ReturnType<typeof loadInputs>>;

async function loadInputs(ctx: Ctx, first: string, last: string) {
  const historyFrom = DateTime.fromISO(first).minus({ days: 28 }).toISODate()!;
  const q = await Promise.all([
    ctx.db.from("tasks").select("*").eq("user_id", ctx.userId).in("status", ["todo", "in_progress", "blocked"]),
    ctx.db.from("events").select("*").eq("user_id", ctx.userId).neq("status", "cancelled"),
    ctx.db.from("event_occurrence_overrides").select("*").eq("user_id", ctx.userId),
    ctx.db.from("routines").select("*").eq("user_id", ctx.userId).eq("active", true),
    ctx.db.from("availability_rules").select("*").eq("user_id", ctx.userId),
    ctx.db.from("day_exceptions").select("*").eq("user_id", ctx.userId).gte("date", first).lte("date", last),
    ctx.db.from("task_dependencies").select("task_id,depends_on_task_id").eq("user_id", ctx.userId),
    ctx.db.from("plan_blocks").select("starts_at,ends_at").eq("user_id", ctx.userId).in("status", ["done", "partial"]).gte("plan_date", historyFrom).lt("plan_date", first),
    ctx.db.from("workspaces").select("name").eq("user_id", ctx.userId).eq("status", "active"),
    ctx.db.from("tasks").select("estimate_minutes,actual_minutes").eq("user_id", ctx.userId).eq("status", "done").not("estimate_minutes", "is", null).gt("actual_minutes", 0).order("completed_at", { ascending: false }).limit(40),
  ]);
  for (const r of q) if (r.error) throw new Error(`Could not load the plan: ${r.error.message}`);
  const [tasks, events, overrides, routines, rules, exceptions, deps, history, spaces, done] = q;
  const dependencies: Record<string, string[]> = {};
  for (const d of (deps.data ?? []) as { task_id: string; depends_on_task_id: string }[]) (dependencies[d.task_id] ??= []).push(d.depends_on_task_id);
  return {
    tasks: (tasks.data ?? []) as Task[],
    events: (events.data ?? []) as CalendarEvent[],
    overrides: (overrides.data ?? []) as OccurrenceOverride[],
    routines: (routines.data ?? []) as Routine[],
    rules: (rules.data ?? []) as AvailabilityRule[],
    exceptions: (exceptions.data ?? []) as DayException[],
    dependencies,
    history: (history.data ?? []) as { starts_at: string; ends_at: string }[],
    spaceNames: ((spaces.data ?? []) as { name: string }[]).map((s) => s.name),
    estimate: learnedEstimateRatio((done.data ?? []) as Task[]),
  };
}

/** The day model for a date from loaded inputs (shared by planning, My day, get_plan and insights). */
export function modelFor(profile: Pick<Profile, "timezone" | "availability" | "preferences">, inputs: Omit<Inputs, "tasks" | "dependencies" | "estimate">, date: string): DayModel {
  const wb = wakeBed(profile);
  return buildDayModel({
    date,
    zone: profile.timezone,
    wakeBed: wb,
    usualFree: profile.availability ?? [],
    usualFreeIsDefault: isWakeBedDefault(profile.availability ?? [], wb),
    rules: inputs.rules,
    exceptions: inputs.exceptions,
    events: inputs.events,
    overrides: inputs.overrides,
    routines: inputs.routines,
    assumeFreeTime: planningPrefs(profile.preferences).assumeFreeTime,
    typicalHours: typicalHoursFor(inputs.spaceNames),
    history: inputs.history,
  });
}

/** Load what day models need for a range (for pages and tools that only read). */
export async function loadDayModels(ctx: Ctx, dates: string[]): Promise<Map<string, DayModel>> {
  const profile = await getProfile(ctx);
  const inputs = await loadInputs(ctx, dates[0], dates[dates.length - 1]);
  return new Map(dates.map((d) => [d, modelFor(profile, inputs, d)]));
}

const sameTime = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));
const keyOf = (b: { task_id: string | null; routine_id: string | null; title: string }) => b.task_id ?? (b.routine_id ? `r:${b.routine_id}` : `t:${b.title}`);
const blockFields = (b: PlanBlock) => ({
  task_id: b.task_id, routine_id: b.routine_id, title: b.title, plan_date: b.plan_date, starts_at: b.starts_at, ends_at: b.ends_at,
  reason: b.reason, basis: b.basis ?? null, assumption: b.assumption ?? null, changeset_id: b.changeset_id ?? null,
});

/** The exact changes that turn Navi's current open blocks for a day into the new plan. */
function diffDay(date: string, replaceable: PlanBlock[], desired: (SchedulerV2Output["blocks"][number] & { reason: string })[]): Op[] {
  const pool = [...replaceable].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const ops: Op[] = [];
  for (const d of [...desired].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))) {
    const i = pool.findIndex((r) => keyOf(r) === keyOf(d));
    if (i >= 0) {
      const r = pool.splice(i, 1)[0];
      const same = sameTime(r.starts_at, d.starts_at) && sameTime(r.ends_at, d.ends_at);
      if (same && r.reason === d.reason && (r.basis ?? null) === d.basis && (r.assumption ?? null) === d.assumption) continue;
      ops.push({
        op: "update", id: r.id, title: r.title, moved: !same,
        before: { starts_at: r.starts_at, ends_at: r.ends_at, reason: r.reason, basis: r.basis ?? null, assumption: r.assumption ?? null, changeset_id: r.changeset_id ?? null },
        after: { starts_at: d.starts_at, ends_at: d.ends_at, reason: d.reason, basis: d.basis, assumption: d.assumption },
      });
    } else {
      ops.push({ op: "insert", block: { id: randomUUID(), task_id: d.task_id, routine_id: d.routine_id, title: d.title, plan_date: date, starts_at: d.starts_at, ends_at: d.ends_at, reason: d.reason, basis: d.basis, assumption: d.assumption } });
    }
  }
  for (const r of pool) ops.push({ op: "delete", id: r.id, before: blockFields(r) });
  return ops;
}

/** What a change set does, as card lines (at most 8). */
function opLines(ops: Op[], zone: string): { label: string; value: string; from?: string }[] {
  const t = (iso: unknown) => DateTime.fromISO(String(iso)).setZone(zone).toFormat("ccc h:mm a");
  const min = (a: unknown, b: unknown) => Math.round((Date.parse(String(b)) - Date.parse(String(a))) / 60000);
  const lines = ops.flatMap((o) => {
    if (o.op === "insert") return [{ label: `Add “${o.block.title}”`, value: `${t(o.block.starts_at)} (${min(o.block.starts_at, o.block.ends_at)} min)` }];
    if (o.op === "update" && o.moved) return [{ label: `Move “${o.title}”`, value: t(o.after.starts_at), from: t(o.before.starts_at) }];
    if (o.op === "delete") return [{ label: `Take off “${String(o.before.title)}”`, value: `${t(o.before.starts_at)} (stays on your task list)` }];
    if (o.op === "status") return [{ label: `Mark “${o.title}”`, value: o.after.status }];
    return [];
  });
  return lines.length > 8 ? [...lines.slice(0, 7), { label: "And", value: `${lines.length - 7} more changes` }] : lines;
}

/** A change set's ops as plain changes (moves, additions, removals, marks). */
function changesOf(ops: Op[]): PlanChange[] {
  return ops.flatMap((o): PlanChange[] => {
    if (o.op === "insert") return [{ kind: "add", title: o.block.title, at: o.block.starts_at }];
    if (o.op === "update" && o.moved) return [{ kind: "move", title: o.title, at: String(o.after.starts_at), from: String(o.before.starts_at) }];
    if (o.op === "delete") return [{ kind: "remove", title: String(o.before.title) }];
    if (o.op === "status") return [{ kind: "mark", title: o.title, status: o.after.status }];
    return [];
  });
}

function stripCode(message: string): string {
  const m = message.replace(/^NAVI_[A-Z_]+:\s*/, "");
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export class StalePlanError extends Error {}

/** Apply a stored change set (locked, all or nothing) and record it so it can be undone. */
export async function applyChangeset(ctx: Ctx, changesetId: string, summary: string): Promise<string | null> {
  const { error } = await ctx.db.rpc("apply_plan_changeset", { p_changeset: changesetId });
  if (error) {
    if (/NAVI_STALE|NAVI_NOT_FOUND/.test(error.message)) throw new StalePlanError(stripCode(error.message));
    throw new Error(`Could not save the plan: ${error.message}`);
  }
  return logActivity(ctx, { action: "plan_applied", entityType: "plan_changesets", entityId: changesetId, summary: summary.slice(0, 1000), reversible: true });
}

/** Undo a change set (all or nothing). Refuses if any of its blocks were changed since. */
export async function revertChangeset(ctx: Ctx, changesetId: string): Promise<void> {
  const { error } = await ctx.db.rpc("revert_plan_changeset", { p_changeset: changesetId });
  if (error) throw new Error(stripCode(error.message));
}

export type PlanOptions = {
  trigger: PlanTrigger;
  mode?: "apply" | "propose";
  /** Plan the first date from this time (recovery: when the person is free again). */
  from?: DateTime;
  focusTaskIds?: string[];
  reasonPrefix?: string;
  /** Work that didn't fit on the first date and lands on a later one says so. */
  carryFromFirstDay?: boolean;
  /** Blocks to mark first (recovery), in the same change set. */
  markBlocks?: { id: string; status: PlanBlock["status"]; outcome_reason: string | null }[];
  /** Internal: a stale apply is retried once from fresh data. */
  retried?: boolean;
};

/** Work out and save (or propose) the plan for these local dates as one change set. */
export async function planDays(ctx: Ctx, dates: string[], opts: PlanOptions): Promise<PlanRun> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const prefs = planningPrefs(profile.preferences);
  const today = nowIn(zone).toISODate()!;
  const runDates = [...new Set(dates)].sort();
  const lookAhead = DateTime.fromISO(runDates[runDates.length - 1], { zone }).plus({ days: 7 }).toISODate()!;
  const inputs = await loadInputs(ctx, runDates[0], lookAhead);
  const mode = opts.mode ?? (ctx.actor === "navi" && ctx.autonomy === "ask" ? "propose" : "apply");

  const { data: existingRows, error: exErr } = await ctx.db.from("plan_blocks").select("*").eq("user_id", ctx.userId).gte("plan_date", today < runDates[0] ? today : runDates[0]).lte("plan_date", lookAhead);
  if (exErr) throw new Error(exErr.message);
  const marks = new Map((opts.markBlocks ?? []).map((m) => [m.id, m]));
  const existing = ((existingRows ?? []) as PlanBlock[]).map((b) => (marks.has(b.id) ? { ...b, status: marks.get(b.id)!.status, outcome_reason: marks.get(b.id)!.outcome_reason } : b));
  const nowMs = Date.now();
  const isKept = (b: PlanBlock) => !b.is_flexible || b.created_by === "user" || KEEP_STATUSES.includes(b.status) || !!b.pinned;
  const openNavi = (b: PlanBlock) => b.is_flexible && b.created_by === "navi" && b.status === "planned" && !b.pinned;

  // Work already planned before each date (not to double-book), and where it ends (dependencies).
  const plannedBefore: Record<string, number> = {};
  const plannedEnds: Record<string, string> = {};
  const count = (b: { task_id: string | null; starts_at: string; ends_at: string }) => {
    if (!b.task_id || Date.parse(b.ends_at) <= nowMs) return;
    plannedBefore[b.task_id] = (plannedBefore[b.task_id] ?? 0) + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;
    if (!plannedEnds[b.task_id] || Date.parse(b.ends_at) > Date.parse(plannedEnds[b.task_id])) plannedEnds[b.task_id] = b.ends_at;
  };
  for (const b of existing) if (b.plan_date >= today && b.plan_date < runDates[0] && ["planned", "in_progress"].includes(b.status)) count(b);

  const ops: Op[] = [...(opts.markBlocks ?? []).flatMap((m): Op[] => {
    const b = (existingRows as PlanBlock[] | null)?.find((x) => x.id === m.id);
    return b ? [{ op: "status", id: b.id, title: b.title, before: { status: b.status, outcome_reason: b.outcome_reason }, after: { status: m.status, outcome_reason: m.outcome_reason } }] : [];
  })];
  const results: PlanResultV2[] = [];
  const titles = new Map(inputs.tasks.map((t) => [t.id, { title: t.title, commitment: t.commitment ?? "normal" }]));
  let firstUnscheduled: Set<string> | null = null;

  for (const date of runDates) {
    const dayBlocks = existing.filter((b) => b.plan_date === date);
    const kept = dayBlocks.filter(isKept);
    const pastUnmarked = dayBlocks.filter((b) => !isKept(b) && Date.parse(b.ends_at) <= nowMs);
    const replaceable = dayBlocks.filter((b) => !kept.includes(b) && !pastUnmarked.includes(b));
    const model = modelFor(profile, inputs, date);
    const now = date === runDates[0] && opts.from ? opts.from.setZone(zone) : DateTime.now().setZone(zone);
    const out = scheduleDayV2({
      date, zone, now, model,
      events: inputs.events, overrides: inputs.overrides, routines: inputs.routines, tasks: inputs.tasks,
      keptBlocks: kept, alreadyScheduledMinutes: date > today ? { ...plannedBefore } : undefined,
      estimateRatio: inputs.estimate.ratio, loadCap: prefs.loadCap, focusTaskIds: opts.focusTaskIds,
      dependencies: inputs.dependencies, plannedEnds: { ...plannedEnds },
    });
    const desired = out.blocks.map((b) => ({
      ...b,
      reason:
        opts.carryFromFirstDay && firstUnscheduled && b.task_id && firstUnscheduled.has(b.task_id)
          ? `Carried over from ${DateTime.fromISO(runDates[0], { zone }).toFormat("ccc LLL d")}: ${b.reason}`
          : opts.reasonPrefix && date === runDates[0]
            ? `${opts.reasonPrefix}: ${b.reason}`
            : b.reason,
    }));
    const dayOps = diffDay(date, replaceable, desired);
    ops.push(...dayOps);
    for (const b of kept) if (["planned", "in_progress"].includes(b.status)) count(b);
    for (const b of desired) count(b);
    if (!firstUnscheduled) firstUnscheduled = new Set(out.unscheduled.map((u) => u.task_id));

    // Must-complete work that can't be done in time: tradeoffs and one question.
    let short: Shortfall[] = [];
    if (out.unscheduled.some((u) => out.mustTaskIds.includes(u.task_id))) {
      const later: { date: string; minutes: number }[] = [];
      for (let i = 1; i <= 7; i++) {
        const d = DateTime.fromISO(date, { zone }).plus({ days: i }).toISODate()!;
        const m = modelFor(profile, inputs, d);
        const keptThere = existing.filter((b) => b.plan_date === d && (isKept(b) || openNavi(b)));
        const free = scheduleDayV2({ date: d, zone, now: DateTime.now().setZone(zone), model: m, events: inputs.events, overrides: inputs.overrides, routines: inputs.routines, tasks: [], keptBlocks: keptThere, loadCap: 1 }).freeMinutes;
        later.push({ date: d, minutes: free });
      }
      short = shortfalls(out, inputs.tasks, date, zone, later);
    }
    results.push({
      ...out, date,
      moved: dayOps.filter((o) => o.op === "update" && o.moved).length,
      estimateSamples: inputs.estimate.samples, estimateRatio: inputs.estimate.ratio,
      model, shortfalls: short, tradeoffs: tradeoffs(short, out, model, zone, titles), clarification: clarificationFor(short, model, zone),
      proposed: false,
    });
  }

  const summaryOf = (proposed: boolean) => {
    const rs = results.map((r) => ({ ...r, proposed }));
    return rs.length === 1 ? summarizeDayPlan(rs[0], zone) : summarizeWeekPlan(rs, zone);
  };
  if (!ops.length) return { results, changesetId: null, status: "unchanged", actionId: null, summary: summaryOf(false), undo: [], changes: [] };

  // Older proposals for these days are replaced by this one.
  await ctx.db.from("plan_changesets").update({ status: "superseded" }).eq("user_id", ctx.userId).eq("status", "proposed").overlaps("dates", runDates);
  // The plan as it is in the database now (before any marks in this run), for the stale check.
  const base = ((existingRows ?? []) as PlanBlock[]).filter((b) => runDates.includes(b.plan_date) && openNavi(b)).map((b) => b.id).sort();
  const explanation = results.map((r) => ({
    date: r.date, assumptions: r.assumptions, tradeoffs: r.tradeoffs, clarification: r.clarification, conflicts: r.conflicts,
    unscheduled: r.unscheduled.map((u) => ({ title: u.title, minutes: u.remaining_minutes, why: u.why })),
  }));
  const proposed = mode === "propose";
  const summary = summaryOf(proposed);
  const { data: cs, error: csErr } = await ctx.db
    .from("plan_changesets")
    .insert({ user_id: ctx.userId, actor: ctx.actor, trigger: opts.trigger, dates: runDates, status: "proposed", ops, base, summary: summary.slice(0, 2000), explanation })
    .select("id")
    .single();
  if (csErr) throw new Error(`Could not save the plan: ${csErr.message}`);

  if (proposed) {
    const day = runDates.length === 1 ? DateTime.fromISO(runDates[0], { zone }).toFormat("cccc LLL d") : `${DateTime.fromISO(runDates[0], { zone }).toFormat("ccc LLL d")} – ${DateTime.fromISO(runDates[runDates.length - 1], { zone }).toFormat("ccc LLL d")}`;
    const approval = await requestApproval(ctx, {
      actionType: "internal.plan.apply",
      summary: `Plan for ${day}`,
      details: { op: "apply_plan", table: "plan_changesets", changeset_id: cs.id, subject: `Plan for ${day}`, reason: ctx.autonomy === "ask" ? "you chose to approve every change" : "Navi suggested it; nothing changes until you approve", lines: opLines(ops, zone), plan_summary: summary.slice(0, 600) },
      idempotencyKey: `plan:${cs.id}`,
    });
    await ctx.db.from("plan_changesets").update({ approval_id: approval.id }).eq("id", cs.id);
    for (const r of results) r.proposed = true;
    return { results, changesetId: cs.id, status: "proposed", actionId: approval.id, summary, undo: [], changes: changesOf(ops) };
  }

  const undo: string[] = [];
  const stepCtx: Ctx = { ...ctx, onActivity: (e) => { if (e.reversible) undo.push(e.id); ctx.onActivity?.(e); } };
  try {
    await applyChangeset(stepCtx, cs.id, summary);
  } catch (err) {
    await ctx.db.from("plan_changesets").update({ status: "expired" }).eq("id", cs.id).eq("status", "proposed");
    if (err instanceof StalePlanError && !opts.retried) return planDays(ctx, dates, { ...opts, retried: true });
    throw err;
  }
  return { results, changesetId: cs.id, status: "applied", actionId: null, summary, undo, changes: changesOf(ops) };
}
