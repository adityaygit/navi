import { DateTime, Interval } from "luxon";
import type { Basis, CalendarEvent, OccurrenceOverride, PlanBlock, Routine, RoutineProtection, Task } from "@/lib/types";
import { atLocalTime, weekdayOf } from "@/lib/time";
import { MIN_CHUNK_MINUTES, WHOLE_UP_TO_MINUTES, taskScore, type PlannedBlock, type SchedulerOutput } from "./scheduler";
import { occurrencesOn, type DayModel } from "./day-model";

// The constraint-first day scheduler (planner v2). Same placement rules as
// scheduler.ts (buffers, chunking, estimate ratio, never in the past, never
// drops work), on top of the day model:
//   - fixed: events (one-session changes applied), fixed routines, kept and
//     pinned blocks, busy exceptions/rules. Never moved or overlapped.
//   - protected routines: reserved first; may shift only within their window.
//   - must-complete work (commitment 'must', a hard deadline within the
//     horizon, or what the person asked to focus on) is placed before anything
//     else, earliest deadline first.
//   - everything else by the v1 score, within the load cap (D7).
//   - confirmed free time is used before inferred; unknown time never.
// Pure: no I/O. scheduler.ts (v1) is left exactly as it was.

export type KeptBlock = Pick<PlanBlock, "starts_at" | "ends_at" | "task_id" | "routine_id" | "status" | "title">;

export type SchedulerV2Input = {
  date: string;
  zone: string;
  now: DateTime;
  model: DayModel;
  events: CalendarEvent[];
  overrides: OccurrenceOverride[];
  routines: Routine[];
  tasks: Task[];
  keptBlocks: KeptBlock[];
  alreadyScheduledMinutes?: Record<string, number>;
  estimateRatio?: number;
  maxBlockMinutes?: number;
  bufferMinutes?: number;
  minChunkMinutes?: number;
  wholeUpToMinutes?: number;
  /** Share of free time flexible work may fill (D7, default 0.7). Must-complete work isn't capped. */
  loadCap?: number;
  /** Hard deadlines up to here count as must-complete for ordering (D10). Default now + 7 days. */
  horizonEnd?: DateTime;
  /** Tasks the person asked to focus on now: treated as must-complete for this run. */
  focusTaskIds?: string[];
  /** task id → the tasks it waits for. */
  dependencies?: Record<string, string[]>;
  /** Latest end of work already planned for a task on earlier days (dependencies). */
  plannedEnds?: Record<string, string>;
};

export type PlannedBlockV2 = PlannedBlock & { basis: Basis | null; assumption: string | null };

export type SchedulerV2Output = Omit<SchedulerOutput, "blocks" | "fixed"> & {
  blocks: PlannedBlockV2[];
  fixed: { title: string; starts_at: string; ends_at: string; kind: "event" | "routine" | "block" | "busy" }[];
  unplacedRoutines: { routine_id: string; title: string; why: string }[];
  blockedTasks: { task_id: string; title: string }[];
  waiting: { task_id: string; title: string; why: string }[];
  conflicts: string[];
  /** At most two, in plain words: the assumed free time the plan relies on. */
  assumptions: string[];
  /** Free minutes left open because of the load cap (D7). */
  heldBackMinutes: number;
  capacity: { confirmed: number; inferred: number; unknown: number };
  /** Free minutes after fixed plans, before any work is placed, by how sure Navi is. */
  freeByBasis: { confirmed: number; inferred: number };
  mustTaskIds: string[];
};

const DEFAULT_ESTIMATE = 30;
const UNWORKED_STATUSES = ["skipped", "missed", "rest", "interrupted"];
const MEAL_SHIFT_MINUTES = 30;

export function protectionOf(r: Pick<Routine, "protection" | "is_fixed" | "start_time">): RoutineProtection {
  return r.protection ?? (r.is_fixed ? "fixed" : r.start_time ? "protected" : "flexible");
}

/**
 * Where a routine with a set time may sit (D5): an explicit window; meals
 * ±30 minutes; exercise and recovery anywhere in the waking day; a flexible
 * routine anywhere in the day; otherwise exactly at its time.
 */
export function routineWindow(r: Routine, date: string, zone: string, awake: Interval | null): Interval {
  const s = atLocalTime(date, r.start_time!, zone);
  const exact = Interval.fromDateTimes(s, s.plus({ minutes: r.duration_minutes }));
  if (r.window_start && r.window_end) {
    const w = Interval.fromDateTimes(atLocalTime(date, r.window_start, zone), atLocalTime(date, r.window_end, zone));
    return w.isValid && w.length("minutes") >= r.duration_minutes ? w : exact;
  }
  const p = protectionOf(r);
  const day = Interval.fromDateTimes(DateTime.fromISO(date, { zone }).startOf("day"), DateTime.fromISO(date, { zone }).plus({ days: 1 }).startOf("day"));
  if (p === "flexible") return awake ?? day;
  if (r.kind === "meal") return Interval.fromDateTimes(s.minus({ minutes: MEAL_SHIFT_MINUTES }), s.plus({ minutes: r.duration_minutes + MEAL_SHIFT_MINUTES }));
  if (r.kind === "exercise" || r.kind === "recovery") return awake ?? day;
  return exact;
}

type Free = { iv: Interval; basis: Basis; reason: string | null };

function subtractFree(free: Free[], busy: Interval[]): Free[] {
  let out = free;
  for (const b of busy) out = out.flatMap((f) => f.iv.difference(b).map((iv) => ({ ...f, iv })));
  return out.filter((f) => f.iv.isValid && f.iv.length("minutes") >= 1).sort((a, b) => a.iv.start!.toMillis() - b.iv.start!.toMillis());
}

/** Up to the next whole 5 minutes (same rounding as the v1 scheduler). */
const roundUp5 = (d: DateTime) => {
  const m = d.minute % 5;
  return m === 0 && d.second === 0 && d.millisecond === 0 ? d : d.plus({ minutes: 5 - m }).startOf("minute");
};

export function scheduleDayV2(input: SchedulerV2Input): SchedulerV2Output {
  const { date, zone, model } = input;
  const buffer = input.bufferMinutes ?? 10;
  const minChunk = input.minChunkMinutes ?? MIN_CHUNK_MINUTES;
  const maxBlock = Math.max(minChunk, input.maxBlockMinutes ?? 90);
  const wholeUpTo = Math.max(2 * minChunk, input.wholeUpToMinutes ?? WHOLE_UP_TO_MINUTES);
  const ratio = Math.min(2, Math.max(0.8, input.estimateRatio ?? 1));
  const loadCap = Math.min(1, Math.max(0.1, input.loadCap ?? 0.7));
  const horizonEnd = input.horizonEnd ?? input.now.plus({ days: 7 });
  const focus = new Set(input.focusTaskIds ?? []);
  const warnings: string[] = [];
  const conflicts: string[] = [];
  const dow = weekdayOf(date, zone);
  const dayStart = DateTime.fromISO(date, { zone }).startOf("day");
  const dayEnd = dayStart.endOf("day");
  const fmt = (d: DateTime) => d.setZone(zone).toFormat(d.setZone(zone).minute ? "h:mm a" : "h a");
  const awake = model.awake ? Interval.fromDateTimes(DateTime.fromISO(model.awake.starts_at), DateTime.fromISO(model.awake.ends_at)) : null;

  // 1. Fixed time.
  const fixed: SchedulerV2Output["fixed"] = [];
  const busy: Interval[] = [];
  const fixedEvents: { title: string; iv: Interval }[] = [];
  for (const ev of input.events) {
    for (const iv of occurrencesOn(ev, date, zone, input.overrides)) {
      busy.push(iv);
      fixedEvents.push({ title: ev.title, iv });
      fixed.push({ title: ev.title, starts_at: iv.start!.toISO()!, ends_at: iv.end!.toISO()!, kind: "event" });
    }
  }
  for (let i = 0; i < fixedEvents.length; i++) {
    for (let j = i + 1; j < fixedEvents.length; j++) {
      const a = fixedEvents[i];
      const b = fixedEvents[j];
      if (a.iv.overlaps(b.iv)) conflicts.push(`“${a.title}” and “${b.title}” overlap at ${fmt(DateTime.max(a.iv.start!, b.iv.start!))}. Navi won't move either; pick the one you're going to.`);
    }
  }
  for (const b of model.busy) {
    const iv = Interval.fromDateTimes(DateTime.fromISO(b.starts_at).setZone(zone), DateTime.fromISO(b.ends_at).setZone(zone));
    busy.push(iv);
    fixed.push({ title: b.title, starts_at: b.starts_at, ends_at: b.ends_at, kind: "busy" });
  }
  const keptRoutineIds = new Set(input.keptBlocks.map((b) => b.routine_id).filter(Boolean));
  const keptTaskMinutes: Record<string, number> = {};
  const keptTaskEnds: Record<string, DateTime> = {};
  for (const b of input.keptBlocks) {
    const iv = Interval.fromDateTimes(DateTime.fromISO(b.starts_at).setZone(zone), DateTime.fromISO(b.ends_at).setZone(zone));
    if (iv.isValid) busy.push(iv);
    if (b.task_id && !UNWORKED_STATUSES.includes(b.status)) {
      keptTaskMinutes[b.task_id] = (keptTaskMinutes[b.task_id] ?? 0) + iv.length("minutes");
      if (!keptTaskEnds[b.task_id] || iv.end! > keptTaskEnds[b.task_id]) keptTaskEnds[b.task_id] = iv.end!;
    }
  }

  // 2. Routines: fixed ones are busy; protected ones are reserved in their window.
  const blocks: PlannedBlockV2[] = [];
  const unplacedRoutines: SchedulerV2Output["unplacedRoutines"] = [];
  type Item = { title: string; task_id: string | null; routine_id: string | null; minutes: number; total: number; reason: string; score: number; dueBy?: DateTime; tier: 0 | 1 | 2; notBefore?: DateTime; deps: string[] };
  const queue: Item[] = [];
  const todays = input.routines.filter((r) => r.active && r.days.includes(dow) && !keptRoutineIds.has(r.id));
  const timedReservations: { r: Routine; window: Interval; preferred: Interval }[] = [];
  for (const r of todays) {
    const p = protectionOf(r);
    if (r.start_time) {
      const s = atLocalTime(date, r.start_time, zone);
      const preferred = Interval.fromDateTimes(s, s.plus({ minutes: r.duration_minutes }));
      const window = p === "fixed" || r.kind === "sleep" ? preferred : routineWindow(r, date, zone, awake);
      if (window.equals(preferred)) {
        busy.push(preferred);
        fixed.push({ title: r.title, starts_at: preferred.start!.toISO()!, ends_at: preferred.end!.toISO()!, kind: "routine" });
      } else {
        timedReservations.push({ r, window, preferred });
      }
    } else if (p === "protected") {
      queue.push({ title: r.title, task_id: null, routine_id: r.id, minutes: r.duration_minutes, total: r.duration_minutes, reason: "Protected routine for today", score: 1000, tier: 0, deps: [] });
    } else {
      queue.push({ title: r.title, task_id: null, routine_id: r.id, minutes: r.duration_minutes, total: r.duration_minutes, reason: "Routine for today", score: 30, tier: 2, deps: [] });
    }
  }
  const pad = (iv: Interval, by = buffer) => Interval.fromDateTimes(iv.start!.minus({ minutes: by }), iv.end!.plus({ minutes: by }));
  // A protected routine with a set time stays at it if it can; otherwise it
  // moves as little as possible within its window, around fixed things only.
  for (const { r, window, preferred } of timedReservations.sort((a, b) => a.preferred.start!.toMillis() - b.preferred.start!.toMillis())) {
    const blockers = busy.map((b) => pad(b, 0));
    if (!blockers.some((b) => b.overlaps(preferred))) {
      busy.push(preferred);
      fixed.push({ title: r.title, starts_at: preferred.start!.toISO()!, ends_at: preferred.end!.toISO()!, kind: "routine" });
      continue;
    }
    let best: Interval | null = null;
    for (const gap of blockers.reduce<Interval[]>((acc, b) => acc.flatMap((g) => g.difference(b)), [window])) {
      if (gap.length("minutes") < r.duration_minutes) continue;
      const latest = gap.end!.minus({ minutes: r.duration_minutes });
      const start = preferred.start! < gap.start! ? gap.start! : preferred.start! > latest ? latest : preferred.start!;
      const cand = Interval.fromDateTimes(start, start.plus({ minutes: r.duration_minutes }));
      if (!best || Math.abs(cand.start!.diff(preferred.start!).as("minutes")) < Math.abs(best.start!.diff(preferred.start!).as("minutes"))) best = cand;
    }
    if (!best) {
      unplacedRoutines.push({ routine_id: r.id, title: r.title, why: `No room between ${fmt(window.start!)} and ${fmt(window.end!)} around your fixed plans` });
      conflicts.push(`“${r.title}” doesn't fit between ${fmt(window.start!)} and ${fmt(window.end!)} today because fixed plans cover that time.`);
      continue;
    }
    busy.push(best);
    const moved = Math.round(best.start!.diff(preferred.start!).as("minutes"));
    blocks.push({
      title: r.title, task_id: null, routine_id: r.id, starts_at: best.start!.toISO()!, ends_at: best.end!.toISO()!, is_flexible: true,
      reason: `Protected routine, moved ${Math.abs(moved)} min ${moved > 0 ? "later" : "earlier"} to fit around your fixed plans`, basis: null, assumption: null,
    });
  }

  // 3. Free time from the day model: not in the past, minus fixed (with buffers).
  const earliest = input.now > dayStart ? input.now.setZone(zone) : dayStart;
  let free: Free[] = model.capacity
    .map((c) => ({ iv: Interval.fromDateTimes(DateTime.fromISO(c.starts_at).setZone(zone), DateTime.fromISO(c.ends_at).setZone(zone)), basis: c.basis, reason: c.reason }))
    .filter((f) => f.iv.isValid && f.iv.end! > earliest)
    .map((f) => (f.iv.start! < earliest ? { ...f, iv: Interval.fromDateTimes(earliest, f.iv.end!) } : f))
    .map((f) => {
      const s = roundUp5(f.iv.start!);
      return s < f.iv.end! ? { ...f, iv: Interval.fromDateTimes(s, f.iv.end!) } : f;
    });
  free = subtractFree(free, busy.map((b) => pad(b)));
  const freeMinutes = Math.round(free.reduce((s, f) => s + f.iv.length("minutes"), 0));
  const freeByBasis = {
    confirmed: Math.round(free.filter((f) => f.basis === "confirmed").reduce((s, f) => s + f.iv.length("minutes"), 0)),
    inferred: Math.round(free.filter((f) => f.basis === "inferred").reduce((s, f) => s + f.iv.length("minutes"), 0)),
  };

  // 4. Work queue.
  const parentsWithOpenChildren = new Set(input.tasks.filter((t) => t.parent_task_id && (t.status === "todo" || t.status === "in_progress")).map((t) => t.parent_task_id));
  const blockedTasks = input.tasks.filter((t) => t.status === "blocked").map((t) => ({ task_id: t.id, title: t.title }));
  const open = input.tasks.filter((t) => (t.status === "todo" || t.status === "in_progress") && !parentsWithOpenChildren.has(t.id));
  const openIds = new Set(open.map((t) => t.id));
  const waiting: SchedulerV2Output["waiting"] = [];
  const mustTaskIds: string[] = [];
  for (const t of open) {
    const estimate = t.estimate_minutes ?? DEFAULT_ESTIMATE;
    const adjusted = Math.round(estimate * ratio);
    // Worked past the estimate but not finished: it took longer, so assume a bit more.
    const overran = t.actual_minutes > 0 && t.actual_minutes >= adjusted;
    const need = overran ? minChunk : adjusted - t.actual_minutes;
    const remaining = Math.max(0, need - (keptTaskMinutes[t.id] ?? 0) - (input.alreadyScheduledMinutes?.[t.id] ?? 0));
    if (remaining <= 0) continue;
    const notBefore = t.not_before ? DateTime.fromISO(t.not_before).setZone(zone) : undefined;
    if (notBefore && notBefore >= dayEnd) {
      waiting.push({ task_id: t.id, title: t.title, why: `not before ${notBefore.toFormat("ccc LLL d")}` });
      continue;
    }
    const due = t.due_at ? DateTime.fromISO(t.due_at) : undefined;
    const must = t.commitment === "must" || focus.has(t.id) || (t.due_is_hard && !!due && due <= horizonEnd);
    if (must) mustTaskIds.push(t.id);
    const reasons: string[] = [];
    if (focus.has(t.id)) reasons.push("you asked to focus on it");
    else if (t.commitment === "must") reasons.push("must-complete");
    if (due) {
      const d = due.setZone(zone);
      reasons.push(d < input.now ? "overdue" : `due ${d.toFormat("ccc h:mm a")}${t.due_is_hard ? " (hard deadline)" : ""}`);
    }
    reasons.push(`P${t.priority}`);
    if (overran) reasons.push(`took longer than its estimate; ${minChunk}m more assumed`);
    else if (!t.estimate_minutes) reasons.push(`no estimate, ${DEFAULT_ESTIMATE}m assumed`);
    else if (ratio !== 1) reasons.push(`estimate adjusted ×${ratio.toFixed(2)} from your history`);
    queue.push({
      title: t.title, task_id: t.id, routine_id: null, minutes: remaining, total: overran ? remaining : adjusted, reason: reasons.join(", "),
      score: taskScore(t, input.now) - (t.commitment === "optional" ? 15 : 0), dueBy: due, tier: must ? 1 : 2, notBefore,
      deps: (input.dependencies?.[t.id] ?? []).filter((d) => openIds.has(d)),
    });
  }
  const byDue = (a: Item, b: Item) => (a.dueBy?.toMillis() ?? Infinity) - (b.dueBy?.toMillis() ?? Infinity);
  queue.sort((a, b) => a.tier - b.tier || (a.tier === 1 ? byDue(a, b) || b.score - a.score : b.score - a.score || byDue(a, b)));
  // Prerequisites go before the tasks that wait for them.
  for (let pass = 0; pass < queue.length; pass++) {
    let movedAny = false;
    for (let i = 0; i < queue.length; i++) {
      const it = queue[i];
      const last = Math.max(-1, ...it.deps.map((d) => queue.findIndex((q) => q.task_id === d)));
      if (last > i) {
        queue.splice(i, 1);
        queue.splice(last, 0, it);
        movedAny = true;
        break;
      }
    }
    if (!movedAny) break;
  }

  // 5. Placement: confirmed time before inferred, earliest slot that fits.
  const unscheduled: SchedulerOutput["unscheduled"] = [];
  const afterDeadline: SchedulerOutput["afterDeadline"] = [];
  const titleOf = new Map(input.tasks.map((t) => [t.id, t.title]));
  const placedTaskEnd: Record<string, DateTime> = {};
  const leftover: Record<string, number> = {};
  const limit = model.capacityLimitMinutes;
  const loadLimit = Math.floor(freeMinutes * loadCap);
  let placedAll = 0;
  let placedFlexible = 0;
  let capLimited = false;
  for (const item of queue) {
    let left = item.minutes;
    let placedAny = false;
    let why: string | null = null;
    // Dependencies: after the prerequisite's work, and not while some of it is still unplanned.
    let after: DateTime | null = item.notBefore ?? null;
    const pending = item.deps.find((d) => (leftover[d] ?? 0) > 0 || (!placedTaskEnd[d] && !keptTaskEnds[d] && !input.plannedEnds?.[d]));
    if (pending) {
      if (item.task_id) waiting.push({ task_id: item.task_id, title: item.title, why: `waiting on “${titleOf.get(pending) ?? "another task"}”` });
      if (item.task_id) unscheduled.push({ task_id: item.task_id, title: item.title, remaining_minutes: left, due_at: item.dueBy?.toISO() ?? null, why: `Waiting on “${titleOf.get(pending) ?? "another task"}”` });
      continue;
    }
    for (const d of item.deps) {
      const ends = [placedTaskEnd[d], keptTaskEnds[d], input.plannedEnds?.[d] ? DateTime.fromISO(input.plannedEnds[d]) : undefined].filter(Boolean) as DateTime[];
      for (const e of ends) if (!after || e.plus({ minutes: buffer }) > after) after = e.plus({ minutes: buffer });
    }
    const wholeNow = () => item.total <= wholeUpTo || left < 2 * minChunk;
    while (left > 0) {
      let budget = Infinity;
      if (item.tier > 0 && limit !== null) budget = limit - placedAll;
      if (item.tier === 2) budget = Math.min(budget, loadLimit - placedFlexible);
      const whole = wholeNow();
      const need = whole ? left : minChunk;
      if (budget < need) {
        why = limit !== null && limit - placedAll < need ? `Over the ${limit} minutes you said you have today` : "Kept free so the day isn't packed";
        if (item.tier === 2 && !(limit !== null && limit - placedAll < need)) capLimited = true;
        break;
      }
      const usable = (f: Free) => {
        const s = after && after > f.iv.start! ? roundUp5(after) : f.iv.start!;
        return s < f.iv.end! ? Interval.fromDateTimes(s, f.iv.end!) : null;
      };
      const fits = (basis: Basis) => free.findIndex((f) => f.basis === basis && (usable(f)?.length("minutes") ?? 0) >= need);
      let idx = fits("confirmed");
      if (idx === -1) idx = fits("inferred");
      if (idx === -1) break;
      const slot = free[idx];
      const use = usable(slot)!;
      let len = whole ? left : Math.min(left, maxBlock, Math.floor(use.length("minutes")), Math.floor(budget));
      if (!whole && len < minChunk) break;
      const rest = left - len;
      if (rest > 0 && rest < minChunk) len = left - minChunk;
      const start = use.start!;
      const end = start.plus({ minutes: len });
      if (item.dueBy && start >= item.dueBy && item.dueBy > input.now && item.task_id && !afterDeadline.some((a) => a.task_id === item.task_id)) {
        warnings.push(`“${item.title}” can only be scheduled after its deadline.`);
        afterDeadline.push({ task_id: item.task_id, title: item.title, due_at: item.dueBy.toISO()! });
      }
      const part = len < item.total ? `; this block: ${len} of ${item.total}m` : "";
      blocks.push({
        title: item.title, task_id: item.task_id, routine_id: item.routine_id, starts_at: start.toISO()!, ends_at: end.toISO()!, is_flexible: true,
        reason: item.reason + part + (slot.basis === "inferred" ? "; in time Navi assumed is free" : ""),
        basis: slot.basis, assumption: slot.basis === "inferred" ? slot.reason : null,
      });
      placedAny = true;
      left -= len;
      if (item.tier !== 0) placedAll += len;
      if (item.tier === 2) placedFlexible += len;
      if (item.task_id) placedTaskEnd[item.task_id] = end;
      const afterEnd = end.plus({ minutes: buffer });
      const keep: Free[] = [];
      if (start > slot.iv.start!) keep.push({ ...slot, iv: Interval.fromDateTimes(slot.iv.start!, start.minus({ minutes: Math.min(buffer, start.diff(slot.iv.start!).as("minutes")) })) });
      if (afterEnd < slot.iv.end!) keep.push({ ...slot, iv: Interval.fromDateTimes(afterEnd, slot.iv.end!) });
      free.splice(idx, 1, ...keep.filter((k) => k.iv.isValid && k.iv.length("minutes") >= 1));
    }
    if (left > 0 && item.task_id) {
      leftover[item.task_id] = left;
      unscheduled.push({
        task_id: item.task_id, title: item.title, remaining_minutes: left, due_at: item.dueBy?.toISO() ?? null,
        why: why ?? (placedAny ? "Only part of it fits today" : wholeNow() ? `No free ${left}-minute slot left today` : "No free time left today"),
      });
      if (item.dueBy && item.dueBy.setZone(zone).toISODate()! <= date) {
        warnings.push(`“${item.title}” is due by today but ${left} min of work doesn't fit. Consider the options below.`);
      }
    } else if (left > 0 && item.routine_id) {
      unplacedRoutines.push({ routine_id: item.routine_id, title: item.title, why: why ?? "No free time left for it today" });
    }
  }
  if (model.clarification) warnings.push(model.clarification);
  const heldBackMinutes = capLimited ? Math.round(free.reduce((s, f) => s + f.iv.length("minutes"), 0)) : 0;

  // 6. The assumptions the plan relies on, as stretches of time (at most two).
  const inferredBlocks = blocks.filter((b) => b.basis === "inferred").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const runs: { start: DateTime; end: DateTime; reason: string | null }[] = [];
  for (const b of inferredBlocks) {
    const s = DateTime.fromISO(b.starts_at);
    const e = DateTime.fromISO(b.ends_at);
    const last = runs.at(-1);
    if (last && s.diff(last.end).as("minutes") <= buffer + 5 && last.reason === b.assumption) last.end = e;
    else runs.push({ start: s, end: e, reason: b.assumption });
  }
  const assumptions = runs
    .sort((a, b) => b.end.diff(b.start).toMillis() - a.end.diff(a.start).toMillis())
    .slice(0, 2)
    .sort((a, b) => a.start.toMillis() - b.start.toMillis())
    .map((r) => `I assumed you're free ${fmt(r.start)}–${fmt(r.end)}${r.reason ? ` (${r.reason})` : ""}.`);

  blocks.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return {
    blocks,
    fixed: fixed.sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    unscheduled,
    afterDeadline,
    warnings,
    freeMinutes,
    unplacedRoutines,
    blockedTasks,
    waiting,
    conflicts,
    assumptions,
    heldBackMinutes,
    capacity: model.minutes,
    freeByBasis,
    mustTaskIds,
  };
}
