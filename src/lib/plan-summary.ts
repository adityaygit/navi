import { DateTime } from "luxon";

// Plain-language summary of a planning run, shown after "Re-plan today",
// "Plan this day" and "Plan next 7 days" so notable changes are explained
// (what was placed, what moved, what didn't fit, what only fits after its
// deadline). Pure: unit-tested and shared by the UI actions and the AI tools.

export type PlanLike = {
  date: string;
  blocks: { task_id: string | null }[];
  moved: number;
  unscheduled: { task_id: string; title: string; remaining_minutes: number; why?: string }[];
  afterDeadline: { task_id: string; title: string; due_at: string }[];
  warnings: string[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (items: string[], max = 4) =>
  items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");
const leftover = (u: PlanLike["unscheduled"]) => list(u.map((x) => `“${x.title}” (${x.remaining_minutes} min left)`));

/** Warnings already said another way (after-deadline list) aren't repeated. */
const covered = (w: string) => /can only be scheduled after its deadline/.test(w);

function dueText(iso: string, zone: string) {
  return DateTime.fromISO(iso).setZone(zone).toFormat("ccc h:mm a");
}

export function summarizeDayPlan(r: PlanLike, zone: string): string {
  const parts: string[] = [];
  const day = DateTime.fromISO(r.date, { zone }).toFormat("ccc LLL d");
  parts.push(r.blocks.length ? `${day}: placed ${plural(r.blocks.length, "block")}${r.moved ? ` (${r.moved} moved)` : ""}.` : `${day}: no flexible blocks placed.`);
  if (r.unscheduled.length) parts.push(`Didn't fit: ${leftover(r.unscheduled)}. ${r.unscheduled.length === 1 ? "It stays" : "They stay"} on your task list.`);
  if (r.afterDeadline.length) parts.push(`Only fits after its deadline: ${r.afterDeadline.map((a) => `“${a.title}” (due ${dueText(a.due_at, zone)})`).join(", ")}.`);
  parts.push(...[...new Set(r.warnings.filter((w) => !covered(w)))]);
  return parts.join(" ");
}

export function summarizeWeekPlan(rs: PlanLike[], zone: string): string {
  if (rs.length === 0) return "Nothing planned.";
  const placed = rs.reduce((s, r) => s + r.blocks.length, 0);
  const moved = rs.reduce((s, r) => s + r.moved, 0);
  const first = DateTime.fromISO(rs[0].date, { zone }).toFormat("ccc LLL d");
  const last = DateTime.fromISO(rs[rs.length - 1].date, { zone }).toFormat("ccc LLL d");
  const parts = [`${first}–${last}: placed ${plural(placed, "block")}${moved ? ` (${moved} moved)` : ""}.`];
  // Work left over on the last day didn't fit anywhere in the range.
  const left = rs[rs.length - 1].unscheduled;
  if (left.length) parts.push(`Didn't fit in these ${rs.length} days: ${leftover(left)}. ${left.length === 1 ? "It stays" : "They stay"} on your task list.`);
  const late = new Map<string, PlanLike["afterDeadline"][number]>();
  for (const r of rs) for (const a of r.afterDeadline) if (!late.has(a.task_id)) late.set(a.task_id, a);
  if (late.size) parts.push(`Only fits after its deadline: ${[...late.values()].map((a) => `“${a.title}” (due ${dueText(a.due_at, zone)})`).join(", ")}.`);
  const noTime = rs.filter((r) => r.warnings.some((w) => /no availability on this day/i.test(w))).map((r) => DateTime.fromISO(r.date, { zone }).toFormat("ccc"));
  if (noTime.length) parts.push(`No availability on ${noTime.join(", ")}.`);
  const other = new Set(rs.flatMap((r) => r.warnings).filter((w) => !covered(w) && !/no availability on this day/i.test(w)));
  parts.push(...other);
  return parts.join(" ");
}
