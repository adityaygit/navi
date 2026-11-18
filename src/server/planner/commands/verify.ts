import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import type { DayScopeMode, PlanBlock } from "@/lib/types";
import type { Op } from "../plan-v2";

// After a change set is applied: read what's actually saved and compare it
// with (1) every op in the change set and (2) what the person asked for. The
// reply is written from this, never from the fact that the planner ran.

export type Postcondition =
  | { kind: "task_at"; task_id: string; title: string; starts_at: string; ends_at: string }
  | { kind: "block_at"; block_id: string; title: string; starts_at: string; ends_at: string }
  | { kind: "task_not_on"; task_id: string; title: string; date: string }
  | { kind: "task_open"; task_id: string; title: string }
  | { kind: "pinned"; block_id: string; title: string; value: boolean }
  | { kind: "scope"; date: string; task_id: string; title: string; mode: DayScopeMode | null }
  | { kind: "blocks_unchanged"; blocks: { id: string; title: string; starts_at: string; ends_at: string }[] }
  | { kind: "no_open_flexible"; date: string; except: string[] }
  /** Wanted but not promised (e.g. focus work in a re-plan): reported, never a failure. */
  | { kind: "task_on"; task_id: string; title: string; date: string; soft: true };

export type Check = { label: string; ok: boolean; soft?: boolean; actual?: string };
export type Verification = { ok: boolean; opsPersisted: boolean; checks: Check[]; checkedAt: string };

const same = (a: string, b: string) => Date.parse(a) === Date.parse(b);
const OPEN = ["planned", "in_progress"];

/** Pure: check saved rows against the ops and postconditions. */
export function evaluate(
  blocks: PlanBlock[],
  scope: { date: string; task_id: string; mode: DayScopeMode }[],
  tasks: { id: string; status: string }[],
  ops: Op[],
  post: Postcondition[],
  zone: string,
): Verification {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const checks: Check[] = [];
  const t = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("ccc h:mm a");
  let opsOk = true;
  for (const o of ops) {
    if (o.op === "insert") {
      const b = byId.get(o.block.id);
      if (!b || !same(b.starts_at, o.block.starts_at) || !same(b.ends_at, o.block.ends_at)) opsOk = false;
    } else if (o.op === "update") {
      const b = byId.get(o.id);
      if (b && (!same(b.starts_at, String(o.after.starts_at)) || !same(b.ends_at, String(o.after.ends_at)))) opsOk = false;
    } else if (o.op === "move") {
      const b = byId.get(o.id);
      if (!b || !same(b.starts_at, o.after.starts_at) || !same(b.ends_at, o.after.ends_at) || !!b.pinned !== o.after.pinned) opsOk = false;
    } else if (o.op === "delete" || o.op === "remove") {
      if (byId.has(o.id)) opsOk = false;
    } else if (o.op === "scope") {
      const r = scope.find((x) => x.date === o.date && x.task_id === o.task_id);
      if ((r?.mode ?? null) !== o.after) opsOk = false;
    }
  }
  checks.push({ label: "Every planned change was saved", ok: opsOk });
  for (const p of post) {
    if (p.kind === "task_at") {
      const hit = blocks.find((b) => b.task_id === p.task_id && OPEN.includes(b.status) && same(b.starts_at, p.starts_at) && same(b.ends_at, p.ends_at));
      const other = blocks.filter((b) => b.task_id === p.task_id && OPEN.includes(b.status)).map((b) => t(b.starts_at));
      checks.push({ label: `“${p.title}” is planned at ${t(p.starts_at)}`, ok: !!hit, actual: hit ? undefined : other.length ? `planned at ${other.join(", ")}` : "not planned" });
    } else if (p.kind === "block_at") {
      const b = byId.get(p.block_id);
      checks.push({ label: `“${p.title}” is at ${t(p.starts_at)}`, ok: !!b && same(b.starts_at, p.starts_at) && same(b.ends_at, p.ends_at), actual: b ? t(b.starts_at) : "gone" });
    } else if (p.kind === "task_not_on") {
      const left = blocks.filter((b) => b.task_id === p.task_id && b.plan_date === p.date && b.status === "planned");
      checks.push({ label: `“${p.title}” is off ${DateTime.fromISO(p.date).toFormat("cccc")}'s plan`, ok: !left.length, actual: left.length ? `still at ${left.map((b) => t(b.starts_at)).join(", ")}` : undefined });
    } else if (p.kind === "task_open") {
      const task = tasks.find((x) => x.id === p.task_id);
      checks.push({ label: `“${p.title}” is still on the task list`, ok: !!task && task.status !== "cancelled", actual: task ? task.status : "missing" });
    } else if (p.kind === "pinned") {
      const b = byId.get(p.block_id);
      checks.push({ label: `“${p.title}” is ${p.value ? "locked" : "unlocked"}`, ok: !!b && !!b.pinned === p.value });
    } else if (p.kind === "scope") {
      const r = scope.find((x) => x.date === p.date && x.task_id === p.task_id);
      checks.push({ label: `“${p.title}” scope for ${p.date} is ${p.mode ?? "default"}`, ok: (r?.mode ?? null) === p.mode });
    } else if (p.kind === "blocks_unchanged") {
      const moved = p.blocks.filter((x) => { const b = byId.get(x.id); return !b || !same(b.starts_at, x.starts_at) || !same(b.ends_at, x.ends_at); });
      checks.push({ label: "Fixed and locked things stayed where they were", ok: !moved.length, actual: moved.length ? moved.map((m) => m.title).join(", ") : undefined });
    } else if (p.kind === "no_open_flexible") {
      const left = blocks.filter((b) => b.plan_date === p.date && b.status === "planned" && b.is_flexible && !p.except.includes(b.id));
      checks.push({ label: `No flexible work left on ${p.date}`, ok: !left.length, actual: left.length ? left.map((b) => b.title).join(", ") : undefined });
    } else if (p.kind === "task_on") {
      const hit = blocks.some((b) => b.task_id === p.task_id && b.plan_date === p.date && OPEN.includes(b.status));
      checks.push({ label: `“${p.title}” is planned ${DateTime.fromISO(p.date).toFormat("cccc")}`, ok: hit, soft: true, actual: hit ? undefined : "not planned" });
    }
  }
  return { ok: checks.every((c) => c.ok || c.soft), opsPersisted: opsOk, checks, checkedAt: new Date().toISOString() };
}

/** Read the saved state for these dates and ids, then evaluate. Stores the result on the change set. */
export async function verifyChangeset(ctx: Ctx, changesetId: string, ops: Op[], post: Postcondition[], dates: string[]): Promise<Verification> {
  const ids = new Set<string>();
  const taskIds = new Set<string>();
  const scopeDates = new Set<string>(dates);
  for (const o of ops) {
    if (o.op === "insert") ids.add(o.block.id);
    else if (o.op === "scope") { scopeDates.add(o.date); taskIds.add(o.task_id); }
    else if (o.op !== "exception") ids.add(o.id);
  }
  for (const p of post) {
    if ("block_id" in p) ids.add(p.block_id);
    if ("task_id" in p) taskIds.add(p.task_id);
    if ("date" in p) scopeDates.add(p.date);
    if (p.kind === "blocks_unchanged") p.blocks.forEach((b) => ids.add(b.id));
  }
  const [byDate, byId, scope, tasks] = await Promise.all([
    ctx.db.from("plan_blocks").select("*").eq("user_id", ctx.userId).in("plan_date", [...scopeDates]),
    ids.size ? ctx.db.from("plan_blocks").select("*").eq("user_id", ctx.userId).in("id", [...ids]) : Promise.resolve({ data: [], error: null }),
    ctx.db.from("day_plan_scope").select("date,task_id,mode").eq("user_id", ctx.userId).in("date", [...scopeDates]),
    taskIds.size ? ctx.db.from("tasks").select("id,status").in("id", [...taskIds]) : Promise.resolve({ data: [], error: null }),
  ]);
  const err = byDate.error ?? byId.error ?? scope.error ?? tasks.error;
  if (err) throw new Error(`Couldn't read the plan back to check it: ${err.message}`);
  const blocks = new Map<string, PlanBlock>();
  for (const b of [...((byDate.data ?? []) as PlanBlock[]), ...((byId.data ?? []) as PlanBlock[])]) blocks.set(b.id, b);
  const v = evaluate([...blocks.values()], (scope.data ?? []) as { date: string; task_id: string; mode: DayScopeMode }[], (tasks.data ?? []) as { id: string; status: string }[], ops, post, ctx.timezone);
  await ctx.db.from("plan_changesets").update({ verification: v }).eq("id", changesetId);
  return v;
}
