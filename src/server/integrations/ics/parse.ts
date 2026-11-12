import ICAL from "ical.js";
import { DateTime } from "luxon";
import { FeedError } from "../safe-fetch";
import { sanitizeText } from "./text";

// Generic iCalendar (RFC 5545) reader for imported feeds. Provider adapters
// (Canvas today) turn its occurrences into Navi items.
//
// Handles: UTC, TZID (IANA via luxon, otherwise the feed's own VTIMEZONE),
// floating times (feed X-WR-TIMEZONE, else the person's zone), all-day dates,
// RRULE/RDATE recurrence expanded inside a window with EXDATE exclusions and
// RECURRENCE-ID overrides (moved or cancelled single occurrences), orphan
// overrides, STATUS:CANCELLED, missing end times. Text is sanitized.

export type IcsTime = { allDay: true; date: string } | { allDay: false; utc: string };

export type IcsOccurrence = {
  uid: string;
  /** null for single events; the occurrence's original start (UTC ISO or date) for recurring ones. */
  recurrenceId: string | null;
  summary: string;
  description: string | null;
  url: string | null;
  location: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  start: IcsTime;
  /** Exclusive end; for all-day items the day after the last day. */
  end: IcsTime | null;
  recurring: boolean;
};

export type ParsedFeed = {
  calendarName: string | null;
  /** VEVENT components in the document (before expansion): providers use it to detect truncated feeds. */
  rawEventCount: number;
  occurrences: IcsOccurrence[];
  /** Events skipped because they were unusable (no UID or start). */
  skipped: number;
  /** A recurring series hit the expansion cap, so later occurrences may be missing. */
  expansionCapped: boolean;
};

export type ParseOptions = {
  windowStart: Date;
  windowEnd: Date;
  /** Zone for floating times when the feed doesn't name one. */
  defaultZone: string;
  maxPerSeries?: number;
  maxTotal?: number;
};

type Time = InstanceType<typeof ICAL.Time>;
type Comp = InstanceType<typeof ICAL.Component>;

const validZone = (z: string | null | undefined): z is string => !!z && DateTime.local().setZone(z).isValid;

function tzidOf(comp: Comp, prop: string): string | null {
  const p = comp.getFirstProperty(prop);
  const v = p?.getParameter("tzid");
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;
}

export function parseIcs(text: string, opts: ParseOptions): ParsedFeed {
  const body = text.replace(/^﻿/, "");
  if (!/^\s*BEGIN:VCALENDAR/i.test(body.slice(0, 2048))) throw new FeedError("not_calendar", "That link didn't return a calendar.");
  let root: Comp;
  try {
    root = new ICAL.Component(ICAL.parse(body));
  } catch {
    throw new FeedError("invalid_feed", "The calendar couldn't be read (it isn't valid iCalendar).");
  }
  if (root.name !== "vcalendar") throw new FeedError("invalid_feed", "The calendar couldn't be read (it isn't valid iCalendar).");

  const maxPerSeries = opts.maxPerSeries ?? 1000;
  const maxTotal = opts.maxTotal ?? 5000;
  const feedZone = (() => {
    const z = root.getFirstPropertyValue("x-wr-timezone");
    return typeof z === "string" && validZone(z) ? z : null;
  })();
  const floatingZone = feedZone ?? (validZone(opts.defaultZone) ? opts.defaultZone : "UTC");
  const vtimezones = new Map<string, InstanceType<typeof ICAL.Timezone>>();
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    try {
      const tz = new ICAL.Timezone(vtz);
      if (tz.tzid) vtimezones.set(tz.tzid, tz);
    } catch {
      // An unusable VTIMEZONE: times using it fall back below.
    }
  }

  /** A calendar time (wall clock + the TZID it was written with) → UTC or a date. */
  const toIcsTime = (t: Time, tzid: string | null): IcsTime | null => {
    if (t.isDate) return { allDay: true, date: `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` };
    const wall = { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second };
    let dt: DateTime;
    if (t.zone === ICAL.Timezone.utcTimezone || t.zone?.tzid === "UTC" || tzid === "UTC" || tzid === "Z") {
      dt = DateTime.fromObject(wall, { zone: "UTC" });
    } else if (tzid && validZone(tzid)) {
      dt = DateTime.fromObject(wall, { zone: tzid });
    } else if (tzid && vtimezones.has(tzid)) {
      const offset = vtimezones.get(tzid)!.utcOffset(t); // seconds east of UTC at that wall time
      dt = DateTime.fromObject(wall, { zone: "UTC" }).minus({ seconds: offset });
    } else {
      dt = DateTime.fromObject(wall, { zone: floatingZone });
    }
    return dt.isValid ? { allDay: false, utc: dt.toUTC().toISO()! } : null;
  };

  const vevents = root.getAllSubcomponents("vevent");
  const byUid = new Map<string, { master: Comp | null; overrides: Comp[] }>();
  let skipped = 0;
  for (const ev of vevents) {
    const uid = sanitizeText(ev.getFirstPropertyValue("uid"), 500, { singleLine: true });
    if (!uid || !ev.getFirstProperty("dtstart")) {
      skipped++;
      continue;
    }
    const g = byUid.get(uid) ?? { master: null, overrides: [] };
    if (ev.getFirstProperty("recurrence-id")) g.overrides.push(ev);
    else if (!g.master) g.master = ev;
    else skipped++; // duplicate master with the same UID: keep the first
    byUid.set(uid, g);
  }

  const occurrences: IcsOccurrence[] = [];
  let expansionCapped = false;
  const winStart = opts.windowStart.getTime();
  const winEnd = opts.windowEnd.getTime();
  const msOf = (t: IcsTime) => (t.allDay ? Date.parse(`${t.date}T00:00:00Z`) : Date.parse(t.utc));

  const describe = (comp: Comp, uid: string, recurrenceId: string | null, start: IcsTime, end: IcsTime | null, recurring: boolean): IcsOccurrence => {
    const rawStatus = String(comp.getFirstPropertyValue("status") ?? "").toUpperCase();
    const status = rawStatus === "CANCELLED" ? "cancelled" : rawStatus === "TENTATIVE" ? "tentative" : "confirmed";
    const url = comp.getFirstPropertyValue("url");
    return {
      uid,
      recurrenceId,
      summary: sanitizeText(comp.getFirstPropertyValue("summary"), 500, { singleLine: true }) || "(untitled)",
      description: sanitizeText(comp.getFirstPropertyValue("description"), 4000) || null,
      url: typeof url === "string" ? url.trim().slice(0, 2000) : null,
      location: sanitizeText(comp.getFirstPropertyValue("location"), 500, { singleLine: true }) || null,
      status,
      start,
      end,
      recurring,
    };
  };

  /** Start/end of one component (or of an occurrence of it). */
  const span = (comp: Comp, startTime: Time, endTime: Time | null): { start: IcsTime; end: IcsTime | null } | null => {
    const start = toIcsTime(startTime, tzidOf(comp, "dtstart"));
    if (!start) return null;
    let end: IcsTime | null = null;
    if (endTime) end = toIcsTime(endTime, tzidOf(comp, comp.getFirstProperty("dtend") ? "dtend" : "dtstart"));
    if (start.allDay && (!end || !end.allDay || msOf(end) <= msOf(start))) {
      // A date with no (usable) end lasts one day.
      const next = DateTime.fromISO(start.date, { zone: "UTC" }).plus({ days: 1 }).toISODate()!;
      end = { allDay: true, date: next };
    }
    if (end && !start.allDay && (end.allDay || msOf(end) < msOf(start))) end = null;
    return { start, end };
  };

  const ridString = (t: Time, comp: Comp): string | null => {
    const v = toIcsTime(t, tzidOf(comp, comp.getFirstProperty("recurrence-id") ? "recurrence-id" : "dtstart"));
    return v ? (v.allDay ? v.date : v.utc) : null;
  };

  for (const [uid, g] of byUid) {
    if (occurrences.length >= maxTotal) {
      expansionCapped = true;
      break;
    }
    if (!g.master) {
      // Overrides whose series isn't in the feed: keep each as its own occurrence.
      for (const o of g.overrides) {
        const e = new ICAL.Event(o);
        const s = span(o, e.startDate, e.endDate ?? null);
        const rid = ridString(o.getFirstPropertyValue("recurrence-id") as Time, o);
        if (s && rid) occurrences.push(describe(o, uid, rid, s.start, s.end, true));
        else skipped++;
      }
      continue;
    }
    const event = new ICAL.Event(g.master);
    for (const o of g.overrides) {
      try {
        event.relateException(o);
      } catch {
        skipped++;
      }
    }
    if (!event.isRecurring()) {
      const s = span(g.master, event.startDate, event.endDate ?? null);
      if (!s) {
        skipped++;
        continue;
      }
      occurrences.push(describe(g.master, uid, null, s.start, s.end, false));
      continue;
    }

    const it = event.iterator();
    let count = 0;
    let next: Time | null;
    const seenRids = new Set<string>();
    // Iterate from the series start; stop once occurrences pass the window.
    while ((next = it.next())) {
      if (++count > maxPerSeries * 5) {
        expansionCapped = true;
        break;
      }
      const details = event.getOccurrenceDetails(next);
      const item = details.item.component;
      const s = span(item, details.startDate, details.endDate ?? null);
      const rid = ridString(details.recurrenceId, g.master);
      if (!s || !rid) continue;
      const originalMs = Date.parse(rid.length === 10 ? `${rid}T00:00:00Z` : rid);
      const startMs = msOf(s.start);
      // Both the original and the (possibly moved) time are past the window: done.
      if (originalMs > winEnd && startMs > winEnd) break;
      const endMs = s.end ? msOf(s.end) : startMs;
      if (endMs < winStart || startMs > winEnd) continue;
      seenRids.add(rid);
      occurrences.push(describe(item, uid, rid, s.start, s.end, true));
      if (seenRids.size >= maxPerSeries) {
        expansionCapped = true;
        break;
      }
    }
    // Overrides that moved an occurrence into the window from outside the expanded range.
    for (const o of g.overrides) {
      const rid = ridString(o.getFirstPropertyValue("recurrence-id") as Time, o);
      if (!rid || seenRids.has(rid)) continue;
      const e = new ICAL.Event(o);
      const s = span(o, e.startDate, e.endDate ?? null);
      if (!s) continue;
      const startMs = msOf(s.start);
      if (startMs >= winStart && startMs <= winEnd) occurrences.push(describe(o, uid, rid, s.start, s.end, true));
    }
  }

  const name = root.getFirstPropertyValue("x-wr-calname");
  return {
    calendarName: typeof name === "string" ? sanitizeText(name, 200, { singleLine: true }) || null : null,
    rawEventCount: vevents.length,
    occurrences,
    skipped,
    expansionCapped,
  };
}
