import { DateTime, Interval } from "luxon";
import type { AvailabilityRule, AvailabilityWindow, Basis, CalendarEvent, DayException, OccurrenceOverride, Routine } from "@/lib/types";
import { atLocalTime, weekdayOf } from "@/lib/time";
import { eventOccurrence } from "./scheduler";

// The day model for the constraint-first planner (planner v2): what each
// stretch of one local day is, worked out from everything Navi already knows,
// before any work is placed. Pure: no I/O, unit-tested.
//
//   confirmed free : the person said so (Settings' free times, a "free" rule,
//                    a one-day "free" exception)
//   inferred free  : Navi's assumption, each with the reason it's assumed
//                    (awake and nothing else is on; the wake-to-bed default
//                    from setup; times the person worked on recent weeks)
//   unknown        : Navi has no basis to assume (e.g. weekday school/work
//                    hours with nothing recorded for them); never planned
//   busy           : one-day "busy" exceptions and usual "busy" rules
//
// Events, routines and kept blocks are subtracted later by the scheduler.

export type CapacitySlot = { starts_at: string; ends_at: string; basis: Basis; reason: string | null };
export type BusySpan = { title: string; starts_at: string; ends_at: string; kind: "exception" | "rule" };
export type UnknownSpan = { starts_at: string; ends_at: string; label: string };

export type DayModelInput = {
  date: string;
  zone: string;
  wakeBed: { wake: string; bed: string } | null;
  /** Settings' usual free times (profiles.availability). */
  usualFree: AvailabilityWindow[];
  /** True when usualFree is just the wake-to-bed default setup wrote (an assumption, not a statement). */
  usualFreeIsDefault: boolean;
  rules: AvailabilityRule[];
  /** Any dates; only this date's are used. */
  exceptions: DayException[];
  events: CalendarEvent[];
  overrides: OccurrenceOverride[];
  routines: Routine[];
  /** D1: plan in awake time with nothing else on, as a labelled assumption. */
  assumeFreeTime: boolean;
  /** Weekday hours that are probably taken (school/work) when nothing is recorded for them. */
  typicalHours: { start: string; end: string; label: string }[];
  /** Past blocks the person worked in (done/partial), any dates. */
  history: { starts_at: string; ends_at: string }[];
};

export type DayModel = {
  date: string;
  awake: { starts_at: string; ends_at: string } | null;
  capacity: CapacitySlot[];
  busy: BusySpan[];
  unknown: UnknownSpan[];
  /** "Only N minutes today" (smallest one-day capacity exception). */
  capacityLimitMinutes: number | null;
  /** The one question to ask when Navi knows nothing about the day. */
  clarification: string | null;
  minutes: { confirmed: number; inferred: number; unknown: number };
};

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

function valid(ivs: (Interval | null)[]): Interval[] {
  return ivs.filter((i): i is Interval => !!i && i.isValid && i.length("minutes") >= 1);
}

export function union(ivs: Interval[]): Interval[] {
  return Interval.merge(valid(ivs)).sort((a, b) => a.start!.toMillis() - b.start!.toMillis());
}

export function minus(ivs: Interval[], cut: Interval[]): Interval[] {
  let out = valid(ivs);
  for (const c of valid(cut)) out = out.flatMap((i) => i.difference(c));
  return union(out);
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) for (const y of b) {
    const i = x.intersection(y);
    if (i && i.isValid && i.length("minutes") >= 1) out.push(i);
  }
  return union(out);
}

const total = (ivs: Interval[]) => Math.round(ivs.reduce((s, i) => s + i.length("minutes"), 0));

/**
 * A weekly time window on one date. A window that ends at or before it starts
 * runs past midnight (22:00–01:00): its first part is on the listed day, its
 * second part on the next morning (fixes B1, where it was silently dropped).
 */
export function windowOn(w: { days: number[]; start: string; end: string }, date: string, zone: string): Interval[] {
  const dow = weekdayOf(date, zone);
  const prev = (dow + 6) % 7;
  const dayStart = DateTime.fromISO(date, { zone }).startOf("day");
  const next = dayStart.plus({ days: 1 });
  const s = minutesOf(w.start);
  const e = minutesOf(w.end);
  if (s === e) return [];
  if (e > s) return w.days.includes(dow) ? valid([Interval.fromDateTimes(atLocalTime(date, w.start, zone), atLocalTime(date, w.end, zone))]) : [];
  const out: Interval[] = [];
  if (w.days.includes(dow)) out.push(Interval.fromDateTimes(atLocalTime(date, w.start, zone), next));
  if (w.days.includes(prev)) out.push(Interval.fromDateTimes(dayStart, atLocalTime(date, w.end, zone)));
  return valid(out);
}

/** Every occurrence of an event on a date, with one-session changes applied (cancelled, or moved here / away). */
export function occurrencesOn(ev: CalendarEvent, date: string, zone: string, overrides: OccurrenceOverride[]): Interval[] {
  const mine = overrides.filter((o) => o.event_id === ev.id);
  const out: Interval[] = [];
  const here = mine.find((o) => o.occurrence_date === date);
  if (!here) {
    const iv = eventOccurrence(ev, date, zone);
    if (iv) out.push(iv);
  }
  if (ev.status !== "cancelled") {
    for (const o of mine) {
      if (o.status !== "moved" || !o.starts_at || !o.ends_at) continue;
      const iv = Interval.fromDateTimes(DateTime.fromISO(o.starts_at).setZone(zone), DateTime.fromISO(o.ends_at).setZone(zone));
      const day = Interval.fromDateTimes(DateTime.fromISO(date, { zone }).startOf("day"), DateTime.fromISO(date, { zone }).plus({ days: 1 }).startOf("day"));
      if (iv.isValid && iv.overlaps(day)) out.push(iv);
    }
  }
  return out;
}

/** The awake span on a date (bedtime after midnight is clipped to the end of the day). */
export function awakeOn(wakeBed: { wake: string; bed: string } | null, date: string, zone: string): Interval | null {
  if (!wakeBed) return null;
  const s = atLocalTime(date, wakeBed.wake, zone);
  const next = DateTime.fromISO(date, { zone }).plus({ days: 1 }).startOf("day");
  const bed = minutesOf(wakeBed.bed) > minutesOf(wakeBed.wake) ? atLocalTime(date, wakeBed.bed, zone) : next;
  const iv = Interval.fromDateTimes(s, bed);
  return iv.isValid ? iv : null;
}

function ruleApplies(r: AvailabilityRule, date: string): boolean {
  return (!r.valid_from || r.valid_from <= date) && (!r.valid_until || date <= r.valid_until);
}

export function buildDayModel(input: DayModelInput): DayModel {
  const { date, zone } = input;
  const dow = weekdayOf(date, zone);
  const dayStart = DateTime.fromISO(date, { zone }).startOf("day");
  const fmt = (d: DateTime) => d.setZone(zone).toFormat(d.minute ? "h:mm a" : "h a");
  const awake = awakeOn(input.wakeBed, date, zone);
  const exceptions = input.exceptions.filter((x) => x.date === date);
  const rules = input.rules.filter((r) => ruleApplies(r, date));
  const span = (x: { start_time: string | null; end_time: string | null }) =>
    x.start_time && x.end_time ? windowOn({ days: [dow], start: x.start_time, end: x.end_time }, date, zone).filter((i) => i.start! >= dayStart) : [Interval.fromDateTimes(dayStart, dayStart.plus({ days: 1 }))];

  // Busy: one-day facts beat usual rules; a one-day "free" beats a usual "busy".
  const freeExceptions = union(exceptions.filter((x) => x.kind === "free").flatMap(span));
  const busyExceptions = exceptions.filter((x) => x.kind === "busy");
  const busyRules = rules.filter((r) => r.kind === "busy");
  const busy: BusySpan[] = [];
  for (const x of busyExceptions) for (const iv of span(x)) busy.push({ title: x.note || "Busy", starts_at: iv.start!.toISO()!, ends_at: iv.end!.toISO()!, kind: "exception" });
  for (const r of busyRules) {
    for (const iv of minus(windowOn({ days: r.days, start: r.start_time, end: r.end_time }, date, zone), freeExceptions)) {
      busy.push({ title: r.note || "Busy", starts_at: iv.start!.toISO()!, ends_at: iv.end!.toISO()!, kind: "rule" });
    }
  }
  const busyIvs = union(busy.map((b) => Interval.fromDateTimes(DateTime.fromISO(b.starts_at), DateTime.fromISO(b.ends_at))));

  // Confirmed free.
  let confirmed = union([
    ...(input.usualFreeIsDefault ? [] : input.usualFree.flatMap((w) => windowOn(w, date, zone))),
    ...rules.filter((r) => r.kind === "free" && r.basis === "confirmed").flatMap((r) => windowOn({ days: r.days, start: r.start_time, end: r.end_time }, date, zone)),
    ...freeExceptions,
  ]);
  confirmed = minus(confirmed, busyIvs);

  // Inferred free, most specific reason first; each source only adds what's left.
  type Slot = { iv: Interval; reason: string };
  const inferred: Slot[] = [];
  let taken = union([...confirmed, ...busyIvs]);
  const add = (ivs: Interval[], reason: string) => {
    const clipped = awake ? intersect(ivs, [awake]) : ivs;
    for (const iv of minus(clipped, taken)) inferred.push({ iv, reason });
    taken = union([...taken, ...clipped]);
  };
  for (const r of rules.filter((r) => r.kind === "free" && r.basis === "inferred")) {
    add(windowOn({ days: r.days, start: r.start_time, end: r.end_time }, date, zone), r.note || "your usual free time");
  }
  if (input.assumeFreeTime) {
    if (input.usualFreeIsDefault) add(input.usualFree.flatMap((w) => windowOn(w, date, zone)), "you're awake and nothing else is on");
    if (awake) add([awake], "you're awake and nothing else is on");
  }

  // Unknown: weekday school/work hours with nothing recorded for them that
  // day, unless the person has worked then on recent weeks.
  const unknown: UnknownSpan[] = [];
  const fixedToday = union([
    ...input.events.flatMap((e) => occurrencesOn(e, date, zone, input.overrides)),
    ...input.routines
      .filter((r) => r.active && r.days.includes(dow) && r.start_time && (r.protection ?? (r.is_fixed ? "fixed" : "protected")) !== "flexible")
      .map((r) => Interval.fromDateTimes(atLocalTime(date, r.start_time!, zone), atLocalTime(date, r.start_time!, zone).plus({ minutes: r.duration_minutes }))),
    ...busyIvs,
  ]);
  const weekday = dow >= 1 && dow <= 5;
  const pastSameDay = input.history.filter((h) => DateTime.fromISO(h.starts_at).setZone(zone).weekday % 7 === dow && DateTime.fromISO(h.starts_at).setZone(zone).toISODate()! < date);
  const onThisDate = (iso: string) => {
    const d = DateTime.fromISO(iso).setZone(zone);
    return atLocalTime(date, d.toFormat("HH:mm"), zone);
  };
  for (const t of weekday ? input.typicalHours : []) {
    const tIv = windowOn({ days: [dow], start: t.start, end: t.end }, date, zone);
    if (fixedToday.some((f) => tIv.some((i) => i.overlaps(f)))) continue; // their day is recorded
    const unsure = intersect(inferred.map((s) => s.iv), tIv);
    if (!unsure.length) continue;
    // Worked here on 2+ recent same weekdays: keep it as an assumption.
    const worked = pastSameDay.map((h) => Interval.fromDateTimes(onThisDate(h.starts_at), onThisDate(h.ends_at))).filter((i) => i.isValid);
    const learned = unsure.flatMap((u) => {
      const hits = worked.filter((w) => w.overlaps(u));
      return hits.length >= 2 ? intersect(hits, [u]) : [];
    });
    const stillUnknown = minus(unsure, learned);
    if (!stillUnknown.length) continue;
    const kept = inferred.splice(0, inferred.length);
    for (const s of kept) {
      for (const iv of minus([s.iv], stillUnknown)) {
        const fromHistory = learned.some((l) => l.overlaps(iv));
        inferred.push({ iv, reason: fromHistory ? `you've worked then on recent ${DateTime.fromISO(date, { zone }).toFormat("cccc")}s` : s.reason });
      }
    }
    for (const iv of stillUnknown) unknown.push({ starts_at: iv.start!.toISO()!, ends_at: iv.end!.toISO()!, label: t.label });
  }
  if (!input.assumeFreeTime && awake) {
    for (const iv of minus([awake], union([...confirmed, ...inferred.map((s) => s.iv), ...busyIvs, ...unknown.map((u) => Interval.fromDateTimes(DateTime.fromISO(u.starts_at), DateTime.fromISO(u.ends_at)))]))) {
      unknown.push({ starts_at: iv.start!.toISO()!, ends_at: iv.end!.toISO()!, label: "free time not confirmed" });
    }
  }

  const capacity: CapacitySlot[] = [
    ...confirmed.map((iv) => ({ starts_at: iv.start!.toISO()!, ends_at: iv.end!.toISO()!, basis: "confirmed" as const, reason: null })),
    ...inferred.sort((a, b) => a.iv.start!.toMillis() - b.iv.start!.toMillis()).map((s) => ({ starts_at: s.iv.start!.toISO()!, ends_at: s.iv.end!.toISO()!, basis: "inferred" as const, reason: s.reason })),
  ].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

  const limits = exceptions.filter((x) => x.kind === "capacity" && x.minutes != null).map((x) => x.minutes!);
  const unknownIvs = unknown.map((u) => Interval.fromDateTimes(DateTime.fromISO(u.starts_at), DateTime.fromISO(u.ends_at)));
  let clarification: string | null = null;
  if (!capacity.length && !awake && !busy.length) {
    clarification = `When are you usually free on ${DateTime.fromISO(date, { zone }).toFormat("cccc")}s? Or tell me when you wake up and go to bed, and I'll work around everything else.`;
  } else if (!capacity.length && unknownIvs.length) {
    const biggest = [...unknownIvs].sort((a, b) => b.length("minutes") - a.length("minutes"))[0];
    clarification = `Are you free between ${fmt(biggest.start!)} and ${fmt(biggest.end!)} on ${DateTime.fromISO(date, { zone }).toFormat("cccc")}?`;
  }
  return {
    date,
    awake: awake ? { starts_at: awake.start!.toISO()!, ends_at: awake.end!.toISO()! } : null,
    capacity,
    busy,
    unknown,
    capacityLimitMinutes: limits.length ? Math.min(...limits) : null,
    clarification,
    minutes: { confirmed: total(confirmed), inferred: total(inferred.map((s) => s.iv)), unknown: total(unknownIvs) },
  };
}

/** Is Settings' free-time list just the wake-to-bed default setup writes? */
export function isWakeBedDefault(usualFree: AvailabilityWindow[], wakeBed: { wake: string; bed: string } | null): boolean {
  if (!wakeBed || usualFree.length !== 1) return false;
  const w = usualFree[0];
  const hhmm = (t: string) => t.slice(0, 5);
  const end = wakeBed.bed > wakeBed.wake ? wakeBed.bed : "23:59";
  return w.days.length === 7 && hhmm(w.start) === wakeBed.wake && hhmm(w.end) === end;
}

/** Weekday hours a School or Work space suggests are taken, when nothing is recorded for them. */
export function typicalHoursFor(spaceNames: string[]): { start: string; end: string; label: string }[] {
  const out: { start: string; end: string; label: string }[] = [];
  if (spaceNames.some((n) => /\b(school|class(es)?|college|uni(versity)?|homework|studies)\b/i.test(n))) out.push({ start: "08:00", end: "15:00", label: "school hours" });
  if (spaceNames.some((n) => /\b(work|job|office|shifts?)\b/i.test(n))) out.push({ start: "09:00", end: "17:00", label: "work hours" });
  return out;
}
