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
