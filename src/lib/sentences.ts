/**
 * Every sentence Navi writes on a page, built only from the person's data
 * (docs/navi-1.5/design-canvas/V4-Sources.dc.html):
 *  1. numbers are real counts;  2. "I did" only with an activity-log record;
 *  3. no mind-reading;  4. missing data → the clause is dropped;
 *  5. at most one suggestion per page, from a fixed list, and "Not now" sticks.
 * Sentences come back as segments so the page can show the facts bright and
 * the connecting words dim, the way the boards do.
 */

export type Seg = { text: string; strong?: boolean };
export type Line = Seg[];

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
/** "Four" for small counts, digits above twelve. */
export function countWord(n: number, capital = true): string {
  const w = n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
  return capital ? w : w.toLowerCase();
}

/**
 * Minutes as hours in quarter steps: 570 → "9½ hours", 60 → "1 hour",
 * 45 → "45 minutes". Rounded to the nearest quarter hour.
 */
export function hoursText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const quarters = Math.round(m / 15);
  const whole = Math.floor(quarters / 4);
  const frac = ["", "¼", "½", "¾"][quarters % 4];
  const label = `${whole}${frac}`;
  return `${label} hour${whole === 1 && !frac ? "" : "s"}`;
}

/** "Morning, Alex." / "Afternoon." — local hour picks the word; no name, no name. */
export function greeting(firstName: string | null | undefined, localHour: number): string {
  const part = localHour < 5 ? "Evening" : localHour < 12 ? "Morning" : localHour < 17 ? "Afternoon" : "Evening";
  const name = firstName?.trim();
  return name ? `${part}, ${name}.` : `${part}.`;
}

export type DayPart = "morning" | "afternoon" | "evening";
const PART_WORD: Record<DayPart, string> = { morning: "morning", afternoon: "afternoon", evening: "evening" };

/** Which part of the day a minute-of-day falls in: before noon / noon–5 / after 5. */
export function partOf(minuteOfDay: number): DayPart {
  return minuteOfDay < 12 * 60 ? "morning" : minuteOfDay < 17 * 60 ? "afternoon" : "evening";
}

/** The clearly busiest part (at least `min` minutes, and a quarter more than the next), else null. */
export function busiestPart(minutes: Record<DayPart, number>, min = 60): DayPart | null {
  const ranked = (Object.entries(minutes) as [DayPart, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (top[1] < min || top[1] < second[1] * 1.25) return null;
  return top[0];
}

/**
 * Home summary. `tasks`: today's tasks (scheduled or due today, top-level),
 * with whether each is done. `planned`: planned minutes by part of the day.
 */
export function homeSummary(tasks: { done: boolean }[], planned: Record<DayPart, number>): Line {
  const n = tasks.length;
  if (n === 0) return [{ text: "Nothing on your list today." }];
  const done = tasks.filter((t) => t.done).length;
  const line: Line = [{ text: `${countWord(n)} thing${n === 1 ? "" : "s"} today` }];
  if (done === n) line.push({ text: ", " }, { text: n === 1 ? "and it's done" : "all done", strong: true });
  else if (done > 0) line.push({ text: ", " }, { text: `${countWord(done, false)} already done`, strong: true });
  line.push({ text: "." });
  const busy = busiestPart(planned);
  if (busy) line.push({ text: " Your " }, { text: PART_WORD[busy], strong: true }, { text: " is the busy part." });
  return line;
}

/** Tasks headline: "4 left. “History essay” is the big one — everything else takes under 15 minutes." */
export function tasksHeadline(open: { title: string; estimate: number | null }[], doneToday: number): Line {
  const n = open.length;
  if (n === 0) return [{ text: doneToday > 0 ? "All done for today." : "Nothing due today.", strong: true }];
  const line: Line = [{ text: `${n} left.`, strong: true }];
  if (n >= 2 && open.every((t) => t.estimate != null)) {
    const sorted = [...open].sort((a, b) => b.estimate! - a.estimate!);
    const [big, ...rest] = sorted;
    if (big.estimate! >= 30 && rest.every((t) => t.estimate! < 15)) {
      line.push({ text: ` “${big.title}” is the big one — everything else takes under 15 minutes.` });
    }
  }
  return line;
}

export type Span = { start: number; end: number }; // epoch ms

/** Merge overlapping spans and clip them to [from, to). */
export function mergeSpans(spans: Span[], from = -Infinity, to = Infinity): Span[] {
  const clipped = spans
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of clipped) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Free stretches between `from` and `to` around the busy spans. */
export function freeGaps(busy: Span[], from: number, to: number): Span[] {
  const merged = mergeSpans(busy, from, to);
  const gaps: Span[] = [];
  let cursor = from;
  for (const s of merged) {
    if (s.start > cursor) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (to > cursor) gaps.push({ start: cursor, end: to });
  return gaps;
}

const minutes = (spans: Span[]) => spans.reduce((t, s) => t + (s.end - s.start) / 60000, 0);

/**
 * My day headline: "A full afternoon. 9½ hours planned, 3½ free — most of it before 2."
 * `awake`: wake-up to bedtime today, when known (else free time isn't counted).
 * `fmtHour` turns an epoch ms into "2" / "2:30" in the person's zone.
 * `minuteOfDay` gives the local minute of the day for an epoch ms.
 */
export function myDayHeadline(
  busy: Span[],
  awake: Span | null,
  fmtHour: (ms: number) => string,
  minuteOfDay: (ms: number) => number,
): Line {
  const merged = mergeSpans(busy);
  const planned = minutes(merged);
  if (planned < 1) return [{ text: "Nothing planned yet.", strong: true }];
  const byPart: Record<DayPart, number> = { morning: 0, afternoon: 0, evening: 0 };
  for (const s of merged) {
    for (let t = s.start; t < s.end; t += 15 * 60000) byPart[partOf(minuteOfDay(t))] += Math.min(15, (s.end - t) / 60000);
  }
  // "A full afternoon" needs the afternoon to really be full: three hours or more.
  const busiest = busiestPart(byPart, 180);
  const line: Line = [];
  if (busiest) line.push({ text: `A full ${PART_WORD[busiest]}. `, strong: true });
  const plannedText = hoursText(planned);
  if (!awake) {
    line.push({ text: `${plannedText} planned.` });
    return line;
  }
  const gaps = freeGaps(merged, awake.start, awake.end).filter((g) => g.end - g.start >= 15 * 60000);
  const free = minutes(gaps);
  if (free < 15) {
    line.push({ text: `${plannedText} planned, no free time left.` });
    return line;
  }
  // "9½ hours planned, 3½ free": the second unit is implied when both are hours.
  const freeText = planned >= 60 && free >= 60 ? hoursText(free).replace(/ hours?$/, "") : hoursText(free);
  let where = "";
  const biggest = [...gaps].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  if (gaps.length > 1 && biggest && (biggest.end - biggest.start) / 60000 >= free / 2) {
    const mid = (awake.start + awake.end) / 2;
    where = biggest.end <= mid ? ` — most of it before ${fmtHour(biggest.end)}` : biggest.start >= mid ? ` — most of it after ${fmtHour(biggest.start)}` : "";
  }
  line.push({ text: `${plannedText} planned, ${freeText} free${where}.` });
  return line;
}

/**
 * Calendar headline for a week: "Friday's the full one — 9½ hours planned.
 * Saturday has just brunch with Jo." `days`: planned minutes and item titles per day.
 */
export function weekHeadline(days: { name: string; minutes: number; titles: string[]; routines?: number }[]): Line {
  const withTime = days.filter((d) => d.minutes > 0);
  if (!withTime.length) return [{ text: "Nothing planned this week yet.", strong: true }];
  const sorted = [...days].sort((a, b) => b.minutes - a.minutes);
  const full = sorted[0];
  const quiet = sorted[sorted.length - 1];
  if (full.minutes - quiet.minutes < 60) return [{ text: "About the same every day this week.", strong: true }];
  const line: Line = [{ text: `${full.name}'s the full one — ${hoursText(full.minutes)} planned.`, strong: true }];
  // Several empty days: count them instead of naming one of them at random.
  // A day with only routines (gym, wind down) isn't "nothing planned".
  const open = days.filter((d) => d.minutes === 0 && d.titles.length === 0 && !d.routines);
  if (open.length > 1) line.push({ text: ` ${countWord(open.length)} days have nothing planned.` });
  else if (quiet.titles.length === 0) line.push({ text: ` ${quiet.name} is open.` });
  else if (quiet.titles.length <= 2) line.push({ text: ` ${quiet.name} has just ${joinAnd(quiet.titles.map(lowerFirstWord))}.` });
  return line;
}

function joinAnd(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Brunch with Jo" → "brunch with Jo" (only when the first word looks like an ordinary word). */
function lowerFirstWord(title: string): string {
  const [first, ...rest] = title.split(" ");
  if (!first || first.length < 2 || first !== first[0] + first.slice(1).toLowerCase() || rest.length === 0) return title;
  return [first.toLowerCase(), ...rest].join(" ");
}

/** "Last worked on last night, 45 min." — from the latest focus session with progress. */
export function lastWorkedText(endedAtMs: number, actualMinutes: number | null, nowMs: number, localHourOf: (ms: number) => number, sameLocalDay: (a: number, b: number) => boolean, yesterday: (a: number, b: number) => boolean): string {
  const h = localHourOf(endedAtMs);
  const when = sameLocalDay(endedAtMs, nowMs)
    ? h < 12 ? "this morning" : h < 17 ? "this afternoon" : "this evening"
    : yesterday(endedAtMs, nowMs)
      ? h >= 17 || h < 5 ? "last night" : h < 12 ? "yesterday morning" : "yesterday afternoon"
      : `${Math.max(2, Math.round((nowMs - endedAtMs) / 86400000))} days ago`;
  return `Last worked on ${when}${actualMinutes ? `, ${actualMinutes} min` : ""}.`;
}
