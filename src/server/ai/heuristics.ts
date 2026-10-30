import { DateTime } from "luxon";

// Rule-based (non-AI) parsing. Used by the development simulator and as a
// clearly-labelled fallback when no AI is available, so captures are still
// split into reviewable items instead of being lost. Low confidence by design.

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_RE = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?s?";
// Same pattern without a capture group, for use inside larger patterns.
const DAY_NC = "(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?s?";

function dayIndex(token: string): number {
  const t = token.toLowerCase().slice(0, 3);
  return DAYS.findIndex((d) => d.startsWith(t));
}

function parseClock(h: string, m: string | undefined, ampm: string | undefined): { hour: number; minute: number } {
  let hour = Number(h);
  const minute = m ? Number(m) : 0;
  const ap = ampm?.toLowerCase();
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  if (!ap && hour >= 1 && hour <= 6) hour += 12; // "at 4" usually means 4pm
  return { hour, minute };
}

/** Find a due date/time phrase. Returns ISO with offset, end-of-day if no time given. */
export function parseDue(text: string, now: DateTime): { iso: string; phrase: string } | null {
  const lower = text.toLowerCase();
  const time = lower.match(/\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  const withTime = (d: DateTime) => {
    if (!time) return d.endOf("day").set({ second: 0, millisecond: 0 });
    const { hour, minute } = parseClock(time[1], time[2], time[3]);
    return d.set({ hour, minute, second: 0, millisecond: 0 });
  };
  let m: RegExpMatchArray | null;
  if ((m = lower.match(/\btonight\b/))) return { iso: withTime(now).set(time ? {} : { hour: 21, minute: 0 }).toISO()!, phrase: m[0] };
  if ((m = lower.match(/\btoday\b/))) return { iso: withTime(now).toISO()!, phrase: m[0] };
  if ((m = lower.match(/\btomorrow\b/))) return { iso: withTime(now.plus({ days: 1 })).toISO()!, phrase: m[0] };
  if ((m = lower.match(/\bnext week\b/))) return { iso: withTime(now.plus({ weeks: 1 }).startOf("week")).toISO()!, phrase: m[0] };
  if ((m = lower.match(new RegExp(`\\b(?:by|on|due|this|next)?\\s*${DAY_RE}\\b`)))) {
    const idx = dayIndex(m[1]);
    if (idx >= 0) {
      let d = now.startOf("day");
      for (let i = 1; i <= 7; i++) {
        d = now.startOf("day").plus({ days: i });
        if (d.weekday % 7 === idx) break;
      }
      return { iso: withTime(d).toISO()!, phrase: m[0].trim() };
    }
  }
  if ((m = lower.match(/\b(?:on|by)?\s*(\d{1,2})\/(\d{1,2})\b/))) {
    let d = now.set({ month: Number(m[1]), day: Number(m[2]) }).startOf("day");
    if (d.isValid && d < now.startOf("day")) d = d.plus({ years: 1 });
    if (d.isValid) return { iso: withTime(d).toISO()!, phrase: m[0].trim() };
  }
  return null;
}

const ACTION_CUES = /\b(need to|have to|has to|must|should|gotta|got to|remember to|don't forget|todo|to do|finish|submit|email|call|text|buy|study|review|write|prepare|book|schedule|pay|send|fix|practice|read|start|apply|clean|plan|ask|meet)\b/i;
const EVENT_CUE = /\b(meeting|appointment|exam|test|quiz|game|match|interview|party|dentist|doctor|class|practice|rehearsal)\b/i;

export type ExtractedItem = {
  kind: "task" | "event" | "note" | "question";
  title: string;
  excerpt: string;
  due_at?: string;
  priority?: number;
  estimate_minutes?: number;
};

export function splitIntoItems(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?;])\s+|\s*,\s*(?:and\s+)?(?=(?:i\s+)?(?:need|have|must|should|gotta|also|then|remember|don't)\b)|\s+(?:and also|also|plus)\s+|\s+and\s+(?=(?:email|call|text|buy|study|review|write|prepare|book|schedule|pay|send|fix|practice|read|start|apply|clean|plan|ask|meet|submit|finish)\b)/i)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((s) => s.length >= 3);
}

function cleanTitle(s: string, phrase?: string): string {
  let t = s;
  if (phrase) t = t.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "");
  t = t
    .replace(/^(?:also|and|then|so|ok|okay|um|uh)\b[\s,]*/i, "")
    .replace(/^(?:i\s+)?(?:really\s+)?(?:need to|have to|must|should|gotta|got to|want to|remember to|don't forget to)\s+/i, "")
    .replace(/\b(?:by|at|on|due)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[.,;!\s]+$/, "")
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function extractItems(text: string, now: DateTime): ExtractedItem[] {
  const out: ExtractedItem[] = [];
  for (const part of splitIntoItems(text)) {
    const due = parseDue(part, now);
    const urgent = /\b(urgent|asap|important|critical)\b/i.test(part);
    if (/\?\s*$/.test(part)) {
      out.push({ kind: "question", title: part, excerpt: part });
    } else if (EVENT_CUE.test(part) && due && /\b(at)\s+\d/i.test(part) && !ACTION_CUES.test(part.replace(EVENT_CUE, ""))) {
      out.push({ kind: "event", title: cleanTitle(part, due.phrase), excerpt: part, due_at: due.iso });
    } else if (ACTION_CUES.test(part) || due) {
      const est = part.match(/\b(\d{1,3})\s*(min|minutes|m|hours?|h)\b/i);
      const estimate = est ? (est[2].toLowerCase().startsWith("h") ? Number(est[1]) * 60 : Number(est[1])) : undefined;
      out.push({
        kind: "task",
        title: cleanTitle(part, due?.phrase) || part,
        excerpt: part,
        due_at: due?.iso,
        priority: urgent ? 2 : 3,
        estimate_minutes: estimate,
      });
    } else {
      out.push({ kind: "note", title: part.slice(0, 80), excerpt: part });
    }
  }
  return out;
}

/** Weekly fixed commitments like "soccer practice mon and wed at 4pm" -> event pieces. */
export function extractWeeklyCommitments(text: string): { title: string; days: number[]; hour: number; minute: number; excerpt: string }[] {
  const results: { title: string; days: number[]; hour: number; minute: number; excerpt: string }[] = [];
  const re = new RegExp(
    `([a-z][a-z \\-']{2,40}?)\\s+(?:on\\s+|every\\s+)?((?:${DAY_NC}(?:\\s*(?:,|and|&|\\/)\\s*)?)+)\\s*(?:from|at)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?`,
    "gi",
  );
  for (const m of text.matchAll(re)) {
    const days = [...m[2].matchAll(new RegExp(DAY_RE, "gi"))].map((d) => dayIndex(d[1])).filter((d) => d >= 0);
    const { hour, minute } = parseClock(m[3], m[4], m[5]);
    const title = m[1].replace(/^(?:i have|i've got|i got|and|also|plus|my|have)\s+/i, "").trim();
    if (days.length && title) results.push({ title: title.charAt(0).toUpperCase() + title.slice(1), days, hour, minute, excerpt: m[0].trim() });
  }
  if (/\bweekdays\b/i.test(text)) {
    const m = text.match(/([a-z][a-z \-']{2,40}?)\s+(?:on\s+)?weekdays\s+(?:from|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (m) {
      const { hour, minute } = parseClock(m[2], m[3], m[4]);
      results.push({ title: m[1].replace(/^(?:i have|my)\s+/i, "").trim(), days: [1, 2, 3, 4, 5], hour, minute, excerpt: m[0] });
    }
  }
  return results;
}

/** "free after 4pm on weekdays", "free from 7 to 10" -> availability windows. */
export function extractAvailability(text: string): { days: number[]; start: string; end: string }[] {
  const lower = text.toLowerCase();
  const out: { days: number[]; start: string; end: string }[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const m of lower.matchAll(/free\s+(?:after|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*(?:to|until|till|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?((?:(?!\bfree\b)[^.;])*)/g)) {
    const s = parseClock(m[1], m[2], m[3]);
    const e = m[4] ? parseClock(m[4], m[5], m[6] ?? (Number(m[4]) < 12 ? "pm" : undefined)) : { hour: 21, minute: 0 };
    const tail = m[7] ?? "";
    // The tail stops at the next "free", so each window keeps its own days.
    const days = /weekday/.test(tail) ? [1, 2, 3, 4, 5] : /weekend/.test(tail) ? [0, 6] : /every ?day|daily/.test(tail) ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    out.push({ days, start: `${pad(s.hour)}:${pad(s.minute)}`, end: `${pad(e.hour)}:${pad(e.minute)}` });
  }
  return out;
}

const AREAS: [string, RegExp][] = [
  ["School", /\b(school|class|classes|homework|exam|study|college|university|teacher|essay|grade)\b/i],
  ["Startups", /\b(startup|company|founder|customers?|product|launch|investor)\b/i],
  ["Work", /\b(job|shift|boss|work at|internship)\b/i],
  ["Fitness", /\b(gym|soccer|basketball|run|running|fitness|workout|practice|swim|tennis|sport)\b/i],
  ["Personal", /\b(family|friends|personal|chores|hobby|music|guitar|piano|read)\b/i],
];

export function detectAreas(text: string): string[] {
  return AREAS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

export function areaFor(text: string): string | null {
  return AREAS.find(([, re]) => re.test(text))?.[0] ?? null;
}

const tidy = (s: string) => {
  const t = s.replace(/^(?:a|an|my|the)\s+/i, "").replace(/[.,;!\s]+$/, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "my goal is to get an A in chemistry", "I want to run a half marathon" -> goals. */
export function extractGoals(text: string): { title: string; excerpt: string }[] {
  const out: { title: string; excerpt: string }[] = [];
  for (const m of text.matchAll(/\b(?:my (?:main |big )?goal is to|i want to|i'd like to|i'm hoping to|i hope to|i aim to)\s+([^.;\n]{3,120})/gi)) {
    // "I want to finish X by friday" is a task, not a goal.
    if (/\b(by|due|tomorrow|today|tonight)\b/i.test(m[1]) || /^(?:finish|submit|email|call|text|buy|send|pay)\b/i.test(m[1])) continue;
    out.push({ title: tidy(m[1]), excerpt: m[0].trim() });
  }
  return out;
}

/** "working on an app called Tally", "building a robot for the science fair" -> projects. */
export function extractProjects(text: string): { name: string; excerpt: string }[] {
  const out: { name: string; excerpt: string }[] = [];
  for (const m of text.matchAll(/\b(?:i'?m |i am )?(?:working on|building|developing)\s+([^.,;\n]{3,80}?)(?=\s+(?:and|but|while|so)\b|[.,;\n]|$)/gi)) {
    const called = m[1].match(/\bcalled\s+(.+)$/i);
    const name = tidy(called ? called[1] : m[1]);
    // "working on a startup" names an area of life, not a project.
    if (name.split(/\s+/).length <= 2 && areaFor(name)) continue;
    out.push({ name, excerpt: m[0].trim() });
  }
  return out;
}

/** "I go to the gym every morning at 7", "I read every night" -> flexible or fixed routines. */
export function extractRoutines(text: string): { title: string; days: number[]; start_time: string | null; excerpt: string }[] {
  const out: { title: string; days: number[]; start_time: string | null; excerpt: string }[] = [];
  const re = /\b(?:i\s+)?([a-z][a-z' ]{2,40}?)\s+every\s+(day|morning|evening|night|weekday|weekend)s?(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/gi;
  for (const m of text.matchAll(re)) {
    const when = m[2].toLowerCase();
    const days = when === "weekday" ? [1, 2, 3, 4, 5] : when === "weekend" ? [0, 6] : [0, 1, 2, 3, 4, 5, 6];
    let start: string | null = null;
    if (m[3]) {
      let { hour } = parseClock(m[3], m[4], m[5]);
      const minute = m[4] ? Number(m[4]) : 0;
      // parseClock assumes a bare "at 7" is pm; a morning routine means am.
      if (!m[5] && when === "morning" && hour >= 12) hour -= 12;
      start = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    const title = m[1].replace(/^(?:also|and|usually|try to|like to)\s+/i, "").trim();
    out.push({ title: title.charAt(0).toUpperCase() + title.slice(1), days, start_time: start, excerpt: m[0].trim() });
  }
  return out;
}

const NOT_NAMES = new Set(["Free", "Busy", "Done", "Fine", "Good", "Here", "Back", "Not", "Just", "Also", "So", "Usually", "Always", "Really", "Working", "Going", "Trying", "Taking", "Doing", "Ready", "Happy", "Sure", "Okay", "Ok", "In", "On", "At", "A", "An", "The"]);

/** "I'm Alex", "my name is Alex", "call me Alex" -> "Alex" (capitalized word only, so "I'm in school" isn't a name). */
export function extractName(text: string): string | null {
  const m = text.match(/(?:\b[Mm]y name is|\b[Cc]all me|\bI'm|\bI am|\b[Tt]his is)\s+([A-Z][a-zA-Z'-]{1,30})\b/);
  if (!m || NOT_NAMES.has(m[1])) return null;
  return m[1];
}
