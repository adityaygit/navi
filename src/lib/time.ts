import { DateTime } from "luxon";

// All scheduling math happens in the user's IANA time zone so DST transitions
// are handled by luxon rather than by hand-rolled offsets.

export function isValidZone(zone: string): boolean {
  return DateTime.now().setZone(zone).isValid;
}

export function nowIn(zone: string): DateTime {
  const dt = DateTime.now().setZone(zone);
  return dt.isValid ? dt : DateTime.now().setZone("UTC");
}

export function localDate(zone: string, at: Date | string = new Date()): string {
  const base = typeof at === "string" ? DateTime.fromISO(at) : DateTime.fromJSDate(at);
  return base.setZone(zone).toISODate()!;
}

/** "HH:MM" or "HH:MM:SS" on a local date -> DateTime in that zone. */
export function atLocalTime(dateISO: string, time: string, zone: string): DateTime {
  const [h, m] = time.split(":").map(Number);
  return DateTime.fromISO(dateISO, { zone }).set({ hour: h, minute: m || 0, second: 0, millisecond: 0 });
}

/** 0 = Sunday ... 6 = Saturday (JS convention, matches DB columns). */
export function weekdayOf(dateISO: string, zone: string): number {
  return DateTime.fromISO(dateISO, { zone }).weekday % 7;
}

export function minutesBetween(a: string | Date, b: string | Date): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/** True when `at` falls inside the quiet-hours window (window may wrap midnight). */
export function inQuietHours(
  at: DateTime,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return false;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const s = toMin(start);
  const e = toMin(end);
  const cur = at.hour * 60 + at.minute;
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** Next moment at or after `at` that is outside quiet hours. */
export function endOfQuietHours(at: DateTime, start: string | null, end: string | null): DateTime {
  if (!inQuietHours(at, start, end) || !end) return at;
  const [h, m] = end.split(":").map(Number);
  let candidate = at.set({ hour: h, minute: m || 0, second: 0, millisecond: 0 });
  if (candidate <= at) candidate = candidate.plus({ days: 1 });
  return candidate;
}

export function formatTime(iso: string, zone: string): string {
  return DateTime.fromISO(iso).setZone(zone).toFormat("h:mm a");
}

export function formatDay(dateISO: string, zone: string): string {
  return DateTime.fromISO(dateISO, { zone }).toFormat("cccc, LLL d");
}

export function formatDue(iso: string, zone: string): string {
  const dt = DateTime.fromISO(iso).setZone(zone);
  const today = nowIn(zone).startOf("day");
  const diff = Math.round(dt.startOf("day").diff(today, "days").days);
  const time = dt.hour === 23 && dt.minute === 59 ? "" : ` ${dt.toFormat("h:mm a")}`;
  if (diff === 0) return `today${time}`;
  if (diff === 1) return `tomorrow${time}`;
  if (diff === -1) return `yesterday${time}`;
  if (diff < 0) return `${-diff} days ago`;
  if (diff < 7) return `${dt.toFormat("cccc")}${time}`;
  return dt.toFormat("LLL d") + time;
}
