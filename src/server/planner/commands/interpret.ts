import "server-only";
import { randomUUID } from "node:crypto";
import { DateTime, Interval } from "luxon";
import type { Ctx } from "@/server/context";
import type { DayScopeMode, PlanBlock, Profile, Task } from "@/lib/types";
import { nowIn } from "@/lib/time";
import { resolveClock } from "@/lib/time-words";
import { awakeSpan } from "@/server/day";
import { fixedSpans } from "../clash";
import { blockFields, placeOf, type BlockPlace, type InsertBlock, type Op, type PlanOptions } from "../plan-v2";
import type { FixedSpan } from "./impact";
import type { Postcondition } from "./verify";
import type { Command } from "./types";

// Interpret: turn one command into the exact changes it makes (ops on
// specific blocks, the day's scope, one-day facts) and the conditions that
// must hold once it's saved. Nothing is written here. A request that can't be
// done as asked (task finished, block already started, a time that isn't
// real) comes back as `infeasible` with the reason and, where useful, free
// times that would work.

export type Interpreted = {
  dates: string[];
  ops: Op[];
  post: Postcondition[];
  targets: { blockIds: string[]; taskIds: string[]; removes: boolean };
  /** Ids of blocks the command places or moves (checked against fixed things). */
  placed: string[];
  /** Fixed things on these dates the command's placements must not overlap. */
  fixed: FixedSpan[];
  plan: Partial<PlanOptions>;
  /** What happened, in words, for the reply. */
  what: string;
  /** Deferrals/removals of specific tasks (accountability looks at these). */
  defers: { task_id: string; title: string; decision: "postpone" | "unschedule" | "exclude" }[];
};
export type Infeasible = { infeasible: string; alternatives: string[] };

const OPEN = ["planned", "in_progress"];

function q(t: string) {
  return `“${t.length > 60 ? `${t.slice(0, 57)}…` : t}”`;
}

export class CommandInputError extends Error {}

/** A start the person gave: local HH:MM (or "now") on a date, or an ISO date-time. */
export function resolveStart(start: string, date: string | null | undefined, zone: string): DateTime {
  const now = nowIn(zone);
  const day = !date || date === "today" ? now.toISODate()! : date === "tomorrow" ? now.plus({ days: 1 }).toISODate()! : date;
  const clock = resolveClock(start, day, zone, now);
  const d = clock ?? DateTime.fromISO(start, { setZone: true }).setZone(zone);
  if (!d.isValid) throw new CommandInputError(`Not a time Navi understands: “${start}”. Use HH:MM, 'now', or an ISO date-time.`);
  return d.set({ second: 0, millisecond: 0 });
}

export function resolveDay(date: string | null | undefined, zone: string): string {
  const now = nowIn(zone);
  if (!date || date === "today") return now.toISODate()!;
  if (date === "tomorrow") return now.plus({ days: 1 }).toISODate()!;
  if (!DateTime.fromISO(date, { zone }).isValid) throw new CommandInputError(`Not a valid date: ${date}`);
  return date;
}

async function task(ctx: Ctx, id: string): Promise<Task> {
  const { data, error } = await ctx.db.from("tasks").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CommandInputError("That task doesn't exist (or isn't yours).");
  return data as Task;
}
async function block(ctx: Ctx, id: string): Promise<PlanBlock> {
  const { data, error } = await ctx.db.from("plan_blocks").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CommandInputError("That planned block doesn't exist (or isn't yours).");
  return data as PlanBlock;
}
async function sessionOf(ctx: Ctx, b: PlanBlock): Promise<PlanBlock[]> {
  if (!b.session_id) return [b];
  const { data } = await ctx.db.from("plan_blocks").select("*").eq("session_id", b.session_id).in("status", OPEN).order("starts_at");
  return ((data ?? []) as PlanBlock[]).length ? (data as PlanBlock[]) : [b];
}
async function scopeMode(ctx: Ctx, date: string, taskId: string): Promise<DayScopeMode | null> {
  const { data } = await ctx.db.from("day_plan_scope").select("mode").eq("date", date).eq("task_id", taskId).maybeSingle();
  return (data?.mode as DayScopeMode | undefined) ?? null;
}
async function openBlocksOf(ctx: Ctx, taskId: string, date: string): Promise<PlanBlock[]> {
  const { data } = await ctx.db.from("plan_blocks").select("*").eq("task_id", taskId).eq("plan_date", date).in("status", OPEN);
  return (data ?? []) as PlanBlock[];
}

/** Up to three start times on a date with `minutes` free around fixed things, from now on. */
export function freeStarts(fixed: FixedSpan[], date: string, minutes: number, zone: string, profile: Pick<Profile, "preferences">): string[] {
  const awake = awakeSpan(profile, date, zone);
  const now = nowIn(zone);
  let from: DateTime = awake ? DateTime.fromMillis(awake.start, { zone }) : DateTime.fromISO(date, { zone }).set({ hour: 7 });
  const end: DateTime = awake ? DateTime.fromMillis(awake.end, { zone }) : DateTime.fromISO(date, { zone }).set({ hour: 23 });
  if (now > from) from = now.plus({ minutes: 5 - (now.minute % 5) }).startOf("minute");
  const busy = fixed.map((f) => Interval.fromDateTimes(f.start.minus({ minutes: 10 }), f.end.plus({ minutes: 10 }))).filter((i) => i.isValid);
  let gaps = [Interval.fromDateTimes(from, end)];
  for (const b of busy) gaps = gaps.flatMap((g) => g.difference(b));
  return gaps.filter((g) => g.isValid && g.length("minutes") >= minutes).slice(0, 3).map((g) => g.start!.setZone(zone).toFormat("h:mm a"));
}

/** Fixed things on a date, minus blocks this command moves or removes. */
async function fixedOn(ctx: Ctx, dates: string[], except: Set<string>): Promise<FixedSpan[]> {
  const all = await Promise.all(dates.map((d) => fixedSpans(ctx, d)));
  return all.flat().filter((f) => !f.blockId || !except.has(f.blockId));
}

function newBlock(ctx: Ctx, t: { id: string; title: string }, start: DateTime, end: DateTime, extra: Partial<InsertBlock> = {}): InsertBlock {
  const mine = ctx.actor === "user";
  return {
    id: randomUUID(), task_id: t.id, routine_id: null, title: t.title, plan_date: start.toISODate()!,
    starts_at: start.toUTC().toISO()!, ends_at: end.toUTC().toISO()!, reason: mine ? "You put it here." : "You asked for it here.",
    basis: null, assumption: null, pinned: true, placement: mine ? "manual" : "requested", created_by: mine ? "user" : "navi", is_flexible: true,
    session_id: null, session_title: null, ...extra,
  };
}

function moveOp(b: PlanBlock, after: Partial<BlockPlace>, ctx: Ctx): Op {
  const before = placeOf(b);
  const placement = after.placement ?? (b.placement === "manual" || b.created_by === "user" ? "manual" : ctx.actor === "user" ? "manual" : "requested");
  return { op: "move", id: b.id, title: b.title, before, after: { ...before, ...after, placement, reason: after.reason ?? before.reason } };
}

/** Scope op for one task on one date (nothing if it's already that). */
async function scopeOp(ctx: Ctx, date: string, t: { id: string; title: string }, mode: DayScopeMode | null): Promise<Op[]> {
  const before = await scopeMode(ctx, date, t.id);
  return before === mode ? [] : [{ op: "scope", date, task_id: t.id, title: t.title, before, after: mode }];
}

const minutesOf = (b: { starts_at: string; ends_at: string }) => Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000);
const defaultMinutes = (t: Task) => Math.max(5, Math.min(480, Math.max(0, (t.estimate_minutes ?? 30) - (t.actual_minutes ?? 0)) || 30));

export async function interpret(ctx: Ctx, cmd: Command, profile: Profile): Promise<Interpreted | Infeasible> {
  const zone = profile.timezone;
  const needOpenTask = (t: Task) => {
    if (t.status === "done" || t.status === "cancelled") throw new CommandInputError(`${q(t.title)} is already ${t.status === "done" ? "finished" : "cancelled"}, so there's nothing to plan.`);
  };
  const needOpenBlock = (b: PlanBlock) => {
    if (b.status !== "planned") throw new CommandInputError(`${q(b.title)} is already ${b.status === "in_progress" ? "started" : `marked ${b.status}`}, so it stays as it is.`);
  };
  const out = (x: Omit<Interpreted, "fixed"> & { fixedExcept?: string[] }): Promise<Interpreted> =>
    fixedOn(ctx, x.dates, new Set(x.fixedExcept ?? [])).then((fixed) => ({ ...x, fixed }));

  switch (cmd.kind) {
    case "schedule_task": {
      const t = await task(ctx, cmd.task_id);
      needOpenTask(t);
      const start = resolveStart(cmd.start, cmd.date, zone);
      const mins = cmd.minutes ?? defaultMinutes(t);
      const b = newBlock(ctx, t, start, start.plus({ minutes: mins }));
      const date = b.plan_date;
      // An explicit request overrides "keep it off this day".
      const scope = (await scopeMode(ctx, date, t.id)) === "exclude" ? await scopeOp(ctx, date, t, "include") : [];
      return out({
        dates: [date], ops: [...scope, { op: "insert", block: b }],
        post: [{ kind: "task_at", task_id: t.id, title: t.title, starts_at: b.starts_at, ends_at: b.ends_at }, { kind: "task_open", task_id: t.id, title: t.title }],
        targets: { blockIds: [], taskIds: [t.id], removes: false }, placed: [b.id], plan: {},
        what: `Put ${q(t.title)} at ${start.toFormat("h:mm a")}`, defers: [],
      });
    }
    case "move_block": {
      const b = await block(ctx, cmd.block_id);
      needOpenBlock(b);
      const blocks = await sessionOf(ctx, b);
      const start = resolveStart(cmd.start, cmd.date ?? b.plan_date, zone);
      const delta = start.toMillis() - Date.parse(b.starts_at);
      const ops = blocks.map((x) => {
        const s = DateTime.fromMillis(Date.parse(x.starts_at) + delta).setZone(zone);
        return moveOp(x, { starts_at: s.toUTC().toISO()!, ends_at: s.plus({ minutes: minutesOf(x) }).toUTC().toISO()!, plan_date: s.toISODate()!, pinned: true }, ctx);
      });
      const dates = [...new Set([...blocks.map((x) => x.plan_date), ...ops.map((o) => (o as Extract<Op, { op: "move" }>).after.plan_date)])];
      const moved = ops as Extract<Op, { op: "move" }>[];
      return out({
        dates, ops, post: moved.map((o) => ({ kind: "block_at" as const, block_id: o.id, title: o.title, starts_at: o.after.starts_at, ends_at: o.after.ends_at })),
        targets: { blockIds: blocks.map((x) => x.id), taskIds: [], removes: false }, placed: blocks.map((x) => x.id), fixedExcept: blocks.map((x) => x.id), plan: {},
        what: `Moved ${b.session_title ? q(b.session_title) : q(b.title)} to ${start.toFormat("h:mm a")}`,
        defers: start.toISODate()! > b.plan_date && b.task_id ? [{ task_id: b.task_id, title: b.title, decision: "postpone" }] : [],
      });
    }
    case "resize_block": {
      const b = await block(ctx, cmd.block_id);
      needOpenBlock(b);
      const blocks = await sessionOf(ctx, b);
      const total = blocks.reduce((s, x) => s + minutesOf(x), 0);
      // A session resizes as a unit: each task keeps its share, back to back from the first start.
      let cursor = DateTime.fromISO(blocks[0].starts_at).setZone(zone);
      const ops = blocks.map((x, i) => {
        const share = i === blocks.length - 1 ? cmd.minutes - blocks.slice(0, -1).reduce((s, y) => s + Math.max(5, Math.round((minutesOf(y) / total) * cmd.minutes)), 0) : Math.max(5, Math.round((minutesOf(x) / total) * cmd.minutes));
        const s = cursor;
        cursor = s.plus({ minutes: Math.max(5, share) });
        return moveOp(x, { starts_at: s.toUTC().toISO()!, ends_at: cursor.toUTC().toISO()!, plan_date: s.toISODate()!, pinned: true }, ctx);
      }) as Extract<Op, { op: "move" }>[];
      return out({
        dates: [...new Set(blocks.map((x) => x.plan_date))], ops,
        post: ops.map((o) => ({ kind: "block_at" as const, block_id: o.id, title: o.title, starts_at: o.after.starts_at, ends_at: o.after.ends_at })),
        targets: { blockIds: blocks.map((x) => x.id), taskIds: [], removes: false }, placed: blocks.map((x) => x.id), fixedExcept: blocks.map((x) => x.id), plan: {},
        what: `Made ${b.session_title ? q(b.session_title) : q(b.title)} ${cmd.minutes} min`, defers: [],
      });
    }
    case "swap": {
      if (!cmd.place_task_id && !cmd.place_block_id) throw new CommandInputError("Say what to put in: place_task_id or place_block_id.");
      if (!cmd.remove_task_id && !cmd.remove_block_id) throw new CommandInputError("Say what to take off: remove_task_id or remove_block_id.");
      const removeBlock = cmd.remove_block_id ? await block(ctx, cmd.remove_block_id) : null;
      const date = removeBlock?.plan_date ?? resolveDay(cmd.date, zone);
      const removeTask = cmd.remove_task_id ? await task(ctx, cmd.remove_task_id) : removeBlock?.task_id ? await task(ctx, removeBlock.task_id) : null;
      const removing = removeBlock ? [removeBlock] : removeTask ? await openBlocksOf(ctx, removeTask.id, date) : [];
      for (const r of removing) needOpenBlock(r);
      const slot = removing.slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
      const ops: Op[] = removing.map((r) => ({ op: "remove", id: r.id, title: r.title, before: blockFields(r) }));
      if (removeTask) ops.push(...(await scopeOp(ctx, date, removeTask, "exclude")));
      const post: Postcondition[] = [];
      let placedIds: string[] = [];
      let placedTitle = "";
      let at: DateTime;
      if (cmd.place_block_id) {
        const pb = await block(ctx, cmd.place_block_id);
        needOpenBlock(pb);
        at = cmd.start ? resolveStart(cmd.start, date, zone) : slot ? DateTime.fromISO(slot.starts_at).setZone(zone) : (() => { throw new CommandInputError("Say when to put it (start)."); })();
        const mins = cmd.minutes ?? minutesOf(pb);
        const op = moveOp(pb, { starts_at: at.toUTC().toISO()!, ends_at: at.plus({ minutes: mins }).toUTC().toISO()!, plan_date: at.toISODate()!, pinned: true }, ctx) as Extract<Op, { op: "move" }>;
        ops.push(op);
        post.push({ kind: "block_at", block_id: pb.id, title: pb.title, starts_at: op.after.starts_at, ends_at: op.after.ends_at });
        placedIds = [pb.id];
        placedTitle = pb.title;
      } else {
        const pt = await task(ctx, cmd.place_task_id!);
        needOpenTask(pt);
        at = cmd.start ? resolveStart(cmd.start, date, zone) : slot ? DateTime.fromISO(slot.starts_at).setZone(zone) : (() => { throw new CommandInputError("Say when to put it (start)."); })();
        const mins = cmd.minutes ?? (pt.estimate_minutes ? defaultMinutes(pt) : slot ? minutesOf(slot) : 30);
        const nb = newBlock(ctx, pt, at, at.plus({ minutes: mins }));
        if ((await scopeMode(ctx, nb.plan_date, pt.id)) === "exclude") ops.push(...(await scopeOp(ctx, nb.plan_date, pt, "include")));
        ops.push({ op: "insert", block: nb });
        post.push({ kind: "task_at", task_id: pt.id, title: pt.title, starts_at: nb.starts_at, ends_at: nb.ends_at }, { kind: "task_open", task_id: pt.id, title: pt.title });
        placedIds = [nb.id];
        placedTitle = pt.title;
      }
      if (removeTask) post.push({ kind: "task_not_on", task_id: removeTask.id, title: removeTask.title, date }, { kind: "task_open", task_id: removeTask.id, title: removeTask.title });
      return out({
        dates: [...new Set([date, at.toISODate()!])], ops, post,
        targets: { blockIds: [...removing.map((r) => r.id), ...(cmd.place_block_id ? [cmd.place_block_id] : [])], taskIds: [...(removeTask ? [removeTask.id] : []), ...(cmd.place_task_id ? [cmd.place_task_id] : [])], removes: true },
        placed: placedIds, fixedExcept: [...removing.map((r) => r.id), ...placedIds], plan: {},
        what: `Put ${q(placedTitle)} at ${at.toFormat("h:mm a")}${removeTask ? ` and took ${q(removeTask.title)} off ${DateTime.fromISO(date).toFormat("cccc")}'s plan` : ""}`,
        defers: removeTask ? [{ task_id: removeTask.id, title: removeTask.title, decision: "unschedule" }] : [],
      });
    }
    case "split_task": {
      const t = await task(ctx, cmd.task_id);
      needOpenTask(t);
      if (!cmd.sessions.length) throw new CommandInputError("Give at least one session.");
      const blocks = cmd.sessions.map((s) => { const st = resolveStart(s.start, s.date, zone); return newBlock(ctx, t, st, st.plus({ minutes: s.minutes })); });
      return out({
        dates: [...new Set(blocks.map((b) => b.plan_date))], ops: blocks.map((b) => ({ op: "insert" as const, block: b })),
        post: [...blocks.map((b) => ({ kind: "task_at" as const, task_id: t.id, title: t.title, starts_at: b.starts_at, ends_at: b.ends_at })), { kind: "task_open", task_id: t.id, title: t.title }],
        targets: { blockIds: [], taskIds: [t.id], removes: false }, placed: blocks.map((b) => b.id), plan: {},
        what: `Split ${q(t.title)} into ${blocks.length} session${blocks.length === 1 ? "" : "s"}`, defers: [],
      });
    }
    case "unschedule": {
      const date = resolveDay(cmd.date, zone);
      const fromBlocks = await Promise.all((cmd.block_ids ?? []).map((id) => block(ctx, id)));
      const tasks = await Promise.all([...new Set([...(cmd.task_ids ?? []), ...fromBlocks.map((b) => b.task_id).filter((x): x is string => !!x)])].map((id) => task(ctx, id)));
      const removing = new Map<string, PlanBlock>();
      for (const b of fromBlocks) removing.set(b.id, b);
      for (const t of tasks) for (const b of await openBlocksOf(ctx, t.id, date)) removing.set(b.id, b);
      for (const b of removing.values()) needOpenBlock(b);
      if (!removing.size && !tasks.length) throw new CommandInputError("Nothing planned matched that.");
      const ops: Op[] = [...removing.values()].map((b) => ({ op: "remove", id: b.id, title: b.title, before: blockFields(b) }));
      if (cmd.keep_off !== false) for (const t of tasks) ops.push(...(await scopeOp(ctx, date, t, "exclude")));
      const sessions = [...new Set([...removing.values()].map((b) => b.session_title).filter(Boolean))];
      return out({
        dates: [...new Set([date, ...[...removing.values()].map((b) => b.plan_date)])], ops,
        post: [...tasks.flatMap((t) => [{ kind: "task_not_on" as const, task_id: t.id, title: t.title, date }, { kind: "task_open" as const, task_id: t.id, title: t.title }])],
        targets: { blockIds: [...removing.keys()], taskIds: tasks.map((t) => t.id), removes: true }, placed: [], fixedExcept: [...removing.keys()], plan: {},
        what: `Took ${tasks.length === 1 ? q(tasks[0].title) : sessions.length === 1 ? q(String(sessions[0])) : `${tasks.length || removing.size} things`} off ${DateTime.fromISO(date).toFormat("cccc")}'s plan (still on your list)`,
        defers: tasks.map((t) => ({ task_id: t.id, title: t.title, decision: "unschedule" as const })),
      });
    }
    case "clear_day": {
      const date = resolveDay(cmd.date, zone);
      const { data } = await ctx.db.from("plan_blocks").select("*").eq("plan_date", date).eq("status", "planned");
      const all = (data ?? []) as PlanBlock[];
      const locked = (b: PlanBlock) => !!b.pinned || b.created_by === "user" || b.placement === "manual" || b.placement === "requested";
      const clearing = all.filter((b) => b.is_flexible && Date.parse(b.ends_at) > Date.now() && (cmd.include_locked || !locked(b)));
      const staying = all.filter((b) => !clearing.includes(b));
      const taskIds = [...new Set(clearing.map((b) => b.task_id).filter((x): x is string => !!x))];
      const { data: trows } = taskIds.length ? await ctx.db.from("tasks").select("id,title").in("id", taskIds) : { data: [] };
      const ops: Op[] = clearing.map((b) => ({ op: "remove", id: b.id, title: b.title, before: blockFields(b) }));
      for (const t of (trows ?? []) as { id: string; title: string }[]) ops.push(...(await scopeOp(ctx, date, t, "exclude")));
      return out({
        dates: [date], ops,
        post: [
          { kind: "no_open_flexible", date, except: staying.map((b) => b.id) },
          { kind: "blocks_unchanged", blocks: staying.map((b) => ({ id: b.id, title: b.title, starts_at: b.starts_at, ends_at: b.ends_at })) },
          ...((trows ?? []) as { id: string; title: string }[]).map((t) => ({ kind: "task_open" as const, task_id: t.id, title: t.title })),
        ],
        targets: { blockIds: clearing.map((b) => b.id), taskIds, removes: true }, placed: [], plan: { refit: false },
        what: clearing.length ? `Cleared ${DateTime.fromISO(date).toFormat("cccc")}'s flexible work (${clearing.length} block${clearing.length === 1 ? "" : "s"}; your tasks stay on your list${staying.length ? `, and ${staying.length} fixed or locked thing${staying.length === 1 ? " stays" : "s stay"}` : ""})` : "There was no flexible work to clear",
        defers: ((trows ?? []) as { id: string; title: string }[]).map((t) => ({ task_id: t.id, title: t.title, decision: "unschedule" as const })),
      });
    }
    case "lock": {
      const blocks = (await Promise.all(cmd.block_ids.map((id) => block(ctx, id)))).flat();
      const all = (await Promise.all(blocks.map((b) => sessionOf(ctx, b)))).flat();
      const uniq = [...new Map(all.map((b) => [b.id, b])).values()];
      for (const b of uniq) needOpenBlock(b);
      const ops = uniq.filter((b) => !!b.pinned !== cmd.locked).map((b) => moveOp(b, { pinned: cmd.locked, placement: b.placement === "manual" || b.created_by === "user" ? "manual" : cmd.locked ? "requested" : "auto" }, ctx));
      return out({
        dates: [...new Set(uniq.map((b) => b.plan_date))], ops,
        post: uniq.map((b) => ({ kind: "pinned" as const, block_id: b.id, title: b.title, value: cmd.locked })),
        targets: { blockIds: uniq.map((b) => b.id), taskIds: [], removes: false }, placed: [], plan: {},
        what: `${cmd.locked ? "Locked" : "Unlocked"} ${uniq.length === 1 ? q(uniq[0].title) : `${uniq.length} blocks`}`, defers: [],
      });
    }
    case "set_scope": {
      const date = resolveDay(cmd.date, zone);
      const tasks = await Promise.all([...new Set(cmd.task_ids)].map((id) => task(ctx, id)));
      const ops: Op[] = [];
      const post: Postcondition[] = [];
      const want: DayScopeMode | null = cmd.mode === "clear" ? null : cmd.mode;
      if (cmd.mode === "only") {
        // "Only these today" replaces any earlier "only" list for the day.
        const { data } = await ctx.db.from("day_plan_scope").select("task_id").eq("date", date).eq("mode", "only");
        for (const r of (data ?? []) as { task_id: string }[]) if (!cmd.task_ids.includes(r.task_id)) ops.push({ op: "scope", date, task_id: r.task_id, title: "", before: "only", after: null });
      }
      for (const t of tasks) {
        ops.push(...(await scopeOp(ctx, date, t, want)));
        post.push({ kind: "scope", date, task_id: t.id, title: t.title, mode: want });
        if (want === "exclude") {
          for (const b of await openBlocksOf(ctx, t.id, date)) if (b.status === "planned") ops.push({ op: "remove", id: b.id, title: b.title, before: blockFields(b) });
          post.push({ kind: "task_not_on", task_id: t.id, title: t.title, date }, { kind: "task_open", task_id: t.id, title: t.title });
        } else if (want === "only" || want === "include") {
          post.push({ kind: "task_on", task_id: t.id, title: t.title, date, soft: true });
        }
      }
      const day = DateTime.fromISO(date).toFormat("cccc");
      const names = tasks.length <= 3 ? tasks.map((t) => q(t.title)).join(", ") : `${tasks.length} tasks`;
      return out({
        dates: [date], ops, post,
        targets: { blockIds: ops.filter((o) => o.op === "remove").map((o) => (o as { id: string }).id), taskIds: tasks.map((t) => t.id), removes: want === "exclude" },
        placed: [], plan: {},
        what: want === "only" ? `Planning only ${names} on ${day}` : want === "include" ? `Added ${names} to ${day}'s plan` : want === "exclude" ? `Keeping ${names} off ${day}'s plan (still on your list)` : `Navi can plan ${names} on ${day} again`,
        defers: want === "exclude" ? tasks.map((t) => ({ task_id: t.id, title: t.title, decision: "exclude" as const })) : [],
      });
    }
    case "group_session": {
      if (cmd.task_ids.length < 2) throw new CommandInputError("A work session groups at least two tasks.");
      const tasks = await Promise.all(cmd.task_ids.map((id) => task(ctx, id)));
      tasks.forEach(needOpenTask);
      let cursor = resolveStart(cmd.start, cmd.date, zone);
      const sessionId = randomUUID();
      const title = (cmd.title ?? `Work session: ${tasks.map((t) => t.title).join(", ")}`).slice(0, 200);
      const startAt = cursor;
      const blocks = tasks.map((t, i) => {
        const s = cursor;
        cursor = s.plus({ minutes: cmd.minutes?.[i] ?? defaultMinutes(t) });
        return newBlock(ctx, t, s, cursor, { session_id: sessionId, session_title: title, reason: `Part of “${title}”` });
      });
      return out({
        dates: [...new Set(blocks.map((b) => b.plan_date))], ops: blocks.map((b) => ({ op: "insert" as const, block: b })),
        post: [...blocks.map((b) => ({ kind: "task_at" as const, task_id: b.task_id!, title: b.title, starts_at: b.starts_at, ends_at: b.ends_at })), ...tasks.map((t) => ({ kind: "task_open" as const, task_id: t.id, title: t.title }))],
        targets: { blockIds: [], taskIds: tasks.map((t) => t.id), removes: false }, placed: blocks.map((b) => b.id), plan: {},
        what: `Grouped ${tasks.length} tasks into one work session at ${startAt.toFormat("h:mm a")}`, defers: [],
      });
    }
    case "replan": {
      const dates = cmd.dates.length ? [...new Set(cmd.dates)].sort() : [nowIn(zone).toISODate()!];
      const ops: Op[] = (cmd.exceptions ?? []).map((x) => ({ op: "exception" as const, row: { id: randomUUID(), date: x.date ?? dates[0], kind: x.kind, start_time: x.start_time ?? null, end_time: x.end_time ?? null, minutes: x.minutes ?? null, note: x.note ?? null, source: ctx.actor === "user" ? ("ui" as const) : ("chat" as const) } }));
      const focus = cmd.focus_task_ids ?? [];
      const post: Postcondition[] = [];
      if (focus.length) {
        const { data } = await ctx.db.from("tasks").select("id,title").in("id", focus);
        for (const t of (data ?? []) as { id: string; title: string }[]) post.push({ kind: "task_on", task_id: t.id, title: t.title, date: dates[0], soft: true });
      }
      return out({ dates, ops, post, targets: { blockIds: [], taskIds: focus, removes: false }, placed: [], plan: { focusTaskIds: focus.length ? focus : undefined }, what: "Re-planned", defers: [] });
    }
  }
}
