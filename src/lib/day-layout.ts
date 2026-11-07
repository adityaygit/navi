import { DateTime } from "luxon";
import type { Span } from "./sentences";

/**
 * Pure layout helpers for My day and the calendar: which free stretch fits
 * which unscheduled task, where blocks sit on an hour grid (side by side when
 * they overlap), and which dates make up a week. No data access here.
 */

export type FitCandidate = { id: string; title: string; estimate: number | null; dueMs: number | null };
export type Fit = { gap: Span; minutes: number; task: FitCandidate | null };

/**
 * Free stretches of at least `minMinutes`, each paired with the unscheduled
 * task that fits it: estimate ≤ the gap, earliest due first (no due date last),
 * then the shortest estimate. A task is offered for one gap only. Tasks
 * without an estimate are never offered (Navi doesn't guess how long they take).
 */
export function findFits(gaps: Span[], candidates: FitCandidate[], minMinutes = 30): Fit[] {
  const pool = candidates
    .filter((c) => c.estimate != null && c.estimate > 0)
    .sort((a, b) => (a.dueMs ?? Infinity) - (b.dueMs ?? Infinity) || a.estimate! - b.estimate! || a.title.localeCompare(b.title));
  const used = new Set<string>();
  const out: Fit[] = [];
  for (const gap of gaps) {
    const minutes = Math.round((gap.end - gap.start) / 60000);
    if (minutes < minMinutes) continue;
    const task = pool.find((c) => !used.has(c.id) && c.estimate! <= minutes) ?? null;
    if (task) used.add(task.id);
    out.push({ gap, minutes, task });
  }
  return out;
}

export type Placed<T> = { item: T; top: number; height: number; lane: number; lanes: number };

/**
 * Positions items on a vertical hour grid running from `gridStart` to
 * `gridEnd` (ms), `pxPerHour` tall. Overlapping items share the width: each
 * cluster of overlaps gets as many lanes as it needs at once.
 */
export function layoutColumn<T extends { startMs: number; endMs: number }>(items: T[], gridStart: number, gridEnd: number, pxPerHour: number, minHeight = 18): Placed<T>[] {
  const px = (ms: number) => ((ms - gridStart) / 3600000) * pxPerHour;
  const visible = items
    .filter((i) => i.endMs > gridStart && i.startMs < gridEnd)
    .sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const placed: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const close = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const p of cluster) p.lanes = lanes;
    cluster = [];
    laneEnds = [];
  };
  for (const item of visible) {
    if (item.startMs >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= item.startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMs);
    } else laneEnds[lane] = item.endMs;
    const top = Math.max(0, px(item.startMs));
    const bottom = Math.min(px(gridEnd), px(item.endMs));
    const p: Placed<T> = { item, top, height: Math.max(minHeight, bottom - top), lane, lanes: 1 };
    cluster.push(p);
    placed.push(p);
    clusterEnd = Math.max(clusterEnd, item.endMs);
  }
  close();
  return placed;
}

/** The Monday-to-Sunday week (ISO dates) that contains `date`, in `zone`. */
export function weekOf(date: string, zone: string): string[] {
  const d = DateTime.fromISO(date, { zone });
  const monday = d.minus({ days: d.weekday - 1 });
  return Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }).toISODate()!);
}

/**
 * Whole hours the grid shows: wake-up to bedtime when known (else 7 AM to
 * 11 PM), widened to include anything planned outside them.
 */
export function gridHours(awake: { wakeMinute: number; bedMinute: number } | null, itemMinutes: { start: number; end: number }[]): { from: number; to: number } {
  let from = awake ? Math.floor(awake.wakeMinute / 60) : 7;
  // Bedtime after midnight (e.g. 00:30) ends the grid at midnight.
  let to = awake ? (awake.bedMinute <= awake.wakeMinute ? 24 : Math.ceil(awake.bedMinute / 60)) : 23;
  for (const m of itemMinutes) {
    from = Math.min(from, Math.floor(m.start / 60));
    to = Math.max(to, Math.min(24, Math.ceil(m.end / 60)));
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) };
}

/** "9 AM", "Noon", "3 PM". */
export function hourLabel(h: number): string {
  if (h === 0 || h === 24) return "Midnight";
  if (h === 12) return "Noon";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
