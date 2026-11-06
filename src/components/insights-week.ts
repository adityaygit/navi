// Pure helpers that turn recorded data (weekInsights + the week's plan blocks)
// into what the Insights screens show: per-day planned vs done, a plain-English
// reading of the week, and what Navi noticed. Nothing here invents a number or
// a reason: every figure comes from the rows passed in, and a reason is only
// given when the person (or a "my plan broke" report) recorded one.
import { DateTime } from "luxon";
import { blockCategory, describeDisruptions, OUTCOMES, STOPPED_NO_REASON } from "@/lib/outcomes";

/** "2h 40m", "40m", "0m". */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${String(r).padStart(2, "0")}m` : `${h}h`;
}

/** "2 hours 40 minutes" for screen readers. */
export function hmLong(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (r || !h) parts.push(`${r} minute${r === 1 ? "" : "s"}`);
  return parts.join(" ");
}

export type WeekBlock = { plan_date: string; status: string; outcome_reason: string | null; starts_at: string; ends_at: string };

export type DayKind = "none" | "rest" | "short" | "ok";

export type DayBar = {
  date: string;
  /** Mon, Tue… */
  short: string;
  /** Monday… */
  long: string;
  /** M, T… */
  letter: string;
  isToday: boolean;
  /** Minutes of work blocks (rest blocks left out: rest isn't work you planned to do). */
  planned: number;
  done: number;
  partial: number;
  rest: number;
  /** Blocks not done for a reason outside the person's control (interrupted, missing info, ran over the estimate). */
  outside: { interrupted: number; missingInfo: number; estimate: number; notes: string[] };
  /** Blocks skipped with no outside reason (or missed). */
  skipped: number;
  unmarked: number;
  kind: DayKind;
};

const minutesOf = (b: Pick<WeekBlock, "starts_at" | "ends_at">) => Math.max(0, Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000));

/** The note a person typed after a standard reason ("Interrupted: lab ran long" → "lab ran long"), or a free-text reason. */
export function reasonNote(reason: string | null): string | null {
  const r = (reason ?? "").trim();
  if (!r) return null;
  const prefixes = [...Object.values(OUTCOMES).map((o) => o.reason), STOPPED_NO_REASON, "Made progress"];
  for (const p of prefixes) {
    if (r === p) return null;
    if (r.startsWith(`${p}: `)) return r.slice(p.length + 2).trim() || null;
  }
  return r;
}

export function dayBars(dates: string[], blocks: WeekBlock[], today: string): DayBar[] {
  return dates.map((date) => {
    const dt = DateTime.fromISO(date);
    const mine = blocks.filter((b) => b.plan_date === date);
    const bar: DayBar = {
      date,
      short: dt.toFormat("ccc"),
      long: dt.toFormat("cccc"),
      letter: dt.toFormat("ccccc"),
      isToday: date === today,
      planned: 0,
      done: 0,
      partial: 0,
      rest: 0,
      outside: { interrupted: 0, missingInfo: 0, estimate: 0, notes: [] },
      skipped: 0,
      unmarked: 0,
      kind: "none",
    };
    for (const b of mine) {
      const m = minutesOf(b);
      const cat = blockCategory(b);
      if (cat === "rest") {
        bar.rest += m;
        continue;
      }
      bar.planned += m;
      if (cat === "done") bar.done += m;
      else if (cat === "partial") bar.partial += m;
      else if (cat === "avoided" || cat === "missed") bar.skipped++;
      else if (cat === "unmarked") bar.unmarked++;
      else {
        if (cat === "interrupted") bar.outside.interrupted++;
        if (cat === "missing_info") bar.outside.missingInfo++;
        if (cat === "estimate") bar.outside.estimate++;
        const note = reasonNote(b.outcome_reason);
        if (note && !bar.outside.notes.includes(note)) bar.outside.notes.push(note);
      }
    }
    bar.kind = bar.planned === 0 ? (bar.rest > 0 ? "rest" : "none") : bar.skipped > 0 ? "short" : "ok";
    return bar;
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function outsideWords(o: DayBar["outside"]): string {
  const bits = [];
  if (o.interrupted) bits.push(`${plural(o.interrupted, "block")} interrupted`);
  if (o.missingInfo) bits.push(`${plural(o.missingInfo, "block")} blocked on missing information`);
  if (o.estimate) bits.push(`${plural(o.estimate, "block")} that ran over the estimate`);
  return bits.join(", ");
}

const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * One paragraph about the week, built only from the bars (and the disruption
 * reports per day). Sentences appear only when the data supports them.
 */
export function readWeek(bars: DayBar[], disruptionsByDay: Record<string, Record<string, number>>): string[] {
  const out: string[] = [];
  const worked = bars.filter((b) => b.planned > 0);
  if (!worked.length) {
    const rest = bars.filter((b) => b.kind === "rest");
    out.push(rest.length ? `No work was planned in blocks this week, only rest (${listWords(rest.map((b) => b.long))}).` : "Nothing was planned in blocks this week, so there's nothing to compare yet.");
    return out;
  }
  const best = [...worked].filter((b) => b.done > 0).sort((a, b) => b.done - a.done || (b.done / b.planned) - (a.done / a.planned))[0];
  if (best) out.push(`${best.long}${best.isToday ? " (today)" : ""} was your best day: ${hm(best.done)} done${best.done < best.planned ? ` of ${hm(best.planned)} planned` : ", everything you planned"}.`);
  for (const b of bars.filter((x) => x.kind === "short")) {
    out.push(`${b.long} fell short: ${plural(b.skipped, "block")} skipped without an outside reason${b.done ? `, ${hm(b.done)} of ${hm(b.planned)} done` : ""}.`);
  }
  for (const b of bars) {
    const outside = outsideWords(b.outside);
    const dis = describeDisruptions(disruptionsByDay[b.date] ?? {});
    if (!outside && !dis) continue;
    const notes = b.outside.notes.slice(0, 2).map((n) => `“${n}”`);
    const why = [outside, dis ? `the plan broke (${dis})` : ""].filter(Boolean).join("; ");
    out.push(`On ${b.long}, ${why}${notes.length ? `: ${notes.join(", ")}` : ""}. That isn't counted against you.`);
  }
  const rest = bars.filter((b) => b.kind === "rest");
  if (rest.length) out.push(`${listWords(rest.map((b) => b.long))} ${rest.length === 1 ? "was" : "were"} rest you chose, which never counts against you.`);
  const open = bars.filter((b) => b.unmarked > 0 && !b.isToday);
  if (open.length) out.push(`${listWords(open.map((b) => b.long))} still ${open.reduce((s, b) => s + b.unmarked, 0) === 1 ? "has a block" : "have blocks"} nobody marked, so ${open.length === 1 ? "that day" : "those days"} may look worse than ${open.length === 1 ? "it was" : "they were"}.`);
  return out;
}

/** Plain sentence for screen readers describing every bar. */
export function chartLabel(bars: DayBar[]): string {
  const days = bars.map((b) => {
    if (b.kind === "none") return `${b.long}: nothing planned`;
    if (b.kind === "rest") return `${b.long}: rest day`;
    return `${b.long}: ${hmLong(b.done)} done of ${hmLong(b.planned)} planned${b.partial ? `, plus ${hmLong(b.partial)} partly done` : ""}${b.kind === "short" ? ", fell short" : ""}${b.isToday ? ", today so far" : ""}`;
  });
  return `Planned versus done by day. ${days.join("; ")}.`;
}

export type Noticed = { key: string; text: string; action?: "plan-week" | "tasks" | "projects" };

type NoticeInput = {
  enoughData: boolean;
  repeatedlyAvoided: { task_id: string; title: string; times: number }[];
  interruptionsByPart: { part: string; count: number }[];
  estimate: { samples: number; medianRatio: number | null };
  lateCompletions: number;
  overran: number;
  progress: { kind: string; name: string; completed: number; open: number }[];
  nextWeek: { loadMinutes: number; freeMinutes: number; overloaded: boolean; deadlines: { due_is_hard: boolean }[] };
};

/** What Navi noticed, most actionable first. Thresholds match the weekly review's own. */
export function noticed(w: NoticeInput, current: boolean, partHours: Record<string, string>, interruptionsAt: number): Noticed[] {
  const out: Noticed[] = [];
  for (const r of w.repeatedlyAvoided.slice(0, 2)) {
    out.push({ key: `avoid-${r.task_id}`, text: `“${r.title}” got skipped ${r.times} times in the last 3 weeks without an outside reason. A smaller first step, a different time, or dropping it are all fair answers.`, action: "tasks" });
  }
  if (current && w.nextWeek.overloaded) {
    const hard = w.nextWeek.deadlines.filter((d) => d.due_is_hard).length;
    out.push({ key: "overloaded", text: `The next 7 days need about ${hm(w.nextWeek.loadMinutes)} of work${hard ? ` (with ${plural(hard, "hard deadline")})` : ""}, but you have about ${hm(w.nextWeek.freeMinutes)} free. Better to drop, defer or renegotiate something now than at the deadline.`, action: "plan-week" });
  }
  if (w.enoughData) {
    const ip = w.interruptionsByPart.find((x) => x.count >= interruptionsAt);
    if (ip) out.push({ key: "interruptions", text: `Interruptions cluster in the ${ip.part} (${partHours[ip.part] ?? ""}): ${ip.count} interrupted blocks in 3 weeks. Plan lighter or leave more buffer then.`, action: current ? "plan-week" : undefined });
  }
  const r = w.estimate.medianRatio;
  if (r !== null && r > 1.25) out.push({ key: "estimate", text: `Tasks take about ${r.toFixed(1)}× your estimates (${plural(w.estimate.samples, "finished task")}). Navi already pads future plans to match.` });
  if (r !== null && r < 0.8) out.push({ key: "estimate-fast", text: `You finish tasks faster than you estimate: about ${r.toFixed(1)}× (${plural(w.estimate.samples, "finished task")}).` });
  if (w.overran >= 3) out.push({ key: "overran", text: `${w.overran} blocks this week didn't get done because the work took longer than estimated. That's the plan's fault, not yours: bigger estimates or fewer blocks a day.`, action: current ? "plan-week" : undefined });
  if (w.lateCompletions > 0) out.push({ key: "late", text: `${plural(w.lateCompletions, "task was", "tasks were")} finished after the deadline this week.` });
  const stalled = w.progress.filter((p) => p.completed === 0 && p.open > 0);
  if (stalled.length) out.push({ key: "stalled", text: `Nothing finished this week for ${listWords(stalled.slice(0, 3).map((p) => `“${p.name}”`))}.`, action: "projects" });
  return out;
}

export type Learning = { id: string; content: string; sure: "confirmed" | "fairly" | "checking"; evidence: string };

type MemoryRow = { id: string; content: string; origin: string; confidence: number; evidence: unknown; last_confirmed_at: string | null };

/** Behavioural memories as "what Navi is learning": how sure, and on how much evidence. */
export function learnings(rows: MemoryRow[]): Learning[] {
  return rows.map((m) => {
    const entries = (Array.isArray(m.evidence) ? m.evidence : []).filter((e): e is { week_end?: string; supports?: boolean } => !!e && typeof e === "object");
    const weeks = new Set(entries.filter((e) => e.supports !== false && e.week_end).map((e) => e.week_end)).size;
    const told = m.origin === "stated" || !!m.last_confirmed_at;
    const sure = told ? "confirmed" : m.confidence >= 0.7 ? "fairly" : "checking";
    const evidence = told ? (m.origin === "stated" ? "You told Navi" : "You confirmed this") : weeks ? `${plural(weeks, "week")} of evidence` : m.origin === "inferred" ? "Navi's guess from your conversations" : "Seen in your activity";
    return { id: m.id, content: m.content, sure, evidence };
  });
}
