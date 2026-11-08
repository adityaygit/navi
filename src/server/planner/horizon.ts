import { DateTime } from "luxon";
import type { Task } from "@/lib/types";
import type { SchedulerV2Output } from "./scheduler-v2";
import type { DayModel } from "./day-model";

// When the plan can't hold everything: which must-complete or hard-deadline
// work can't be done in time, the concrete tradeoffs (at most three, from a
// fixed list, least harmful first), and the one question that would help.
// Never drops, deletes or completes anything; it only suggests. Pure.

export type Shortfall = { task_id: string; title: string; due_at: string | null; short_minutes: number; hard: boolean };

/**
 * Earliest-deadline-first check: for each must/hard task still short today,
 * is there enough free time on the following days before its deadline?
 * `laterCapacity` = free minutes per later date (already net of work planned there).
 */
export function shortfalls(
  out: Pick<SchedulerV2Output, "unscheduled" | "mustTaskIds">,
  tasks: Pick<Task, "id" | "title" | "due_at" | "due_is_hard">[],
  date: string,
  zone: string,
  laterCapacity: { date: string; minutes: number }[],
): Shortfall[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const short = out.unscheduled
    .filter((u) => out.mustTaskIds.includes(u.task_id))
    .map((u) => ({ u, t: byId.get(u.task_id) }))
    .filter((x) => x.t)
    .sort((a, b) => (a.t!.due_at ?? "9999").localeCompare(b.t!.due_at ?? "9999"));
  const pool = laterCapacity.map((c) => ({ ...c }));
  const result: Shortfall[] = [];
  for (const { u, t } of short) {
    const dueDate = t!.due_at ? DateTime.fromISO(t!.due_at).setZone(zone).toISODate()! : null;
    let need = u.remaining_minutes;
    if (dueDate && dueDate > date) {
      for (const c of pool) {
        if (c.date > dueDate || need <= 0) continue;
        const take = Math.min(c.minutes, need);
        c.minutes -= take;
        need -= take;
      }
    } else if (!dueDate) {
      need = 0; // no deadline: it can wait for a later day
    }
    if (need > 0) result.push({ task_id: t!.id, title: t!.title, due_at: t!.due_at, short_minutes: need, hard: t!.due_is_hard });
  }
  return result;
}

/** Up to three concrete options, least harmful first. */
export function tradeoffs(
  short: Shortfall[],
  out: Pick<SchedulerV2Output, "blocks" | "heldBackMinutes" | "mustTaskIds">,
  model: Pick<DayModel, "unknown">,
  zone: string,
  titles: Map<string, { title: string; commitment?: string | null }>,
): string[] {
  if (!short.length) return [];
  const s = short[0];
  const fmt = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("h:mm a");
  const options: string[] = [];
  // 1. Move flexible work off today.
  const movable = new Map<string, number>();
  for (const b of out.blocks) {
    if (!b.task_id || out.mustTaskIds.includes(b.task_id)) continue;
    movable.set(b.task_id, (movable.get(b.task_id) ?? 0) + DateTime.fromISO(b.ends_at).diff(DateTime.fromISO(b.starts_at), "minutes").minutes);
  }
  const ranked = [...movable.entries()].sort((a, b) => (titles.get(a[0])?.commitment === "optional" ? -1 : 0) - (titles.get(b[0])?.commitment === "optional" ? -1 : 0) || b[1] - a[1]);
  if (ranked.length) {
    const picks: string[] = [];
    let freed = 0;
    for (const [id, m] of ranked) {
      if (freed >= s.short_minutes) break;
      picks.push(`“${titles.get(id)?.title ?? "it"}” (${Math.round(m)} min)`);
      freed += m;
    }
    options.push(`Push ${picks.join(" and ")} to another day to make room for “${s.title}”.`);
  }
  // 2. Use the time held back so the day wasn't packed.
  if (out.heldBackMinutes >= Math.min(30, s.short_minutes)) {
    options.push(`Use the ${out.heldBackMinutes} minutes I left open today for “${s.title}”.`);
  }
  // 3. Ask about time Navi doesn't know about.
  const unknown = [...model.unknown].sort((a, b) => Date.parse(b.ends_at) - Date.parse(b.starts_at) - (Date.parse(a.ends_at) - Date.parse(a.starts_at)))[0];
  if (unknown) options.push(`Tell me if you're free ${fmt(unknown.starts_at)}–${fmt(unknown.ends_at)}; I didn't plan there because I don't know your ${unknown.label}.`);
  // 4. Do part now (when the deadline allows), or ask for more time.
  if (s.hard) options.push(`Ask for an extension on “${s.title}” (I'll only change the deadline if you approve).`);
  else options.push(`Move “${s.title}”'s due date (it isn't a hard deadline).`);
  return options.slice(0, 3);
}

/** One question that would most help, or null. */
export function clarificationFor(short: Shortfall[], model: Pick<DayModel, "unknown" | "clarification" | "date">, zone: string): string | null {
  if (model.clarification) return model.clarification;
  if (!short.length || !model.unknown.length) return null;
  const u = [...model.unknown].sort((a, b) => Date.parse(b.ends_at) - Date.parse(b.starts_at) - (Date.parse(a.ends_at) - Date.parse(a.starts_at)))[0];
  const fmt = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("h:mm a");
  return `Are you free between ${fmt(u.starts_at)} and ${fmt(u.ends_at)} on ${DateTime.fromISO(model.date, { zone }).toFormat("cccc")}? That would make room for “${short[0].title}”.`;
}
