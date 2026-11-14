// Times are shown in the person's own time zone (the server's `timezone`),
// not the phone's, so travelling doesn't shift the plan.

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts });
    cache.set(key, f);
  }
  return f;
}

/** "2:00" or "10:30" — the timeline column (no AM/PM). */
export function clock(iso: string, tz: string): string {
  return fmt(tz, { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/\s?[AP]M$/i, "");
}

/** "2:00 PM" */
export function clockAmPm(iso: string, tz: string): string {
  return fmt(tz, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "2:00 – 3:30 PM" */
export function range(startIso: string, endIso: string, tz: string): string {
  const a = clockAmPm(startIso, tz);
  const b = clockAmPm(endIso, tz);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${sameHalf ? a.replace(/\s?[AP]M$/i, "") : a} – ${b}`;
}

/** Hour of the day (0–24, fractional) in the person's zone. */
export function hourOf(iso: string, tz: string): number {
  const parts = fmt(tz, { hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

export function weekday(dateStr: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" }).format(new Date(dateStr + "T12:00:00Z"));
}
export function weekdayShort(dateStr: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(new Date(dateStr + "T12:00:00Z"));
}
export function monthDay(dateStr: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(dateStr + "T12:00:00Z"));
}
export function dayNum(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "1 h", "1½ h", "45 min" */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes >= 120) {
    // Long stretches read better rounded to the half hour: "5½ h", "8 h".
    const halves = Math.round(minutes / 30);
    return halves % 2 ? `${(halves - 1) / 2}½ h` : `${halves / 2} h`;
  }
  const h = Math.floor(minutes / 60);
  const r = minutes % 60;
  return r >= 25 && r <= 35 ? `${h}½ h` : r ? `${h} h ${r} min` : `${h} h`;
}
