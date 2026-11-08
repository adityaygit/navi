import { DateTime } from "luxon";
import type { StepView } from "./tool-events";
import { clockFor, dayWord, q, shortTitle, things } from "./plain-text";

// What a planning run did, in two forms. `summarizeDayPlan` /
// `summarizeWeekPlan`: exact and complete, for the model (it lists what
// didn't fit so Navi can talk about it). `planView`: what the person sees in
// the chat and after a planning button: one short line, the changes behind a
// disclosure, and what didn't fit as a count with a few options. Pure:
// unit-tested and shared by the UI actions and the AI tools.

export type PlanLike = {
  date: string;
  blocks: { task_id: string | null; title?: string; starts_at?: string }[];
  moved: number;
  unscheduled: { task_id: string; title: string; remaining_minutes: number; why?: string }[];
  afterDeadline: { task_id: string; title: string; due_at: string }[];
  warnings: string[];
  // Planner v2 only (absent from the old planner):
  proposed?: boolean;
  assumptions?: string[];
  conflicts?: string[];
  tradeoffs?: string[];
  clarification?: string | null;
  unplacedRoutines?: { title: string; why: string }[];
  blockedTasks?: { title: string }[];
  waiting?: { title: string; why: string }[];
};

/** One change a planning run made, for the disclosure under its chat card. */
export type PlanChange = { kind: "add" | "move" | "remove" | "mark"; title: string; at?: string; from?: string; status?: string };

const HELD = "Kept free so the day isn't packed";

/** Planner v2's extra lines: conflicts, assumptions, what's waiting, options and the one question. */
function v2Lines(r: PlanLike): string[] {
  const out: string[] = [];
  if (r.conflicts?.length) out.push(...r.conflicts);
  if (r.assumptions?.length) out.push(`${r.assumptions.join(" ")} Tell me if that's wrong.`);
  if (r.unplacedRoutines?.length) out.push(`Couldn't fit: ${r.unplacedRoutines.map((u) => `“${u.title}” (${u.why.charAt(0).toLowerCase()}${u.why.slice(1)})`).join(", ")}.`);
  if (r.blockedTasks?.length) out.push(`Blocked, so not planned: ${list(r.blockedTasks.map((b) => `“${b.title}”`))}.`);
  if (r.waiting?.length) out.push(`Waiting: ${list(r.waiting.map((w) => `“${w.title}” (${w.why})`))}.`);
  if (r.tradeoffs?.length) out.push(`Options: ${r.tradeoffs.map((t, i) => `${i + 1}) ${t}`).join(" ")}`);
  if (r.clarification) out.push(r.clarification);
  return out;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (items: string[], max = 4) =>
  items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");
const leftover = (u: PlanLike["unscheduled"]) => list(u.map((x) => `“${x.title}” (${x.remaining_minutes} min left)`));

/** Warnings already said another way (after-deadline list) aren't repeated. */
const covered = (w: string) => /only fits after it's due/.test(w);
const NO_TIME = /no free time set for this day/i;

function dueText(iso: string, zone: string) {
  return DateTime.fromISO(iso).setZone(zone).toFormat("ccc h:mm a");
}

/** Work that didn't fit (not what was kept free on purpose or is waiting on something). */
function notFitted(r: PlanLike) {
  return r.unscheduled.filter((u) => u.why !== HELD && !r.waiting?.some((w) => w.title === u.title));
}

export function summarizeDayPlan(r: PlanLike, zone: string): string {
  const parts: string[] = [];
  const day = DateTime.fromISO(r.date, { zone }).toFormat("ccc LLL d");
  parts.push(r.blocks.length ? `${day}: planned ${count(r.blocks.length, "thing")}${r.moved ? ` (${r.moved} moved)` : ""}.` : `${day}: nothing new planned.`);
  const held = r.unscheduled.filter((u) => u.why === HELD);
  const notFit = notFitted(r);
  if (notFit.length) parts.push(`Didn't fit: ${leftover(notFit)}. ${notFit.length === 1 ? "It stays" : "They stay"} on your task list.`);
  if (held.length) parts.push(`Left for another day so today isn't packed: ${leftover(held)}.`);
  if (r.afterDeadline.length) parts.push(`Only fits after it's due: ${r.afterDeadline.map((a) => `“${a.title}” (due ${dueText(a.due_at, zone)})`).join(", ")}.`);
  parts.push(...[...new Set(r.warnings.filter((w) => !covered(w) && w !== r.clarification))]);
  parts.push(...v2Lines(r));
  return `${r.proposed ? "Proposed, nothing changed yet. " : ""}${parts.join(" ")}`;
}

export function summarizeWeekPlan(rs: PlanLike[], zone: string): string {
  if (rs.length === 0) return "Nothing planned.";
  const placed = rs.reduce((s, r) => s + r.blocks.length, 0);
  const moved = rs.reduce((s, r) => s + r.moved, 0);
  const first = DateTime.fromISO(rs[0].date, { zone }).toFormat("ccc LLL d");
  const last = DateTime.fromISO(rs[rs.length - 1].date, { zone }).toFormat("ccc LLL d");
  const parts = [`${first}–${last}: planned ${count(placed, "thing")}${moved ? ` (${moved} moved)` : ""}.`];
  // Work left over on the last day didn't fit anywhere in the range.
  const left = rs[rs.length - 1].unscheduled;
  if (left.length) parts.push(`Didn't fit in these ${rs.length} days: ${leftover(left)}. ${left.length === 1 ? "It stays" : "They stay"} on your task list.`);
  const late = new Map<string, PlanLike["afterDeadline"][number]>();
  for (const r of rs) for (const a of r.afterDeadline) if (!late.has(a.task_id)) late.set(a.task_id, a);
  if (late.size) parts.push(`Only fits after it's due: ${[...late.values()].map((a) => `“${a.title}” (due ${dueText(a.due_at, zone)})`).join(", ")}.`);
  const noTime = rs.filter((r) => r.warnings.some((w) => NO_TIME.test(w))).map((r) => DateTime.fromISO(r.date, { zone }).toFormat("ccc"));
  if (noTime.length) parts.push(`No free time set on ${noTime.join(", ")}.`);
  const clarifications = new Set(rs.map((r) => r.clarification).filter(Boolean));
  const other = new Set(rs.flatMap((r) => r.warnings).filter((w) => !covered(w) && !NO_TIME.test(w) && !clarifications.has(w)));
  parts.push(...other);
  const assumedDays = rs.filter((r) => r.assumptions?.length).length;
  if (assumedDays) parts.push(`On ${count(assumedDays, "day")} I planned in time I assumed is free (shown on My day); tell me if any of it isn't.`);
  parts.push(...new Set(rs.flatMap((r) => r.conflicts ?? [])));
  const firstShort = rs.find((r) => r.tradeoffs?.length);
  if (firstShort) parts.push(`${DateTime.fromISO(firstShort.date, { zone }).toFormat("cccc")}: options: ${firstShort.tradeoffs!.map((t, i) => `${i + 1}) ${t}`).join(" ")}`);
  const ask = rs.find((r) => r.clarification)?.clarification;
  if (ask) parts.push(ask);
  return `${rs.some((r) => r.proposed) ? "Proposed, nothing changed yet. " : ""}${parts.join(" ")}`;
}

/** A change as one plain line (clock times are fine here: it sits behind the disclosure). */
export function changeLine(c: PlanChange, zone: string, day?: string): string {
  const t = shortTitle(c.title);
  const at = c.at ? clockFor(c.at, zone, day) : "";
  if (c.kind === "move") return `${t} → ${at}`;
  if (c.kind === "add") return at ? `${t} at ${at}` : t;
  if (c.kind === "remove") return `${t}: taken off for now (still on your list)`;
  const word = c.status === "interrupted" ? "set aside" : c.status === "rest" ? "rest" : c.status === "skipped" ? "skipped" : (c.status ?? "updated");
  return `${t}: ${word}`;
}

/** Option text with its titles shortened, e.g. "Push “Reading” (30 min) to another day…". */
function plainOption(text: string): string {
  return text.replace(/“([^”]*)”/g, (_, t: string) => q(t, 30));
}

/**
 * What a planning run looks like in the chat: "Planned tonight: 6 things",
 * its changes behind the disclosure, and "13 things didn't fit tonight" with
 * up to three options. `changes` (planner v2 change sets) say exactly what
 * moved; without them the placed work is listed.
 */
export function planView(rs: PlanLike[], zone: string, opts: { now?: DateTime; changes?: PlanChange[]; recovered?: boolean; unchanged?: boolean } = {}): StepView {
  const now = opts.now ?? DateTime.now();
  if (!rs.length) return { display: "Nothing to plan", plan: true, unchanged: true };
  const one = rs.length === 1;
  const when = one ? dayWord(rs[0].date, zone, now) : "this week";
  const total = rs.reduce((s, r) => s + r.blocks.length, 0);
  const display = opts.recovered
    ? "Reworked the rest of today"
    : opts.unchanged
      ? "Your plan already works; nothing changed"
      : one
        ? total
          ? `Planned ${when}: ${things(total)}`
          : `Nothing new to plan ${when}`
        : `Planned the next ${rs.length} days: ${things(total)}`;

  const firstDay = rs[0].date;
  const detail = opts.changes
    ? opts.changes.map((c) => changeLine(c, zone, one ? firstDay : undefined))
    : rs.flatMap((r) => r.blocks.filter((b) => b.title && b.starts_at).map((b) => changeLine({ kind: "add", title: b.title!, at: b.starts_at }, zone, one ? firstDay : undefined)));
  for (const r of rs) for (const a of r.assumptions ?? []) detail.push(a);

  // What didn't fit: a count, never the whole list.
  const notFit = one ? notFitted(rs[0]) : notFitted(rs[rs.length - 1]);
  const late = [...new Map(rs.flatMap((r) => r.afterDeadline).map((a) => [a.task_id, a])).values()];
  let left: StepView["leftover"];
  if (notFit.length || late.length) {
    const line = notFit.length ? `${things(notFit.length)} didn't fit ${when}` : `${things(late.length)} only fit${late.length === 1 ? "s" : ""} after ${late.length === 1 ? "it's" : "they're"} due`;
    const names = (notFit.length ? notFit : late).map((u) => q(u.title, 30));
    const options = [
      `${names.length > 3 ? `Includes ${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ")}. ${notFit.length === 1 ? "It stays" : "They stay"} on your list; nothing was dropped.`,
      ...(rs.find((r) => r.tradeoffs?.length)?.tradeoffs ?? []).slice(0, 2).map(plainOption),
    ];
    if (options.length === 1) options.push("Tell me what can wait, or move a due date, and I'll re-plan.");
    left = { line, options };
  }
  return { display, detail, plan: true, ...(left ? { leftover: left } : {}), ...(opts.unchanged ? { unchanged: true } : {}) };
}

/** The view as one sentence, for planning buttons outside the chat. */
export function planMessage(view: StepView): string {
  return [view.display, view.leftover?.line].filter(Boolean).join(". ") + ".";
}
