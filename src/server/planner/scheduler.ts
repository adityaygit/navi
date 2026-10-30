import { DateTime, Interval } from "luxon";
import type { AvailabilityWindow, CalendarEvent, PlanBlock, Routine, Task } from "@/lib/types";
import { atLocalTime, weekdayOf } from "@/lib/time";

// Deterministic day planner. Places flexible work into the user's declared
// availability around fixed commitments. Pure: no I/O, fully unit-tested.
// Never invents availability: with no windows declared, nothing flexible is
// scheduled and the caller is told why.

export type SchedulerInput = {
  date: string; // local YYYY-MM-DD
  zone: string;
  now: DateTime;
  availability: AvailabilityWindow[];
  events: CalendarEvent[];
  routines: Routine[];
  tasks: Task[];
  /** Blocks that must stay where they are (fixed, user-made, started or finished). */
  keptBlocks: Pick<PlanBlock, "starts_at" | "ends_at" | "task_id" | "routine_id" | "status" | "title">[];
  /** Minutes of each task already scheduled on other days (not to double-book). */
  alreadyScheduledMinutes?: Record<string, number>;
  /** Learned actual/estimate ratio (>1 means user underestimates). */
  estimateRatio?: number;
  maxBlockMinutes?: number;
  bufferMinutes?: number;
};

export type PlannedBlock = {
  title: string;
  task_id: string | null;
  routine_id: string | null;
  starts_at: string;
  ends_at: string;
  is_flexible: boolean;
  reason: string;
};

export type SchedulerOutput = {
  blocks: PlannedBlock[];
  fixed: { title: string; starts_at: string; ends_at: string; kind: "event" | "routine" | "block" }[];
  unscheduled: { task_id: string; title: string; why: string; remaining_minutes: number }[];
  warnings: string[];
  freeMinutes: number;
};

const DEFAULT_ESTIMATE = 30;

/** Expand an event (possibly weekly-recurring) to its occurrence on `date`. */
export function eventOccurrence(ev: CalendarEvent, date: string, zone: string): Interval | null {
  if (ev.status === "cancelled") return null;
  const start = DateTime.fromISO(ev.starts_at).setZone(zone);
  const end = DateTime.fromISO(ev.ends_at).setZone(zone);
  if (!ev.recurrence) {
    const iv = Interval.fromDateTimes(start, end);
    const day = Interval.fromDateTimes(
      DateTime.fromISO(date, { zone }).startOf("day"),
      DateTime.fromISO(date, { zone }).endOf("day"),
    );
    return iv.overlaps(day) ? iv : null;
  }
  const dow = weekdayOf(date, zone);
  if (!ev.recurrence.days.includes(dow)) return null;
  if (start.toISODate()! > date) return null;
  if (ev.recurrence.until && date > ev.recurrence.until) return null;
  // Same wall-clock time on the target date (DST-safe because it is rebuilt in-zone).
  const s = atLocalTime(date, start.toFormat("HH:mm"), zone);
  const durationMin = end.diff(start, "minutes").minutes;
  return Interval.fromDateTimes(s, s.plus({ minutes: durationMin }));
}

function subtract(free: Interval[], busy: Interval[]): Interval[] {
  let result = free;
  for (const b of busy) {
    result = result.flatMap((f) => f.difference(b));
  }
  return result.filter((i) => i.isValid && i.length("minutes") >= 1).sort((a, b) => a.start!.toMillis() - b.start!.toMillis());
}

export function taskScore(task: Task, now: DateTime): number {
  let score = (5 - task.priority) * 10; // P1 = 40 ... P4 = 10
  if (task.due_at) {
    const hours = DateTime.fromISO(task.due_at).diff(now, "hours").hours;
    if (hours < 0) score += 45; // overdue
    else if (hours < 24) score += 35;
    else if (hours < 72) score += 20;
    else if (hours < 168) score += 8;
    if (task.due_is_hard) score += 10;
  }
  if (task.status === "in_progress") score += 6;
  if (task.goal_id || task.project_id) score += 3;
  return score;
}

export function scheduleDay(input: SchedulerInput): SchedulerOutput {
  const { date, zone } = input;
  const maxBlock = input.maxBlockMinutes ?? 90;
  const buffer = input.bufferMinutes ?? 10;
  const ratio = Math.min(2, Math.max(0.8, input.estimateRatio ?? 1));
  const warnings: string[] = [];
  const dow = weekdayOf(date, zone);
  const dayStart = DateTime.fromISO(date, { zone }).startOf("day");
  const dayEnd = dayStart.endOf("day");

  // 1. Fixed time: events, fixed routines, kept blocks.
  const fixed: SchedulerOutput["fixed"] = [];
  const busy: Interval[] = [];
  for (const ev of input.events) {
    const iv = eventOccurrence(ev, date, zone);
    if (iv) {
      busy.push(iv);
      fixed.push({ title: ev.title, starts_at: iv.start!.toISO()!, ends_at: iv.end!.toISO()!, kind: "event" });
    }
  }
  const keptRoutineIds = new Set(input.keptBlocks.map((b) => b.routine_id).filter(Boolean));
  for (const r of input.routines) {
    if (!r.active || !r.days.includes(dow) || !r.start_time || keptRoutineIds.has(r.id)) continue;
    const s = atLocalTime(date, r.start_time, zone);
    const iv = Interval.fromDateTimes(s, s.plus({ minutes: r.duration_minutes }));
    busy.push(iv);
    fixed.push({ title: r.title, starts_at: iv.start!.toISO()!, ends_at: iv.end!.toISO()!, kind: "routine" });
  }
  const keptTaskMinutes: Record<string, number> = {};
  for (const b of input.keptBlocks) {
    const iv = Interval.fromDateTimes(DateTime.fromISO(b.starts_at).setZone(zone), DateTime.fromISO(b.ends_at).setZone(zone));
    if (iv.isValid) busy.push(iv);
    if (b.task_id && b.status !== "skipped" && b.status !== "missed") {
      keptTaskMinutes[b.task_id] = (keptTaskMinutes[b.task_id] ?? 0) + iv.length("minutes");
    }
  }

  // 2. Available time: declared windows for this weekday, not in the past.
  const windows = input.availability.filter((w) => w.days.includes(dow));
  if (input.availability.length === 0) {
    warnings.push("No availability is set, so Navi didn't schedule flexible work. Tell Navi when you're usually free, or set it in Settings.");
  } else if (windows.length === 0) {
    warnings.push("You have no availability on this day, so only fixed commitments are shown.");
  }
  const earliest = input.now > dayStart ? input.now.setZone(zone) : dayStart;
  let free: Interval[] = windows
    .map((w) => Interval.fromDateTimes(atLocalTime(date, w.start, zone), atLocalTime(date, w.end, zone)))
    .filter((i) => i.isValid)
    .map((i) => (i.end! <= earliest ? null : i.start! < earliest ? Interval.fromDateTimes(earliest, i.end!) : i))
    .filter((i): i is Interval => i !== null && i.end! <= dayEnd.plus({ minutes: 1 }));
  // Round the first usable minute up to the next 5 minutes for tidy blocks.
  free = free.map((i) => {
    const m = i.start!.minute % 5;
    const s = m === 0 && i.start!.second === 0 ? i.start! : i.start!.plus({ minutes: 5 - m }).startOf("minute");
    return s < i.end! ? Interval.fromDateTimes(s, i.end!) : i;
  });
  // Pad fixed items with a buffer so flexible work doesn't butt against them.
  const padded = busy.map((b) => Interval.fromDateTimes(b.start!.minus({ minutes: buffer }), b.end!.plus({ minutes: buffer })));
  free = subtract(free, padded);
  const freeMinutes = Math.round(free.reduce((s, i) => s + i.length("minutes"), 0));

  // 3. Work queue: flexible routines for today, then tasks by score.
  type Item = { title: string; task_id: string | null; routine_id: string | null; minutes: number; reason: string; score: number; dueBy?: DateTime };
  const queue: Item[] = [];
  for (const r of input.routines) {
    if (!r.active || !r.days.includes(dow) || r.start_time || keptRoutineIds.has(r.id)) continue;
    queue.push({ title: r.title, task_id: null, routine_id: r.id, minutes: r.duration_minutes, reason: "Routine for today", score: 30 });
  }
  // A parent with open subtasks is worked on through its subtasks.
  const parentsWithOpenChildren = new Set(
    input.tasks.filter((t) => t.parent_task_id && (t.status === "todo" || t.status === "in_progress")).map((t) => t.parent_task_id),
  );
  const open = input.tasks.filter(
    (t) => (t.status === "todo" || t.status === "in_progress") && !parentsWithOpenChildren.has(t.id),
  );
  for (const t of open) {
    const estimate = t.estimate_minutes ?? DEFAULT_ESTIMATE;
    const adjusted = Math.round(estimate * ratio);
    const remaining = Math.max(0, adjusted - t.actual_minutes - (keptTaskMinutes[t.id] ?? 0) - (input.alreadyScheduledMinutes?.[t.id] ?? 0));
    if (remaining <= 0) continue;
    const reasons: string[] = [];
    if (t.due_at) {
      const due = DateTime.fromISO(t.due_at).setZone(zone);
      reasons.push(due < input.now ? "overdue" : `due ${due.toFormat("ccc h:mm a")}`);
    }
    reasons.push(`P${t.priority}`);
    if (!t.estimate_minutes) reasons.push(`no estimate, assumed ${DEFAULT_ESTIMATE}m`);
    else if (ratio !== 1) reasons.push(`estimate adjusted ×${ratio.toFixed(2)} from your history`);
    queue.push({
      title: t.title,
      task_id: t.id,
      routine_id: null,
      minutes: remaining,
      reason: reasons.join(", "),
      score: taskScore(t, input.now),
      dueBy: t.due_at ? DateTime.fromISO(t.due_at) : undefined,
    });
  }
  queue.sort((a, b) => b.score - a.score || (a.dueBy?.toMillis() ?? Infinity) - (b.dueBy?.toMillis() ?? Infinity));

  // 4. Greedy placement: each item takes the earliest slot that fits a chunk.
  const blocks: PlannedBlock[] = [];
  const unscheduled: SchedulerOutput["unscheduled"] = [];
  for (const item of queue) {
    let left = item.minutes;
    let placedAny = false;
    while (left > 0) {
      const chunk = Math.min(left, maxBlock);
      const minChunk = Math.min(chunk, 15);
      const slotIdx = free.findIndex((f) => f.length("minutes") >= minChunk);
      if (slotIdx === -1) break;
      const slot = free[slotIdx];
      const len = Math.min(chunk, Math.floor(slot.length("minutes")));
      const start = slot.start!;
      const end = start.plus({ minutes: len });
      if (item.dueBy && start >= item.dueBy && item.dueBy > input.now) {
        warnings.push(`“${item.title}” can only be scheduled after its deadline.`);
      }
      blocks.push({
        title: item.title,
        task_id: item.task_id,
        routine_id: item.routine_id,
        starts_at: start.toISO()!,
        ends_at: end.toISO()!,
        is_flexible: true,
        reason: item.reason,
      });
      placedAny = true;
      left -= len;
      const rest = end.plus({ minutes: buffer });
      free.splice(slotIdx, 1, ...(rest < slot.end! ? [Interval.fromDateTimes(rest, slot.end!)] : []));
    }
    if (left > 0 && item.task_id) {
      unscheduled.push({
        task_id: item.task_id,
        title: item.title,
        remaining_minutes: left,
        why: placedAny ? "Only part of it fits today" : "No free time left today",
      });
      if (item.dueBy && item.dueBy.setZone(zone).toISODate()! <= date) {
        warnings.push(`“${item.title}” is due by today but ${left} min of work doesn't fit. Consider the recovery options.`);
      }
    }
  }
  blocks.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { blocks, fixed: fixed.sort((a, b) => a.starts_at.localeCompare(b.starts_at)), unscheduled, warnings, freeMinutes };
}

/**
 * Learned estimate ratio from finished tasks (actual / estimate). Requires at
 * least 5 data points; otherwise returns 1 so Navi doesn't invent a pattern.
 */
export function learnedEstimateRatio(done: Pick<Task, "estimate_minutes" | "actual_minutes">[]): { ratio: number; samples: number } {
  const ratios = done
    .filter((t) => t.estimate_minutes && t.actual_minutes > 0)
    .map((t) => t.actual_minutes / t.estimate_minutes!)
    .sort((a, b) => a - b);
  if (ratios.length < 5) return { ratio: 1, samples: ratios.length };
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return { ratio: Math.min(2, Math.max(0.8, median)), samples: ratios.length };
}
