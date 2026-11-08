import { DateTime, Interval } from "luxon";

// Times people say relative to now ("start now", "until Monday", "push
// everything 30 min"), resolved by code against the real clock so the model
// never has to guess what time it is. Pure: every function takes `now`.

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The current moment, for the top of every model context: "Now: Sunday Nov 8, 1:47 PM (America/New_York)". */
export function nowLine(zone: string, now: DateTime = DateTime.now()): string {
  return `Now: ${now.setZone(zone).toFormat("cccc LLL d, h:mm a")} (${zone}).`;
}

/** Rounds up to the next 5 minutes (tidy start times). */
export function roundUp5(t: DateTime): DateTime {
  const m = t.minute % 5;
  return m === 0 && t.second === 0 && t.millisecond === 0 ? t : t.plus({ minutes: 5 - m }).set({ second: 0, millisecond: 0 });
}

/**
 * A local day the person named: "today", "tomorrow", a weekday ("monday" =
 * the next Monday, never today) or YYYY-MM-DD. Null if it isn't one.
 */
export function resolveDay(word: string, zone: string, now: DateTime): string | null {
  const w = word.trim().toLowerCase().replace(/^(next|this|on)\s+/, "");
  const today = now.setZone(zone).startOf("day");
  if (w === "today") return today.toISODate();
  if (w === "tomorrow") return today.plus({ days: 1 }).toISODate();
  const i = WEEKDAYS.findIndex((d) => d === w || d.slice(0, 3) === w);
  if (i >= 0) {
    const ahead = (i - (today.weekday % 7) + 7) % 7 || 7;
    return today.plus({ days: ahead }).toISODate();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(w) && DateTime.fromISO(w, { zone }).isValid) return w;
  return null;
}

/** A clock time on a local date: "now" (rounded up to 5 minutes) or HH:MM. Null if it isn't one. */
export function resolveClock(value: string, date: string, zone: string, now: DateTime): DateTime | null {
  const v = value.trim().toLowerCase();
  if (v === "now") return roundUp5(now.setZone(zone));
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return DateTime.fromISO(date, { zone }).set({ hour: Number(m[1]), minute: Number(m[2]), second: 0, millisecond: 0 });
}

export type Span = { id: string; start: DateTime; end: DateTime };

/**
 * New times for planned work when the person clears time or pushes their
 * plan. `startAt`: nothing starts before it ("leave me free until 2:05");
 * later work moves only as far as it must. `minutes`: everything moves by
 * that much. Order is kept, nothing overlaps, fixed things (`busy`) are
 * stepped over, nothing goes before `earliest` (now), and work that would
 * run past `dayEnd` stays where it was (`stuck`). Only changed times return.
 */
export function shiftTimes(
  moving: Span[],
  busy: { start: DateTime; end: DateTime }[],
  opts: { startAt?: DateTime | null; minutes?: number | null; earliest: DateTime; dayEnd: DateTime },
): { moves: Span[]; stuck: string[] } {
  // Work that can't move stays put, so it becomes fixed for the rest; repeat until stable.
  let stuck: string[] = [];
  for (let round = 0; round <= moving.length; round++) {
    const keep = moving.filter((m) => stuck.includes(m.id));
    const r = shiftOnce(
      moving.filter((m) => !stuck.includes(m.id)),
      [...busy, ...keep],
      opts,
    );
    if (!r.stuck.length) return { moves: r.moves, stuck };
    stuck = [...stuck, ...r.stuck];
  }
  return { moves: [], stuck: moving.map((m) => m.id) };
}

function shiftOnce(
  moving: Span[],
  busy: { start: DateTime; end: DateTime }[],
  opts: { startAt?: DateTime | null; minutes?: number | null; earliest: DateTime; dayEnd: DateTime },
): { moves: Span[]; stuck: string[] } {
  const sorted = [...moving].sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const fixed = [...busy].sort((a, b) => a.start.toMillis() - b.start.toMillis());
  let cursor = opts.startAt ?? null;
  const moves: Span[] = [];
  const stuck: string[] = [];
  for (const b of sorted) {
    const length = b.end.diff(b.start);
    let s = opts.minutes ? b.start.plus({ minutes: opts.minutes }) : b.start;
    if (cursor && s < cursor) s = cursor;
    if (s < opts.earliest) s = roundUp5(opts.earliest);
    // Step over anything fixed it would overlap.
    for (let guard = 0; guard < 50; guard++) {
      const iv = Interval.fromDateTimes(s, s.plus(length));
      const hit = fixed.find((f) => Interval.fromDateTimes(f.start, f.end).overlaps(iv));
      if (!hit) break;
      s = hit.end;
    }
    const e = s.plus(length);
    if (e > opts.dayEnd) {
      stuck.push(b.id);
      continue;
    }
    if (s.toMillis() !== b.start.toMillis()) moves.push({ id: b.id, start: s, end: e });
    cursor = e;
  }
  return { moves, stuck };
}
