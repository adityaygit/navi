import "server-only";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import type { AvailabilityRule, BlockPlacement, CalendarEvent, DayException, DayScopeMode, DayScopeRow, OccurrenceOverride, PlanBlock, PlanningRule, Profile, Routine, Task } from "@/lib/types";
import { planningPrefs } from "@/lib/planner-flag";
import { nowIn } from "@/lib/time";
import { wakeBed } from "@/server/day";
import { logActivity } from "@/server/domain/activity";
import { requestApproval } from "@/server/domain/approvals";
import { summarizeDayPlan, summarizeWeekPlan, type PlanChange } from "@/lib/plan-summary";
import { learnedEstimateRatio } from "./scheduler";
import { buildDayModel, isWakeBedDefault, typicalHoursFor, type DayModel } from "./day-model";
import { scheduleDayV2, type DayScope, type SchedulerV2Output } from "./scheduler-v2";
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

export type PlanTrigger = "button" | "chat" | "voice" | "tick" | "recovery" | "event_change" | "overrun" | "onboarding" | "command" | "manual";

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

/** Fields a block insert carries (the newer ones are optional: old change sets don't have them). */
export type InsertBlock = {
  id: string; task_id: string | null; routine_id: string | null; title: string; plan_date: string; starts_at: string; ends_at: string;
  reason: string; basis: string | null; assumption: string | null;
  pinned?: boolean; placement?: BlockPlacement; created_by?: "navi" | "user"; is_flexible?: boolean; session_id?: string | null; session_title?: string | null;
};
/** Where a block is and how it's held, for a requested move/resize/lock (op "move"). */
export type BlockPlace = { starts_at: string; ends_at: string; plan_date: string; pinned: boolean; placement: BlockPlacement; session_id: string | null; session_title: string | null; reason?: string | null; changeset_id?: string | null };

export type Op =
  | { op: "insert"; block: InsertBlock }
  | { op: "update"; id: string; title: string; moved: boolean; before: Record<string, unknown>; after: Record<string, unknown> }
  | { op: "delete"; id: string; before: Record<string, unknown> }
  | { op: "status"; id: string; title: string; before: { status: string; outcome_reason: string | null }; after: { status: string; outcome_reason: string | null } }
  // Planner commands (20261117): a requested move/resize/lock of any open block; unscheduling any open block;
  // a change to a day's scope; a one-day fact saved with the plan.
  | { op: "move"; id: string; title: string; before: BlockPlace; after: BlockPlace }
  | { op: "remove"; id: string; title: string; before: Record<string, unknown> }
  | { op: "scope"; date: string; task_id: string; title: string; before: DayScopeMode | null; after: DayScopeMode | null }
  | { op: "exception"; row: { id: string; date: string; kind: "busy" | "free" | "capacity"; start_time: string | null; end_time: string | null; minutes: number | null; note: string | null; source: "chat" | "ui" } };

type Inputs = Awaited<ReturnType<typeof loadInputs>>;

async function loadInputs(ctx: Ctx, first: string, last: string, commands = false) {
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
  // Planner commands: the day's scope and the person's planning rules (empty, and not read, otherwise).
  const [scopeRows, planningRules] = commands
    ? await Promise.all([
        ctx.db.from("day_plan_scope").select("date,task_id,mode").eq("user_id", ctx.userId).gte("date", first).lte("date", last),
        ctx.db.from("planning_rules").select("*").eq("user_id", ctx.userId).eq("status", "active"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (scopeRows.error || planningRules.error) throw new Error(`Could not load the plan: ${(scopeRows.error ?? planningRules.error)!.message}`);
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
    scope: (scopeRows.data ?? []) as DayScopeRow[],
    planningRules: (planningRules.data ?? []) as PlanningRule[],
  };
}

/** One date's scope from loaded rows. */
export function scopeFor(rows: DayScopeRow[], date: string): DayScope {
  const day = rows.filter((r) => r.date === date);
  return { only: day.filter((r) => r.mode === "only").map((r) => r.task_id), include: day.filter((r) => r.mode === "include").map((r) => r.task_id), exclude: day.filter((r) => r.mode === "exclude").map((r) => r.task_id) };
}

/** The day model for a date from loaded inputs (shared by planning, My day, get_plan and insights). */
export function modelFor(profile: Pick<Profile, "timezone" | "availability" | "preferences">, inputs: Omit<Inputs, "tasks" | "dependencies" | "estimate" | "scope" | "planningRules">, date: string): DayModel {
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
/** Everything needed to put a block back exactly as it was (undo of a delete/remove). */
export const blockFields = (b: PlanBlock) => ({
  task_id: b.task_id, routine_id: b.routine_id, title: b.title, plan_date: b.plan_date, starts_at: b.starts_at, ends_at: b.ends_at,
  reason: b.reason, basis: b.basis ?? null, assumption: b.assumption ?? null, changeset_id: b.changeset_id ?? null,
  is_flexible: b.is_flexible, created_by: b.created_by, pinned: !!b.pinned, placement: b.placement ?? "auto", session_id: b.session_id ?? null, session_title: b.session_title ?? null,
});
export const placeOf = (b: PlanBlock): BlockPlace => ({
  starts_at: b.starts_at, ends_at: b.ends_at, plan_date: b.plan_date, pinned: !!b.pinned, placement: b.placement ?? "auto",
  session_id: b.session_id ?? null, session_title: b.session_title ?? null, reason: b.reason, changeset_id: b.changeset_id ?? null,
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

/**
 * The blocks as they will be once these ops run (in memory, same rules as
 * apply_plan_changeset). Used to plan around a command's explicit changes and
 * to analyse a change set's impact before anything is saved.
 */
export function applyOps(blocks: PlanBlock[], ops: Op[], userId = ""): PlanBlock[] {
  let out = blocks.map((b) => ({ ...b }));
  for (const o of ops) {
    if (o.op === "insert") {
      const b = o.block;
      out.push({
        id: b.id, task_id: b.task_id, routine_id: b.routine_id, title: b.title, plan_date: b.plan_date, starts_at: b.starts_at, ends_at: b.ends_at,
        is_flexible: b.is_flexible ?? true, status: "planned", outcome_reason: null, created_by: b.created_by ?? "navi", reason: b.reason,
        basis: (b.basis as PlanBlock["basis"]) ?? null, assumption: b.assumption, changeset_id: null, pinned: b.pinned ?? false,
        placement: b.placement ?? "auto", session_id: b.session_id ?? null, session_title: b.session_title ?? null,
        ...(userId ? { user_id: userId } : {}),
      } as PlanBlock);
    } else if (o.op === "update") {
      out = out.map((b) => (b.id === o.id ? { ...b, ...(o.after as Partial<PlanBlock>) } : b));
    } else if (o.op === "move") {
      out = out.map((b) => (b.id === o.id ? { ...b, ...o.after, reason: o.after.reason ?? b.reason } : b));
    } else if (o.op === "delete" || o.op === "remove") {
      out = out.filter((b) => b.id !== o.id);
    } else if (o.op === "status") {
      out = out.map((b) => (b.id === o.id ? { ...b, status: o.after.status as PlanBlock["status"], outcome_reason: o.after.outcome_reason } : b));
    }
  }
  return out;
}

/** What a change set does, as card lines (at most 8). */
export function opLines(ops: Op[], zone: string): { label: string; value: string; from?: string }[] {
  const t = (iso: unknown) => DateTime.fromISO(String(iso)).setZone(zone).toFormat("ccc h:mm a");
  const min = (a: unknown, b: unknown) => Math.round((Date.parse(String(b)) - Date.parse(String(a))) / 60000);
  const lines = ops.flatMap((o) => {
    if (o.op === "insert") return [{ label: `Add “${o.block.title}”`, value: `${t(o.block.starts_at)} (${min(o.block.starts_at, o.block.ends_at)} min)` }];
    if (o.op === "update" && o.moved) return [{ label: `Move “${o.title}”`, value: t(o.after.starts_at), from: t(o.before.starts_at) }];
    if (o.op === "move") {
      const moved = !sameTime(o.before.starts_at, o.after.starts_at) || !sameTime(o.before.ends_at, o.after.ends_at);
      if (moved) return [{ label: `Move “${o.title}”`, value: `${t(o.after.starts_at)} (${min(o.after.starts_at, o.after.ends_at)} min)`, from: t(o.before.starts_at) }];
      return o.before.pinned !== o.after.pinned ? [{ label: `${o.after.pinned ? "Lock" : "Unlock"} “${o.title}”`, value: t(o.after.starts_at) }] : [];
    }
    if (o.op === "delete" || o.op === "remove") return [{ label: `Take off “${String(o.before.title)}”`, value: `${t(o.before.starts_at)} (stays on your task list)` }];
    if (o.op === "status") return [{ label: `Mark “${o.title}”`, value: o.after.status }];
    if (o.op === "scope") return [{ label: o.after === "exclude" ? `Keep “${o.title}” off` : o.after === "only" || o.after === "include" ? `Plan “${o.title}”` : `Let Navi plan “${o.title}” again`, value: DateTime.fromISO(o.date).toFormat("ccc LLL d") }];
    return [];
  });
  return lines.length > 8 ? [...lines.slice(0, 7), { label: "And", value: `${lines.length - 7} more changes` }] : lines;
}

/** A change set's ops as plain changes (moves, additions, removals, marks). */
export function changesOf(ops: Op[]): PlanChange[] {
  return ops.flatMap((o): PlanChange[] => {
    if (o.op === "insert") return [{ kind: "add", title: o.block.title, at: o.block.starts_at }];
    if (o.op === "update" && o.moved) return [{ kind: "move", title: o.title, at: String(o.after.starts_at), from: String(o.before.starts_at) }];
    if (o.op === "move" && (!sameTime(o.before.starts_at, o.after.starts_at) || !sameTime(o.before.ends_at, o.after.ends_at))) return [{ kind: "move", title: o.title, at: o.after.starts_at, from: o.before.starts_at }];
    if (o.op === "delete" || o.op === "remove") return [{ kind: "remove", title: String(o.before.title) }];
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
  /**
   * Internal (planner commands): run the old v2 path even when the command
   * pipeline is on. The pipeline itself uses it to compute and save.
   */
  direct?: boolean;
  /**
   * Re-fit the rest of the dates around the change (default true: a full
   * re-plan). "existing": only work already planned there moves to make
   * room; nothing new is added (explicit commands). false: nothing else
   * changes ("clear my day" doesn't refill it).
   */
  refit?: boolean | "existing";
};

/** Explicit changes a command makes, planned around before the rest of the day is re-fitted. */
export type Overlay = {
  /** Ops on specific blocks / scope / one-day facts, applied (in memory) before re-fitting. */
  ops?: Op[];
};

/** A planning run worked out but not saved: what a preview is made of. */
export type ComputedRun = {
  zone: string;
  today: string;
  runDates: string[];
  profile: Profile;
  inputs: Inputs;
  /** The blocks in the database for today .. the look-ahead, as read. */
  before: PlanBlock[];
  /** The same blocks after every op (explicit and re-fit). */
  after: PlanBlock[];
  ops: Op[];
  results: PlanResultV2[];
  /** Legacy stale check: Navi's open blocks on the run dates. */
  base: string[];
  /** planner commands: fingerprint of every planning input (plan_inputs_version), read before anything else. */
  baseVersion: string | null;
  mode: "apply" | "propose";
};

/** Estimate scale per task from the person's active planning rules (most specific scope wins). */
export function estimateScales(tasks: Task[], rules: PlanningRule[], today: string): Record<string, number> {
  const live = rules.filter((r) => r.kind === "estimate_scale" && r.status === "active" && (!r.expires_on || r.expires_on >= today));
  if (!live.length) return {};
  const factorOf = (r: PlanningRule) => Math.min(3, Math.max(0.5, Number((r.params as { factor?: unknown }).factor) || 1));
  const out: Record<string, number> = {};
  for (const t of tasks) {
    const r = live.find((x) => x.scope === "task" && x.scope_id === t.id)
      ?? live.find((x) => x.scope === "project" && x.scope_id === t.project_id)
      ?? live.find((x) => x.scope === "workspace" && x.scope_id === t.workspace_id)
      ?? live.find((x) => x.scope === "global");
    if (r) out[t.id] = factorOf(r);
  }
  return out;
}

/** The person's daily load cap rule for a date, if any (active, not expired, for that weekday). */
export function loadCapRule(rules: PlanningRule[], date: string, zone: string): number | null {
  const dow = DateTime.fromISO(date, { zone }).weekday % 7;
  const r = rules.find((x) => x.kind === "daily_load_cap" && x.status === "active" && (!x.expires_on || x.expires_on >= date)
    && (!Array.isArray((x.params as { days?: unknown }).days) || ((x.params as { days: number[] }).days).includes(dow)));
  const cap = r ? Number((r.params as { cap?: unknown }).cap) : NaN;
  return Number.isFinite(cap) ? Math.min(1, Math.max(0.1, cap)) : null;
}

/** Work out the plan for these local dates (plus a command's explicit changes) without saving anything. */
export async function computeRun(ctx: Ctx, dates: string[], opts: PlanOptions, overlay: Overlay = {}): Promise<ComputedRun> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const prefs = planningPrefs(profile.preferences);
  const today = nowIn(zone).toISODate()!;
  const runDates = [...new Set(dates)].sort();
  const lookAhead = DateTime.fromISO(runDates[runDates.length - 1], { zone }).plus({ days: 7 }).toISODate()!;
  // Read the fingerprint first: anything that changes after it makes applying stale.
  let baseVersion: string | null = null;
  if (prefs.commands) {
    const { data, error } = await ctx.db.rpc("plan_inputs_version", { p_user: ctx.userId, p_dates: runDates });
    if (error) throw new Error(`Could not read the plan: ${error.message}`);
    baseVersion = String(data);
  }
  const inputs = await loadInputs(ctx, runDates[0], lookAhead, prefs.commands);
  const mode = opts.mode ?? (ctx.actor === "navi" && ctx.autonomy === "ask" ? "propose" : "apply");
  const explicit = overlay.ops ?? [];
  // One-day facts and scope changes from the command count for this plan.
  for (const o of explicit) {
    if (o.op === "exception") inputs.exceptions.push({ ...o.row });
    if (o.op === "scope") {
      inputs.scope = inputs.scope.filter((r) => !(r.date === o.date && r.task_id === o.task_id));
      if (o.after) inputs.scope.push({ date: o.date, task_id: o.task_id, mode: o.after });
    }
  }

  const { data: existingRows, error: exErr } = await ctx.db.from("plan_blocks").select("*").eq("user_id", ctx.userId).gte("plan_date", today < runDates[0] ? today : runDates[0]).lte("plan_date", lookAhead);
  if (exErr) throw new Error(exErr.message);
  const before = (existingRows ?? []) as PlanBlock[];
  const marks = new Map((opts.markBlocks ?? []).map((m) => [m.id, m]));
  const existing = applyOps(before, explicit).map((b) => (marks.has(b.id) ? { ...b, status: marks.get(b.id)!.status, outcome_reason: marks.get(b.id)!.outcome_reason } : b));
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

  const ops: Op[] = [
    ...explicit,
    ...(opts.markBlocks ?? []).flatMap((m): Op[] => {
      const b = before.find((x) => x.id === m.id);
      return b ? [{ op: "status", id: b.id, title: b.title, before: { status: b.status, outcome_reason: b.outcome_reason }, after: { status: m.status, outcome_reason: m.outcome_reason } }] : [];
    }),
  ];
  const results: PlanResultV2[] = [];
  const titles = new Map(inputs.tasks.map((t) => [t.id, { title: t.title, commitment: t.commitment ?? "normal" }]));
  const scales = prefs.commands ? estimateScales(inputs.tasks, inputs.planningRules, today) : undefined;
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
      estimateRatio: inputs.estimate.ratio, loadCap: (prefs.commands ? loadCapRule(inputs.planningRules, date, zone) : null) ?? prefs.loadCap, focusTaskIds: opts.focusTaskIds,
      dependencies: inputs.dependencies, plannedEnds: { ...plannedEnds },
      ...(prefs.commands ? { policy: "commands" as const, scope: scopeFor(inputs.scope, date), riskHours: prefs.riskHours, estimateScale: scales } : {}),
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
    const wanted = opts.refit === "existing" ? desired.filter((d) => replaceable.some((r) => keyOf(r) === keyOf(d))) : desired;
    const dayOps = opts.refit === false ? [] : diffDay(date, replaceable, wanted);
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
      moved: dayOps.filter((o) => o.op === "update" && o.moved).length + explicit.filter((o) => o.op === "move" && o.after.plan_date === date && !sameTime(o.before.starts_at, o.after.starts_at)).length,
      estimateSamples: inputs.estimate.samples, estimateRatio: inputs.estimate.ratio,
      model, shortfalls: short, tradeoffs: tradeoffs(short, out, model, zone, titles), clarification: clarificationFor(short, model, zone),
      proposed: false,
    });
  }

  // The plan as it is in the database now (before any marks in this run), for the legacy stale check.
  const base = before.filter((b) => runDates.includes(b.plan_date) && openNavi(b)).map((b) => b.id).sort();
  return { zone, today, runDates, profile, inputs, before, after: applyOps(before, ops), ops, results, base, baseVersion, mode };
}

export type PersistOptions = {
  trigger: PlanTrigger;
  /** planner commands: what was asked, its impact, the conditions verification checks, and why approval is needed. */
  command?: unknown;
  impact?: unknown;
  postconditions?: unknown[];
  idempotencyKey?: string | null;
  /** An offer the person can accept in words ("yes") or by tapping its card. */
  offered?: boolean;
  /** Card text when proposing: why it waits, and extra consequence lines. */
  approvalReason?: string;
  impactLines?: { label: string; value: string }[];
  subject?: string;
};

/** Save a computed run as one change set: proposed (a card) or applied at once. */
export async function persistRun(ctx: Ctx, c: ComputedRun, p: PersistOptions & { mode?: "apply" | "propose" }): Promise<PlanRun> {
  const { zone, runDates, results, ops } = c;
  const mode = p.mode ?? c.mode;
  const summaryOf = (proposed: boolean) => {
    const rs = results.map((r) => ({ ...r, proposed }));
    return rs.length === 1 ? summarizeDayPlan(rs[0], zone) : summarizeWeekPlan(rs, zone);
  };
  if (!ops.length) return { results, changesetId: null, status: "unchanged", actionId: null, summary: summaryOf(false), undo: [], changes: [] };

  // Older proposals for these days are replaced by this one (their cards say so).
  const { data: replaced } = await ctx.db.from("plan_changesets").update({ status: "superseded" }).eq("user_id", ctx.userId).eq("status", "proposed").overlaps("dates", runDates).select("approval_id");
  const oldCards = ((replaced ?? []) as { approval_id: string | null }[]).map((r) => r.approval_id).filter((x): x is string => !!x);
  if (oldCards.length && c.baseVersion) {
    const { expireApprovals } = await import("@/server/domain/approvals");
    await expireApprovals(ctx, oldCards, "Replaced by a newer plan suggestion.");
  }
  const explanation = results.map((r) => ({
    date: r.date, assumptions: r.assumptions, tradeoffs: r.tradeoffs, clarification: r.clarification, conflicts: r.conflicts,
    unscheduled: r.unscheduled.map((u) => ({ title: u.title, minutes: u.remaining_minutes, why: u.why, bucket: u.bucket ?? null })),
    triage: (r.triage ?? []).map((t) => t.title),
  }));
  const proposed = mode === "propose";
  const summary = summaryOf(proposed);
  const row: Record<string, unknown> = { user_id: ctx.userId, actor: ctx.actor, trigger: p.trigger, dates: runDates, status: "proposed", ops, base: c.base, summary: summary.slice(0, 2000), explanation };
  if (c.baseVersion) {
    Object.assign(row, {
      base_version: c.baseVersion, command: p.command ?? null, impact: p.impact ?? null, postconditions: p.postconditions ?? [],
      idempotency_key: p.idempotencyKey ?? null, conversation_id: ctx.conversationId ?? null, offered: !!p.offered,
    });
  }
  const { data: cs, error: csErr } = await ctx.db.from("plan_changesets").insert(row).select("id").single();
  if (csErr) throw new Error(`Could not save the plan: ${csErr.message}`);

  if (proposed) {
    const day = runDates.length === 1 ? DateTime.fromISO(runDates[0], { zone }).toFormat("cccc LLL d") : `${DateTime.fromISO(runDates[0], { zone }).toFormat("ccc LLL d")} – ${DateTime.fromISO(runDates[runDates.length - 1], { zone }).toFormat("ccc LLL d")}`;
    const subject = p.subject ?? `Plan for ${day}`;
    const lines = [...(p.impactLines ?? []), ...opLines(ops, zone)].slice(0, 10);
    const approval = await requestApproval(ctx, {
      actionType: "internal.plan.apply",
      summary: subject,
      details: { op: "apply_plan", table: "plan_changesets", changeset_id: cs.id, subject, reason: p.approvalReason ?? (ctx.autonomy === "ask" ? "you chose to approve every change" : "Navi suggested it; nothing changes until you approve"), lines, plan_summary: summary.slice(0, 600) },
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
    throw err;
  }
  return { results, changesetId: cs.id, status: "applied", actionId: null, summary, undo, changes: changesOf(ops) };
}

/** Work out and save (or propose) the plan for these local dates as one change set. */
export async function planDays(ctx: Ctx, dates: string[], opts: PlanOptions): Promise<PlanRun> {
  if (!opts.direct) {
    const { data } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).maybeSingle();
    if (planningPrefs(data?.preferences).commands) {
      // Planner commands: a re-plan goes through the same pipeline as every
      // other schedule change (preview, impact, authorize, apply, verify).
      const { replan } = await import("./commands");
      return replan(ctx, dates, opts);
    }
  }
  const c = await computeRun(ctx, dates, opts);
  try {
    return await persistRun(ctx, c, { trigger: opts.trigger });
  } catch (err) {
    if (err instanceof StalePlanError && !opts.retried) return planDays(ctx, dates, { ...opts, retried: true });
    throw err;
  }
}
