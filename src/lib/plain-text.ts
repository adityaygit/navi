import { DateTime } from "luxon";

// What Navi shows the person about its actions, in plain words. Tools keep an
// exact `summary` for the model (its memory of what happened); people see a
// short `display` line instead: no field names, no timestamps, no item codes,
// no planner words, and never a list of twenty titles. Shared by the server
// (tools, plan summaries, briefings) and the chat UI (including older
// messages saved before `display` existed). Pure, unit-tested.

/** Tools whose steps change the plan: one reply's plan steps show as one card with one Undo. */
export const PLAN_TOOLS: readonly string[] = [
  "plan_day",
  "plan_week",
  "recover_plan",
  "plan",
  "move_block",
  "undo_plan",
  "shift_blocks",
  "keep_off_until",
  "skip_occurrence",
  "set_day_exception",
];

/**
 * A title as people say it: no leading item code ("02.03a "), no trailing tag
 * in brackets ("(AP World)"), at most `max` characters. Display only; the
 * stored title never changes.
 */
export function shortTitle(title: string, max = 40): string {
  const original = title.replace(/\s+/g, " ").trim();
  let t = original
    // "02.03a Reading", "U3.2 - Quiz", "1.4: Notes" (a dotted code; a plain "3 pages" stays)
    .replace(/^(?:[A-Za-z]{1,4}[\s-]?)?\d+(?:[.\-]\d+)+[a-z]?\b[\s.:)\-–—]*/, "")
    // "[APW] Essay"
    .replace(/^\[[^\]]{1,20}\]\s*/, "");
  for (let i = 0; i < 2; i++) t = t.replace(/\s*[([][^()[\]]{1,30}[)\]]\s*$/, "");
  t = t.replace(/[\s,;:–—-]+$/, "").trim();
  if (!t) t = original;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}

/** “Short title”, quoted. */
export const q = (title: string, max?: number) => `“${shortTitle(title, max)}”`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "things" for counts of planned work: "1 thing", "6 things". */
export const things = (n: number) => plural(n, "thing");

/** "today", "tonight", "tomorrow", or the weekday ("Monday"); a far date gets its month and day. */
export function dayWord(date: string, zone: string, now: DateTime = DateTime.now(), evening = false): string {
  const today = now.setZone(zone).toISODate()!;
  const d = DateTime.fromISO(date, { zone });
  const diff = Math.round(d.startOf("day").diff(DateTime.fromISO(today, { zone }).startOf("day"), "days").days);
  if (diff === 0) return evening || now.setZone(zone).hour >= 17 ? "tonight" : "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff < 7) return d.toFormat("cccc");
  return d.toFormat("ccc LLL d");
}

/** "this morning" / "this afternoon" / "this evening" / "tonight" for a time today; "Monday afternoon" otherwise. */
export function partOfDay(at: DateTime, now: DateTime = DateTime.now()): string {
  const h = at.hour;
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
  if (at.toISODate() === now.setZone(at.zone).toISODate()) return part === "night" ? "tonight" : `this ${part}`;
  return `${at.toFormat("cccc")} ${part}`;
}

/** A clock time for the expanded detail only ("2:05 PM", "Mon 9:00 AM" when on another day). */
export function clockFor(iso: string, zone: string, day?: string): string {
  const d = DateTime.fromISO(iso, { setZone: true }).setZone(zone);
  return day && d.toISODate() !== day ? d.toFormat("ccc h:mm a") : d.toFormat("h:mm a");
}

/** What a list of field names means to a person ("starts_at, ends_at" → "time"). */
export function fieldWords(keys: string[]): string {
  const words: Record<string, string> = {
    starts_at: "time", ends_at: "time", plan_date: "day", start_time: "time", duration_minutes: "length", days: "days",
    due_at: "due date", due_is_hard: "deadline", estimate_minutes: "estimate", is_fixed: "fixed or flexible", protection: "how fixed it is",
    priority: "priority", title: "name", name: "name", notes: "notes", status: "status", pinned: "kept in place", recurrence: "repeat",
    not_before: "start date", commitment: "must-do", blocker: "what it's waiting on", target_date: "target date", due_date: "due date",
    quiet_hours_start: "do-not-disturb times", quiet_hours_end: "do-not-disturb times", availability: "usual free times", timezone: "time zone",
    display_name: "name", morning_briefing_time: "morning briefing", evening_review_time: "evening review", active: "on or off",
    workspace_id: "area", project_id: "project", goal_id: "goal", location: "place", body: "text", reason: "note", outcome_reason: "note",
  };
  const out = [...new Set(keys.map((k) => words[k] ?? k.replace(/_/g, " ")))];
  return out.length > 1 ? `${out.slice(0, -1).join(", ")} and ${out[out.length - 1]}` : (out[0] ?? "");
}

const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const FIELD = /\b[a-z]+(?:_[a-z]+)+\b/;
const FIELD_ARROW = /\b[a-z]+(?:_[a-z]+)*\s*(?:→|->)\s*\S/;
const CLOCK = /\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)\b|\b\d{1,2}:\d{2}\b/;
/** Planner words people shouldn't have to learn. */
export const JARGON = /\b(blocks?|availability|interrupted|recovery options|quiet hours|change ?sets?|flexible work|re-?planned|unscheduled|capacity|P[1-4])\b/i;

/**
 * Why a line isn't plain enough to show a person ([] = fine). `detail` lines
 * (inside the disclosure) may name clock times and use "title → time".
 */
export function plainProblems(text: string, opts: { detail?: boolean; maxLength?: number; maxQuoted?: number } = {}): string[] {
  const out: string[] = [];
  const maxLength = opts.maxLength ?? (opts.detail ? 160 : 120);
  if (new RegExp(ISO.source).test(text)) out.push("ISO timestamp");
  if (UUID.test(text)) out.push("id");
  if (FIELD.test(text.replace(/“[^”]*”/g, ""))) out.push("field name");
  if (!opts.detail && /→|->/.test(text)) out.push("arrow");
  else if (FIELD_ARROW.test(text.replace(/“[^”]*”/g, "")) && /_/.test(text)) out.push("field arrow");
  if (!opts.detail && CLOCK.test(text.replace(/“[^”]*”/g, ""))) out.push("clock time");
  const unquoted = text.replace(/“[^”]*”/g, "");
  const jargon = unquoted.match(JARGON);
  if (jargon) out.push(`jargon: ${jargon[0]}`);
  if ((text.match(/“/g) ?? []).length > (opts.maxQuoted ?? 3)) out.push("long list");
  if (text.length > maxLength) out.push("too long");
  return out;
}

/** Turns "“A”, “B”, “C”, “D” and 9 more" (or a longer quoted list) into "13 things". */
function collapseLists(text: string): string {
  return text.replace(/(?:“[^”]*”(?: \([^)]*\))?(?:, | and |, and )){3,}“[^”]*”(?: \([^)]*\))?(?: and (\d+) more)?/g, (m, more) => {
    const n = (m.match(/“/g) ?? []).length + (more ? Number(more) : 0);
    return things(n);
  });
}

/** Shortens every quoted title in a line. */
function shortenQuoted(text: string): string {
  return text.replace(/“([^”]*)”/g, (_, t: string) => q(t));
}

/**
 * A plain line from an older saved step, which only has the model's summary:
 * known shapes are rewritten ("Updated plan block “X”: starts_at → …" →
 * "Moved “X”"), timestamps and field changes are dropped, long lists become a
 * count, and only the first sentence is kept.
 */
export function legacyDisplay(e: { name: string; ok: boolean; summary: string }): string {
  const s = (e.summary ?? "").trim();
  if (!s) return "";
  let m = s.match(/^Updated plan block “(.+?)”:(.*)$/);
  if (m) return /starts_at|ends_at|plan_date/.test(m[2]) ? `Moved ${q(m[1])}` : `Updated ${q(m[1])}`;
  m = s.match(/^Updated (?:task|project|goal|workspace|routine|event|milestone|note|plan block) “(.+?)”/);
  if (m) return `Updated ${q(m[1])}`;
  m = s.match(/^Created task “(.+?)”/);
  if (m) return `Added ${q(m[1])}`;
  if (e.name === "recover_plan" || /^Reworked/.test(s)) {
    const left = s.match(/still on your task list: (.*?);/);
    return left ? `Reworked the rest of today. ${things(countTitles(left[1]))} didn't fit` : "Reworked the rest of today";
  }
  if (["plan_day", "plan_week", "plan"].includes(e.name) || /placed \d+ blocks?|no flexible blocks placed/.test(s)) {
    const placed = s.match(/placed (\d+) blocks?/);
    const head = placed ? `Planned ${things(Number(placed[1]))}` : "Updated your plan";
    const fit = s.match(/Didn't fit[^:]*: (.*?)\. (?:It|They) stay/);
    return fit ? `${head}. ${things(countTitles(fit[1]))} didn't fit` : head;
  }
  return firstPlainSentence(s);
}

/** How many titles a summary's list names ("“A” (30 min), “B” and 9 more" → 11). */
export function countTitles(list: string): number {
  const more = list.match(/and (\d+) more/);
  return (list.match(/“/g) ?? []).length + (more ? Number(more[1]) : 0);
}

/** First sentence of a summary, cleaned of timestamps, field changes, ids and long lists. */
export function firstPlainSentence(text: string): string {
  let s = text
    .replace(/\s*\[[0-9a-f-]{36}\]/gi, "")
    .replace(/:\s*(?:[a-z]+(?:_[a-z]+)*\s*→\s*[^,]*,?\s*)+$/i, "")
    .replace(/\s*\((?:[a-z]+_[a-z_]+(?:, )?)+\)/g, "")
    .replace(new RegExp(ISO.source, "g"), (iso) => {
      const d = DateTime.fromISO(iso, { setZone: true });
      return d.isValid ? d.toFormat("ccc") : "";
    });
  s = collapseLists(shortenQuoted(s));
  // Planner words, outside quoted titles, in words people use.
  s = s.replace(/(“[^”]*”)|\b(blocks?|availability|interrupted|re-?planned|quiet hours)\b/gi, (m, quoted: string | undefined, word: string | undefined) => {
    if (quoted || !word) return m;
    const w = word.toLowerCase();
    return w === "block" ? "thing" : w === "blocks" ? "things" : w === "availability" ? "free time" : w === "interrupted" ? "set aside" : w === "quiet hours" ? "do-not-disturb time" : "planned again";
  });
  const first = s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s;
  const line = first.replace(/\.$/, "").trim();
  return line.length > 120 ? `${line.slice(0, 117).replace(/\s+\S*$/, "")}…` : line;
}

/** Detail lines from an older step: "Updated plan block “X”: starts_at → <iso>" gives "X → 2:05 PM". */
export function legacyDetail(e: { summary: string }): string[] {
  const m = (e.summary ?? "").match(/^Updated plan block “(.+?)”:.*?starts_at → (\S+?)(?:,|$)/);
  if (!m) return [];
  const d = DateTime.fromISO(m[2], { setZone: true });
  return d.isValid ? [`${shortTitle(m[1])} → ${d.toFormat("h:mm a")}`] : [];
}

/**
 * An Activity entry readable by a person: field lists become words
 * ("(starts_at, ends_at)" → "(time)"), field changes ("due_at → <iso>")
 * become "due date → Mon 5:00 PM", and raw timestamps become day and time.
 * Detail stays; only machine spelling goes.
 */
export function plainActivity(summary: string, zone?: string): string {
  const when = (iso: string) => {
    const d = DateTime.fromISO(iso, { setZone: true });
    return d.isValid ? (zone ? d.setZone(zone) : d).toFormat("ccc LLL d, h:mm a") : iso;
  };
  return summary
    .replace(/\((\s*[a-z]+(?:_[a-z]+)*(?:\s*,\s*[a-z]+(?:_[a-z]+)*)*\s*)\)/g, (m, keys: string) => (/_/.test(keys) ? `(${fieldWords(keys.split(/\s*,\s*/))})` : m))
    .replace(/\b([a-z]+_[a-z_]+)\s*→/g, (_, k: string) => `${fieldWords([k])} →`)
    .replace(new RegExp(ISO.source, "g"), when)
    .replace(/\bplan block\b/g, "plan")
    .replace(/\s*\[[0-9a-f-]{36}\]/gi, "");
}

/** Is this saved step a change to the plan? (Older steps have no flag; their tool name or summary says.) */
export function isPlanStep(e: { name: string; summary?: string; plan?: boolean }): boolean {
  if (e.plan !== undefined) return e.plan;
  return PLAN_TOOLS.includes(e.name) || (e.name === "update_item" && /^Updated plan block/.test(e.summary ?? ""));
}
