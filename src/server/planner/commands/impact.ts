import { DateTime, Interval } from "luxon";
import type { PlanBlock, Task } from "@/lib/types";

// Pre-action impact analysis (decision D6), pure. Compares the plan as it is
// with the plan as a command would leave it (both worked out before anything
// is saved) and says what else changes: blocks displaced or pushed to another
// day, work that loses its place, hard deadlines put at risk, overlaps with
// fixed commitments, locked or hand-placed blocks overridden, and soft
// preferences overridden. The pipeline uses the result to decide whether the
// change runs, waits for approval, or can't be done as asked.

export type ConsequenceLevel = "high" | "moderate";
/** One consequence; `key` is what an explicit authorization must name. */
export type Consequence = { key: string; level: ConsequenceLevel; text: string };

export type Displaced = { block_id: string; task_id: string | null; title: string; from: string; to: string | null; kind: "moved" | "pushed" | "unplanned" };

export type Impact = {
  significance: "low" | "moderate" | "high";
  feasible: boolean;
  /** Why it can't be done as asked (feasible false). */
  infeasible: string | null;
  displaced: Displaced[];
  /** Tasks (not the command's own targets) that have less planned work afterwards. */
  newlyUnplaced: { task_id: string; title: string; minutes: number }[];
  deadlinesAtRisk: { task_id: string; title: string; due_at: string }[];
  spillover: { date: string; titles: string[] }[];
  consequences: Consequence[];
  /** Soft preferences or assumptions the change overrides (never block it). */
  notes: string[];
};

export type FixedSpan = { title: string; start: DateTime; end: DateTime; blockId?: string };

export type ImpactInput = {
  before: PlanBlock[];
  after: PlanBlock[];
  /** The dates the command changes. */
  dates: string[];
  tasks: Pick<Task, "id" | "title" | "due_at" | "due_is_hard" | "commitment">[];
  now: DateTime;
  zone: string;
  riskHours: number;
  actor: "user" | "navi" | "system";
  /** What the command acts on directly. `removes`: it takes work off the plan. */
  targets: { blockIds: string[]; taskIds: string[]; removes: boolean };
  /** Blocks the command places or moves (after state), checked against fixed things. */
  placed: PlanBlock[];
  /** Fixed things per date (events, fixed routines, blocks Navi never moves), minus what the command itself moves. */
  fixed: FixedSpan[];
  /** The person explicitly allowed overlapping a fixed commitment. */
  allowOverlap?: boolean;
  /** Waking hours per date, for "outside your usual hours" notes. */
  awake?: Record<string, { start: DateTime; end: DateTime } | null>;
};

const OPEN = ["planned", "in_progress"];
const minutes = (b: { starts_at: string; ends_at: string }) => (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;

export function analyzeImpact(i: ImpactInput): Impact {
  const nowMs = i.now.toMillis();
  const fmt = (iso: string) => DateTime.fromISO(iso).setZone(i.zone).toFormat("ccc h:mm a");
  const open = (b: PlanBlock) => OPEN.includes(b.status) && Date.parse(b.ends_at) > nowMs;
  const afterById = new Map(i.after.map((b) => [b.id, b]));
  const taskById = new Map(i.tasks.map((t) => [t.id, t]));
  const targetBlocks = new Set(i.targets.blockIds);
  const targetTasks = new Set(i.targets.taskIds);
  const consequences: Consequence[] = [];
  const notes: string[] = [];
  const add = (c: Consequence) => { if (!consequences.some((x) => x.key === c.key)) consequences.push(c); };

  // 1. Fixed commitments: never overlapped unless the person allowed exactly that.
  let infeasible: string | null = null;
  for (const p of i.placed) {
    const iv = Interval.fromDateTimes(DateTime.fromISO(p.starts_at), DateTime.fromISO(p.ends_at));
    if (Date.parse(p.starts_at) < nowMs - 60_000 && p.status === "planned") {
      infeasible ??= `“${p.title}” would start in the past (${fmt(p.starts_at)}).`;
    }
    for (const f of i.fixed) {
      if (f.blockId === p.id || !Interval.fromDateTimes(f.start, f.end).overlaps(iv)) continue;
      if (i.allowOverlap) add({ key: `overlap:${f.title}`, level: "high", text: `“${p.title}” overlaps “${f.title}”, which stays where it is (you allowed the overlap).` });
      else infeasible ??= `“${p.title}” at ${fmt(p.starts_at)} would overlap “${f.title}”, which Navi doesn't move.`;
    }
    const awake = i.awake?.[p.plan_date];
    if (awake && (iv.start! < awake.start || iv.end! > awake.end)) notes.push(`“${p.title}” is outside your usual waking hours.`);
  }

  // 2. Blocks the command acts on directly.
  for (const b of i.before.filter((x) => targetBlocks.has(x.id))) {
    if (i.actor === "navi" && (b.created_by === "user" || b.placement === "manual")) {
      add({ key: `override_manual:${b.id}`, level: "high", text: `Changes “${b.title}”, which you placed yourself.` });
    } else if (i.actor === "navi" && b.pinned) {
      add({ key: `override_lock:${b.id}`, level: "high", text: `Changes “${b.title}”, which is locked in place.` });
    }
    if (i.actor === "navi" && !b.is_flexible) add({ key: `override_fixed:${b.id}`, level: "high", text: `Changes “${b.title}”, a fixed block.` });
  }

  // 3. Everything else that moves or comes off the plan on these dates.
  const displaced: Displaced[] = [];
  for (const b of i.before) {
    if (!open(b) || !i.dates.includes(b.plan_date) || targetBlocks.has(b.id)) continue;
    const a = afterById.get(b.id);
    if (a && Date.parse(a.starts_at) === Date.parse(b.starts_at) && Date.parse(a.ends_at) === Date.parse(b.ends_at)) continue;
    if (a) {
      displaced.push({ block_id: b.id, task_id: b.task_id, title: b.title, from: b.starts_at, to: a.starts_at, kind: a.plan_date === b.plan_date ? "moved" : "pushed" });
      continue;
    }
    const elsewhere = b.task_id ? i.after.filter((x) => x.task_id === b.task_id && open(x) && !i.before.some((y) => y.id === x.id)).sort((x, y) => x.starts_at.localeCompare(y.starts_at))[0] : undefined;
    displaced.push({ block_id: b.id, task_id: b.task_id, title: b.title, from: b.starts_at, to: elsewhere?.starts_at ?? null, kind: elsewhere ? (elsewhere.plan_date === b.plan_date ? "moved" : "pushed") : "unplanned" });
  }

  // 4. Planned minutes per task, before and after.
  const planned = (blocks: PlanBlock[]) => {
    const m = new Map<string, number>();
    for (const b of blocks) if (b.task_id && open(b)) m.set(b.task_id, (m.get(b.task_id) ?? 0) + minutes(b));
    return m;
  };
  const was = planned(i.before);
  const now = planned(i.after);
  const newlyUnplaced: Impact["newlyUnplaced"] = [];
  for (const [taskId, m] of was) {
    const lost = m - (now.get(taskId) ?? 0);
    if (lost >= 1 && !targetTasks.has(taskId)) newlyUnplaced.push({ task_id: taskId, title: taskById.get(taskId)?.title ?? i.before.find((b) => b.task_id === taskId)?.title ?? "a task", minutes: Math.round(lost) });
  }

  // 5. Hard deadlines inside the risk window that lose planned work (or that the command takes off).
  const riskEnd = i.now.plus({ hours: i.riskHours });
  const deadlinesAtRisk: Impact["deadlinesAtRisk"] = [];
  for (const t of i.tasks) {
    if (!t.due_is_hard || !t.due_at) continue;
    const due = DateTime.fromISO(t.due_at);
    if (due < i.now || due > riskEnd) continue;
    const lost = (was.get(t.id) ?? 0) - (now.get(t.id) ?? 0);
    const removedByCommand = i.targets.removes && targetTasks.has(t.id);
    if (lost >= 1 || removedByCommand) {
      deadlinesAtRisk.push({ task_id: t.id, title: t.title, due_at: t.due_at });
      add({ key: `deadline:${t.id}`, level: "high", text: `“${t.title}” is due ${fmt(t.due_at)} (hard deadline) and loses ${removedByCommand ? "its planned time" : `${Math.round(lost)} min of planned work`}.` });
    }
  }
  // 6. Must-do work taken off by the command itself.
  if (i.targets.removes) {
    for (const id of targetTasks) {
      const t = taskById.get(id);
      if (t?.commitment === "must") add({ key: `must:${id}`, level: "high", text: `Takes “${t.title}” off the plan, and it's marked must-do.` });
    }
  }
  // 7. Work pushed to another day.
  const spill = new Map<string, Set<string>>();
  for (const d of displaced) if (d.kind === "pushed" && d.to) {
    const day = DateTime.fromISO(d.to).setZone(i.zone).toISODate()!;
    if (!spill.has(day)) spill.set(day, new Set());
    spill.get(day)!.add(d.title);
  }
  const spillover = [...spill.entries()].sort().map(([date, titles]) => ({ date, titles: [...titles] }));

  for (const d of displaced) {
    if (d.kind === "unplanned" && d.task_id) add({ key: `displace:${d.task_id}`, level: "moderate", text: `“${d.title}” comes off the plan for now (it stays on your list).` });
    if (d.kind === "pushed" && d.task_id) add({ key: `push:${d.task_id}`, level: "moderate", text: `“${d.title}” moves to ${fmt(d.to!)}.` });
  }
  for (const u of newlyUnplaced) if (!displaced.some((d) => d.task_id === u.task_id)) add({ key: `displace:${u.task_id}`, level: "moderate", text: `“${u.title}” loses ${u.minutes} min of planned work.` });

  const significance = consequences.some((c) => c.level === "high") ? "high" : consequences.length || notes.length ? "moderate" : "low";
  return { significance, feasible: !infeasible, infeasible, displaced, newlyUnplaced, deadlinesAtRisk, spillover, consequences, notes };
}

/** Consequences as card lines (what the person approves). */
export function impactLines(impact: Impact): { label: string; value: string }[] {
  return [
    ...impact.consequences.filter((c) => c.level === "high").map((c) => ({ label: "Heads up", value: c.text })),
    ...impact.consequences.filter((c) => c.level === "moderate").slice(0, 3).map((c) => ({ label: "Also", value: c.text })),
  ];
}
