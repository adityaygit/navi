import { DateTime } from "luxon";

// A deterministic check on what the capture model proposes: Navi never
// invents a time of day the user didn't say. Pure (no I/O), unit-tested.
//
// - A task or reminder due at a clock time nobody mentioned is moved to a soft
//   due date at the end of that day.
// - A one-off event with an invented time becomes a task due that day (there
//   is no all-day event: an event blocks its whole time in the planner).
// - A weekday named on that same weekday ("on Friday" said on a Friday) is
//   ambiguous, so the item says which day was assumed.
// Every change is explained in the item's rationale, so the user sees it in
// the review inbox.

/** Clock times, and parts of the day a person can name ("Friday evening"). */
const TIME_OF_DAY = new RegExp(
  [
    String.raw`\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?=\W|$)`,
    String.raw`\b\d{1,2}:\d{2}\b`,
    String.raw`\b(?:at|by|from|until|till|til|before|after|around|about|between)\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b`,
    String.raw`\b(?:noon|midday|midnight|o'?clock|morning|afternoon|evening|tonight|night|lunch(?:time)?|dinner(?:time)?|breakfast|bedtime|eod|half past|quarter (?:past|to))\b`,
    String.raw`\b(?:after|before)\s+(?:school|work|class|practice|bed|lunch|dinner)\b`,
    String.raw`\bin\s+(?:an?|\d+|half an)\s+(?:min|mins|minutes?|hours?|hrs?)\b`,
    String.raw`\bend of (?:the )?day\b`,
  ].join("|"),
  "i",
);

export function mentionsTimeOfDay(text: string): boolean {
  return TIME_OF_DAY.test(text);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * The sentence(s) of `source` that contain `excerpt`, so a time said right
 * next to the quoted words still counts. Falls back to the whole text when the
 * excerpt can't be found (it was paraphrased or missing).
 */
export function contextFor(source: string, excerpt: string | null | undefined): string {
  const ex = (excerpt ?? "").trim().toLowerCase();
  if (!ex) return source;
  const at = source.toLowerCase().indexOf(ex);
  if (at < 0) return source;
  const before = source.slice(0, at);
  const start = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n")) + 1;
  const tail = source.slice(at + ex.length);
  const m = tail.search(/[.!?\n]/);
  const end = m < 0 ? source.length : at + ex.length + m;
  return source.slice(start, end);
}

function isEndOfDay(dt: DateTime) {
  return dt.hour === 23 && dt.minute === 59;
}

/** End of the local day `dt` means; a bare midnight is read as the end of the day before. */
function endOfDay(dt: DateTime): DateTime {
  const day = dt.hour === 0 && dt.minute === 0 ? dt.minus({ minutes: 1 }) : dt;
  return day.set({ hour: 23, minute: 59, second: 0, millisecond: 0 });
}

function note(rationale: unknown, add: string): string {
  const base = typeof rationale === "string" && rationale.trim() ? `${rationale.trim().replace(/[.\s]*$/, "")}. ` : "";
  return `${base}${add}`.slice(0, 1000);
}

export type GuardedItem = {
  kind: string;
  payload: Record<string, unknown>;
  source_excerpt?: string | null;
  rationale?: string | null;
};

export function guardInventedTimes<T extends GuardedItem>(items: T[], opts: { sourceText: string; zone: string; now: DateTime }): T[] {
  const { sourceText, zone } = opts;
  const now = opts.now.setZone(zone);
  return items.map((item) => {
    const context = contextFor(sourceText, item.source_excerpt);
    const timeSaid = mentionsTimeOfDay(context);
    const p = item.payload;
    let out: T = item;

    if ((item.kind === "task" || item.kind === "reminder") && typeof p.due_at === "string") {
      const due = DateTime.fromISO(p.due_at).setZone(zone);
      if (due.isValid && !isEndOfDay(due) && !timeSaid) {
        const fixed = endOfDay(due);
        out = {
          ...item,
          payload: { ...p, due_at: fixed.toISO()!, due_is_hard: p.due_is_hard ?? false },
          rationale: note(item.rationale, `No time of day was given, so it's due by the end of ${fixed.toFormat("cccc LLL d")} instead of ${due.toFormat("h:mm a")}.`),
        };
      }
    } else if (item.kind === "event" && typeof p.starts_at === "string" && !p.recurrence && !timeSaid) {
      const start = DateTime.fromISO(p.starts_at).setZone(zone);
      if (start.isValid) {
        const fixed = endOfDay(start.plus({ minutes: 1 }));
        const notes = [p.notes, p.location ? `Location: ${p.location}` : null].filter(Boolean).join("\n") || null;
        out = {
          ...item,
          kind: "task",
          payload: {
            title: p.title,
            notes,
            due_at: fixed.toISO()!,
            due_is_hard: false,
            ...(p.workspace_ref ? { workspace_ref: p.workspace_ref } : {}),
            ...(p.workspace_id ? { workspace_id: p.workspace_id } : {}),
          },
          rationale: note(item.rationale, `No time was given, so this is a task due ${fixed.toFormat("cccc LLL d")} rather than an event at ${start.toFormat("h:mm a")}. Edit it if it has a set time.`),
        };
      }
    }

    // "On Friday" said on a Friday: today, or a week from now? Say which was assumed.
    const when = typeof out.payload.due_at === "string" ? out.payload.due_at : typeof out.payload.starts_at === "string" ? out.payload.starts_at : null;
    const todayName = WEEKDAYS[now.weekday % 7];
    if (when && new RegExp(`\\b${todayName}\\b`, "i").test(context) && !/\b(today|tonight|this (morning|afternoon|evening))\b/i.test(context)) {
      const day = DateTime.fromISO(when).setZone(zone).startOf("day");
      const offset = Math.round(day.diff(now.startOf("day"), "days").days);
      const label = todayName.charAt(0).toUpperCase() + todayName.slice(1);
      const said = typeof out.rationale === "string" && new RegExp(`\\b${todayName}\\b`, "i").test(out.rationale) && /\b(next|today|assum)/i.test(out.rationale);
      if ((offset === 0 || offset === 7) && !said) {
        const other = offset === 0 ? `next ${label} (${now.plus({ days: 7 }).toFormat("LLL d")})` : `today (${now.toFormat("LLL d")})`;
        out = {
          ...out,
          rationale: note(out.rationale, `Today is ${label}, so “${label}” was read as ${offset === 0 ? "today" : `next ${label}, ${day.toFormat("LLL d")}`}; edit it if you meant ${other}.`),
        };
      }
    }
    return out;
  });
}

/**
 * Weekday numbers are 0 = Sunday … 6 = Saturday. Some models count Monday as
 * 0 (Gemini Live did: "every Saturday" came back as [5]). A weekly event's own
 * start date shows which convention a batch used: when the events' start days
 * are all one off (and none match), every day list in the batch is shifted to
 * the right numbering and the change is noted on each item.
 */
export function fixWeekdayNumbering<T extends GuardedItem>(items: T[], zone: string): T[] {
  let offByOne = 0;
  let aligned = 0;
  for (const i of items) {
    const rec = i.payload.recurrence as { days?: unknown } | null | undefined;
    if (i.kind !== "event" || typeof i.payload.starts_at !== "string" || !Array.isArray(rec?.days) || !rec.days.length) continue;
    const start = DateTime.fromISO(i.payload.starts_at).setZone(zone);
    if (!start.isValid) continue;
    const wd = start.weekday % 7;
    if (rec.days.includes(wd)) aligned++;
    else if (rec.days.includes((wd + 6) % 7)) offByOne++;
  }
  if (!offByOne || aligned) return items;
  const shift = (days: unknown) => (Array.isArray(days) ? [...new Set(days.filter((d): d is number => typeof d === "number").map((d) => (d + 1) % 7))].sort((a, b) => a - b) : days);
  const why = "Weekday numbers were off by one (Monday counted as 0) and were corrected.";
  return items.map((i) => {
    const p = i.payload;
    let payload: Record<string, unknown> | null = null;
    const rec = p.recurrence as { days?: unknown } | null | undefined;
    if ((i.kind === "event" || i.kind === "task" || i.kind === "reminder") && Array.isArray(rec?.days)) payload = { ...p, recurrence: { ...rec, days: shift(rec.days) } };
    else if (i.kind === "routine" && Array.isArray(p.days)) payload = { ...p, days: shift(p.days) };
    else if (i.kind === "preference" && Array.isArray(p.availability)) {
      payload = { ...p, availability: (p.availability as Record<string, unknown>[]).map((w) => ({ ...w, days: shift(w.days) })) };
    }
    return payload ? { ...i, payload, rationale: note(i.rationale, why) } : i;
  });
}
