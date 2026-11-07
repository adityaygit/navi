import { DateTime } from "luxon";

/**
 * The Tasks quick-add bar: "pick up concert tickets fri #friends".
 * - A day word (today, tonight, tomorrow, a weekday or its short form, with an
 *   optional "on"/"by"/"due" before it) becomes the due date, and is removed
 *   from the title. A weekday means its next occurrence (today if it's today).
 * - A space whose name appears as a whole word is suggested as the task's
 *   space. "#name" is removed from the title; a plain word stays (it is part
 *   of what the person wrote: "call Home insurance").
 * Plain rules only: no AI, nothing guessed beyond these words.
 */
export type QuickAddSpace = { id: string; name: string };
export type QuickAdd = {
  title: string;
  /** Local date (YYYY-MM-DD) and a label for the chip ("Today", "Friday"). */
  due: { date: string; label: string } | null;
  space: QuickAddSpace | null;
};

const WEEKDAYS: [RegExp, number][] = [
  [/^mon(day)?$/, 1],
  [/^tue(s|sday)?$/, 2],
  [/^wed(s|nesday)?$/, 3],
  [/^thu(r|rs|rsday)?$/, 4],
  [/^fri(day)?$/, 5],
  [/^sat(urday)?$/, 6],
  [/^sun(day)?$/, 7],
];

function dayFor(word: string, now: DateTime): { date: DateTime; label: string } | null {
  const w = word.toLowerCase();
  if (w === "today" || w === "tonight") return { date: now, label: "Today" };
  if (w === "tomorrow" || w === "tmrw" || w === "tmr" || w === "tomorow") return { date: now.plus({ days: 1 }), label: "Tomorrow" };
  for (const [re, iso] of WEEKDAYS) {
    if (re.test(w)) {
      const ahead = (iso - now.weekday + 7) % 7;
      const date = now.plus({ days: ahead });
      return { date, label: ahead === 0 ? "Today" : ahead === 1 ? "Tomorrow" : date.toFormat("cccc") };
    }
  }
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseQuickAdd(text: string, spaces: QuickAddSpace[], now: DateTime): QuickAdd {
  let words = text.trim().split(/\s+/).filter(Boolean);
  let due: QuickAdd["due"] = null;
  // The last day word wins ("move the call from mon to wed" → Wednesday).
  for (let i = words.length - 1; i >= 0; i--) {
    const bare = words[i].replace(/[.,!?;:]+$/, "");
    const d = dayFor(bare, now);
    if (!d) continue;
    due = { date: d.date.toISODate()!, label: d.label };
    const prev = words[i - 1]?.toLowerCase();
    const from = prev && ["on", "by", "due", "for", "this"].includes(prev) ? i - 1 : i;
    words = [...words.slice(0, from), ...words.slice(i + 1)];
    break;
  }
  let title = words.join(" ");
  let space: QuickAddSpace | null = null;
  // Longest names first, so "Side project" beats "Side".
  for (const s of [...spaces].sort((a, b) => b.name.length - a.name.length)) {
    const name = s.name.trim();
    if (!name) continue;
    const tag = new RegExp(`(^|\\s)#${escape(name.replace(/\s+/g, ""))}(?=$|[\\s.,!?;:])`, "i");
    if (tag.test(title)) {
      space = s;
      title = title.replace(tag, " ").replace(/\s+/g, " ").trim();
      break;
    }
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "iu").test(title)) {
      space = s;
      break;
    }
  }
  return { title: title.trim(), due, space };
}

/** The due moment for a quick-added day: the end of that local day (shown as "end of day"). */
export function endOfDayIso(date: string, zone: string): string {
  return DateTime.fromISO(date, { zone }).set({ hour: 23, minute: 59, second: 0, millisecond: 0 }).toISO()!;
}
