import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import type { Ctx } from "@/server/context";
import type { PlanBlock, Task } from "@/lib/types";

// Stateful stress simulation (2026-11-17). A seeded, reproducible simulated
// student runs ~2 weeks of mixed, messy use through the REAL tools and APIs
// (what Navi's model calls and what the screens call) against the local
// database: creating and re-creating tasks, Navi creating "the same" task
// again, planning and re-planning, moving and pinning blocks, placing work by
// hand, finishing / dropping / deleting tasks, undoing, Canvas syncs that
// change, drop and repeat items, disconnect + reconnect, triage decisions.
// After EVERY step the invariants below are checked against the database.
// A failure prints the seed and the exact operation log (the reproduction).
//
// It does not test language understanding (no model here); the real-model
// scenarios are in tests/stress/real-model.test.ts.

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
process.env.NAVI_INTEGRATION_ENCRYPTION_KEY ||= Buffer.alloc(32, 9).toString("base64");

const { runTool } = await import("@/server/ai/tools");
const { createTask, completeTask, changeTask } = await import("@/server/domain/tasks");
const { deleteEntity } = await import("@/server/domain/entities");
const { generateDayPlan, setBlockOutcome } = await import("@/server/planner/plan");
const { placeTask } = await import("@/server/planner/place");
const { revertActivity } = await import("@/server/domain/activity");
const { connectFeed, disconnectFeed } = await import("@/server/integrations/connections");
const { runSync } = await import("@/server/integrations/feed-sync");
const { taskGroupsView } = await import("@/server/mobile/views");
const { resolveTriage } = await import("@/server/domain/triage");

const zone = "America/New_York";
const FIX = path.resolve(__dirname, "../fixtures/canvas");
const V1 = readFileSync(path.join(FIX, "feed-v1.ics"), "utf8");
const V2 = readFileSync(path.join(FIX, "feed-v2.ics"), "utf8");
const FEED = "https://navi-u.instructure.com/feeds/calendars/user_AbCdEf0123456789xyzAbCdEf0123456789xyz.ics";
const dropUid = (feed: string, uid: string) => feed.replace(new RegExp(`BEGIN:VEVENT\\r\\nDTSTAMP:[^\\r]*\\r\\nUID:${uid}\\r\\n[\\s\\S]*?END:VEVENT\\r\\n`, "g"), "");

/** Small seeded PRNG (mulberry32): the same seed replays the same run. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)] };
}

const TITLES = ["Chem lab report", "Read chapter 4", "Email Ms. Lee", "PBL urban gardening", "Spanish test prep", "Math problem set", "Clean room", "Call grandma", "History essay draft", "Practice guitar"];
const norm = (t: string) => t.replace(/\s*\[[^[\]]*\]\s*$/, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

type Expectation = { blockId: string; taskId: string; starts_at: string; why: string };

let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
let navi: Ctx;

beforeAll(async () => {
  me = await userClient("stress-sim@navi.test");
  user = ctxFor(me.db, me.userId, zone);
  navi = { ...user, actor: "navi", userMessage: "" };
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

async function reset() {
  await resetUser(me.userId);
  const a = admin();
  for (const t of ["plan_changesets", "day_exceptions", "availability_rules", "integration_connections"]) await a.from(t).delete().eq("user_id", me.userId);
  await a.from("profiles").update({ preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00" }, availability: [], timezone: zone }).eq("id", me.userId);
  // School on weekdays and practice twice a week: fixed time the planner must route around.
  const base = DateTime.now().setZone(zone).startOf("day");
  const events = [];
  for (let i = 0; i < 14; i++) {
    const d = base.plus({ days: i });
    if (d.weekday <= 5) events.push({ user_id: me.userId, title: "School", starts_at: d.set({ hour: 8 }).toISO(), ends_at: d.set({ hour: 15 }).toISO(), source: "user", status: "confirmed" });
    if (d.weekday === 2 || d.weekday === 4) events.push({ user_id: me.userId, title: "Soccer practice", starts_at: d.set({ hour: 16 }).toISO(), ends_at: d.set({ hour: 17, minute: 30 }).toISO(), source: "user", status: "confirmed" });
  }
  const { error } = await a.from("events").insert(events);
  if (error) throw new Error(error.message);
}

async function state() {
  const [{ data: tasks }, { data: blocks }, { data: events }] = await Promise.all([
    me.db.from("tasks").select("*"),
    me.db.from("plan_blocks").select("*"),
    me.db.from("events").select("*").eq("status", "confirmed"),
  ]);
  return { tasks: (tasks ?? []) as Task[], blocks: (blocks ?? []) as PlanBlock[], events: (events ?? []) as { starts_at: string; ends_at: string; title: string }[] };
}

/** Every invariant; returns the broken ones (empty = fine). */
async function invariants(ctx: { expectations: Expectation[]; deleted: Set<string>; created: Set<string>; naviDupGuard: boolean }) {
  const s = await state();
  const problems: string[] = [];
  const now = Date.now();
  const today = DateTime.now().setZone(zone).toISODate()!;
  const byId = new Map(s.tasks.map((t) => [t.id, t]));
  const open = s.tasks.filter((t) => ["todo", "in_progress", "blocked"].includes(t.status));
  const live = s.blocks.filter((b) => ["planned", "in_progress"].includes(b.status) && Date.parse(b.ends_at) > now);

  // I1: blocks the person placed (or asked Navi to put somewhere) stay where they are.
  for (const e of ctx.expectations) {
    const t = byId.get(e.taskId);
    if (!t || !["todo", "in_progress", "blocked"].includes(t.status)) continue; // finished / dropped: may go
    const b = s.blocks.find((x) => x.id === e.blockId);
    if (!b) problems.push(`I1 placed block for “${t.title}” (${e.why}) disappeared`);
    else if (Date.parse(b.starts_at) !== Date.parse(e.starts_at)) problems.push(`I1 placed block for “${t.title}” (${e.why}) moved from ${e.starts_at} to ${b.starts_at}`);
  }
  // I2: Navi's flexible blocks never overlap fixed events.
  for (const b of live.filter((x) => x.is_flexible && x.created_by === "navi")) {
    const ev = s.events.find((e) => Date.parse(e.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(e.ends_at));
    if (ev) problems.push(`I2 Navi block “${b.title}” ${b.starts_at} overlaps fixed “${ev.title}”`);
  }
  // I3: no task is booked twice at overlapping times, and Navi doesn't book far more than the task needs.
  const byTask = new Map<string, PlanBlock[]>();
  for (const b of live) if (b.task_id) byTask.set(b.task_id, [...(byTask.get(b.task_id) ?? []), b]);
  for (const [tid, bs] of byTask) {
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      if (Date.parse(bs[i].starts_at) < Date.parse(bs[j].ends_at) && Date.parse(bs[j].starts_at) < Date.parse(bs[i].ends_at)) problems.push(`I3 “${byId.get(tid)?.title}” booked twice at overlapping times`);
    }
    const t = byId.get(tid);
    const navMin = bs.filter((b) => b.created_by === "navi" && !b.pinned).reduce((m, b) => m + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000, 0);
    const need = Math.max(30, Math.round((t?.estimate_minutes ?? 30) * 2));
    if (t && navMin > need + 1) problems.push(`I3 “${t.title}” has ${navMin} min of Navi blocks for a ${t.estimate_minutes ?? 30} min task`);
  }
  // I4: no open work planned for tasks that are finished, dropped or gone (from tomorrow on; today's done blocks are history).
  for (const b of live) {
    if (!b.task_id || b.plan_date <= today) continue;
    const t = byId.get(b.task_id);
    if (!t) problems.push(`I4 block “${b.title}” on ${b.plan_date} points at a deleted task`);
    else if (!["todo", "in_progress", "blocked"].includes(t.status)) problems.push(`I4 block “${b.title}” on ${b.plan_date} for a ${t.status} task`);
  }
  // I5: Navi never makes a second open copy of the same task.
  if (ctx.naviDupGuard) {
    const naviOpen = open.filter((t) => t.source === "navi");
    const seen = new Map<string, string>();
    for (const t of naviOpen) {
      const k = norm(t.title);
      const other = open.find((o) => o.id !== t.id && norm(o.title) === k && Date.parse(o.created_at) <= Date.parse(t.created_at));
      if (other && !seen.has(k)) {
        seen.set(k, t.id);
        problems.push(`I5 Navi created a duplicate of “${t.title}”`);
      }
    }
  }
  // I6: every open top-level task shows in exactly one place on the phone's list.
  const g = await taskGroupsView(user);
  const shown = [...g.today, ...g.needsTime, ...g.later].map((t) => t.id).concat(g.needsDecision?.items.map((t) => t.id) ?? []);
  const counts = new Map<string, number>();
  for (const id of shown) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const t of open.filter((x) => !x.parent_task_id)) {
    const n = counts.get(t.id) ?? 0;
    if (n !== 1) problems.push(`I6 open task “${t.title}” shows ${n} times on the phone list`);
  }
  // I7: overdue imported work is never auto-planned by Navi.
  for (const b of live.filter((x) => x.created_by === "navi" && !x.pinned && x.task_id)) {
    const t = byId.get(b.task_id!);
    if (t && t.source === "external" && t.due_at && Date.parse(t.due_at) < now && (t.external_ref ?? "").startsWith("ext:")) problems.push(`I7 overdue Canvas “${t.title}” auto-planned on ${b.plan_date}`);
  }
  // I8: nothing the simulation created disappeared unless it deleted it.
  for (const id of ctx.created) if (!ctx.deleted.has(id) && !byId.has(id)) problems.push(`I8 task ${id} vanished without being deleted`);
  return problems;
}

async function simulate(seed: number, steps: number) {
  await reset();
  const r = rng(seed);
  const log: string[] = [];
  const ctx = { expectations: [] as Expectation[], deleted: new Set<string>(), created: new Set<string>(), naviDupGuard: true };
  const days = Array.from({ length: 6 }, (_, i) => DateTime.now().setZone(zone).plus({ days: i + 1 }).toISODate()!);
  let feed = V1;
  let connId: string | null = null;
  const a = admin();
  const openTasks = async () => ((await me.db.from("tasks").select("id,title,status,source,estimate_minutes").in("status", ["todo", "in_progress", "blocked"]).is("parent_task_id", null)).data ?? []) as Task[];
  const futureBlocks = async () => ((await me.db.from("plan_blocks").select("*").in("status", ["planned"]).gt("plan_date", DateTime.now().setZone(zone).toISODate()!)).data ?? []) as PlanBlock[];

  const ops: [number, string, () => Promise<string>][] = [
    [10, "user adds a task", async () => {
      const t = await createTask(user, { title: r.pick(TITLES), estimate_minutes: r.pick([20, 30, 45, 60, 90, 150]), due_at: r.next() < 0.6 ? DateTime.fromISO(r.pick(days), { zone }).set({ hour: 23, minute: 59 }).toISO() : null });
      ctx.created.add(t.id);
      return `created “${t.title}” (${t.estimate_minutes}m)`;
    }],
    [10, "Navi adds a task (often one that exists)", async () => {
      const title = r.pick(TITLES);
      const res = await runTool({ ...navi, userMessage: `add ${title}` }, "create_task", { title, estimate_minutes: 30, user_command: `add ${title}` });
      const id = (res.data as { id?: string } | undefined)?.id;
      if (id) ctx.created.add(id);
      return `create_task “${title}” → ${res.ok ? (res.mutated ? "created" : "existing") : `failed: ${res.summary}`}`;
    }],
    [12, "plan a day", async () => {
      const d = r.pick(days);
      const res = r.next() < 0.5 ? await runTool(navi, "plan", { date: d }) : { ok: true, summary: (await generateDayPlan(user, d)).warnings.join(" ") };
      return `plan ${d} → ${res.ok ? "ok" : `failed: ${res.summary}`}`;
    }],
    [8, "Navi moves a block (pins it)", async () => {
      const bs = (await futureBlocks()).filter((b) => b.task_id && b.created_by === "navi");
      if (!bs.length) return "no block to move";
      const b = r.pick(bs);
      const d = r.pick(days);
      const start = DateTime.fromISO(d, { zone }).set({ hour: r.pick([17, 18, 19, 20, 21]), minute: r.pick([0, 30]) }).toISO()!;
      const res = await runTool(navi, "move_block", { moves: [{ block_id: b.id, start }] });
      const after = (await me.db.from("plan_blocks").select("id,starts_at,task_id").eq("id", b.id).maybeSingle()).data;
      ctx.expectations = ctx.expectations.filter((e) => e.blockId !== b.id); // a newer request replaces an older one
      if (res.ok && after && Date.parse(after.starts_at) === Date.parse(start)) ctx.expectations.push({ blockId: b.id, taskId: b.task_id!, starts_at: after.starts_at, why: "Navi moved it on request" });
      return `move_block “${b.title}” → ${start}: ${res.ok ? "ok" : "refused"}`;
    }],
    [8, "person places a task by hand", async () => {
      const ts = await openTasks();
      if (!ts.length) return "nothing to place";
      const t = r.pick(ts);
      const d = r.pick(days);
      const start = DateTime.fromISO(d, { zone }).set({ hour: r.pick([18, 19, 20, 21]), minute: r.pick([0, 15, 30, 45]) });
      try {
        const b = await placeTask(user, { taskId: t.id, startsAt: start.toISO(), minutes: 30 });
        ctx.expectations.push({ blockId: b.id, taskId: t.id, starts_at: b.starts_at, why: "placed by the person" });
        return `placed “${t.title}” at ${start.toISO()}`;
      } catch (e) {
        return `place “${t.title}” refused: ${(e as Error).message.slice(0, 80)}`;
      }
    }],
    [6, "finish a task", async () => {
      const ts = await openTasks();
      if (!ts.length) return "nothing open";
      const t = r.pick(ts);
      await completeTask(user, t.id);
      return `completed “${t.title}”`;
    }],
    [4, "drop a task", async () => {
      const ts = (await openTasks()).filter((t) => t.source !== "external");
      if (!ts.length) return "nothing to drop";
      const t = r.pick(ts);
      await changeTask(user, t.id, { status: "cancelled" });
      return `cancelled “${t.title}”`;
    }],
    [4, "delete a task", async () => {
      const ts = (await openTasks()).filter((t) => t.source !== "external");
      if (!ts.length) return "nothing to delete";
      const t = r.pick(ts);
      await deleteEntity(user, "tasks", t.id);
      ctx.deleted.add(t.id);
      return `deleted “${t.title}”`;
    }],
    [4, "skip a block", async () => {
      const bs = await futureBlocks();
      if (!bs.length) return "no block";
      const b = r.pick(bs);
      await setBlockOutcome(user, b.id, "skipped", "didn't feel like it");
      ctx.expectations = ctx.expectations.filter((e) => e.blockId !== b.id);
      return `skipped “${b.title}”`;
    }],
    [4, "undo Navi's last change", async () => {
      const { data } = await me.db.from("activity_log").select("id,summary,action,entity_type,entity_id").eq("actor", "navi").eq("reversible", true).is("reverted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) return "nothing to undo";
      try {
        const msg = await revertActivity(user, data.id);
        // Undoing a create removes what it made: an explicit deletion.
        if (data.entity_type === "tasks" && data.entity_id && /^Undid/.test(msg)) {
          const { data: still } = await me.db.from("tasks").select("id").eq("id", data.entity_id).maybeSingle();
          if (!still) ctx.deleted.add(data.entity_id);
        }
        // An undone move puts the block back: it's no longer an expectation.
        ctx.expectations = ctx.expectations.filter((e) => e.why !== "Navi moved it on request");
        return `undo “${data.summary}”: ${msg}`;
      } catch (e) {
        return `undo refused: ${(e as Error).message.slice(0, 80)}`;
      }
    }],
    [6, "Canvas sync (feed changes)", async () => {
      if (!connId) {
        const c = await connectFeed(user, "canvas", FEED, { admin: a, fetchText: async () => feed });
        connId = c.connectionId;
        return `connected Canvas: ${c.outcome.ok ? "ok" : c.outcome.code}`;
      }
      feed = r.pick([V1, V2, dropUid(V1, "event-assignment-1002"), V1]);
      await a.from("integration_connections").update({ locked_until: null, last_attempt_at: null }).eq("id", connId);
      const o = await runSync(a, connId, { trigger: "manual", fetchFeed: async () => feed });
      return `sync: ${o.ok ? `${o.counts.created} new, ${o.counts.updated} updated, ${o.counts.removed} removed` : o.code}`;
    }],
    [2, "disconnect (keep) and reconnect", async () => {
      if (!connId) return "not connected";
      await disconnectFeed(user, connId, { removeImported: false }, { admin: a });
      const c = await connectFeed(user, "canvas", FEED, { admin: a, fetchText: async () => feed });
      connId = c.connectionId;
      return `reconnected: ${c.outcome.ok ? `relinked ${c.outcome.counts.relinked}, created ${c.outcome.counts.created}` : c.outcome.code}`;
    }],
    [3, "say overdue imports are handed in", async () => {
      const res = await resolveTriage(user, "handed_in", { all: true });
      return `handed in ${res.changed.length}/${res.asked}`;
    }],
  ];
  const total = ops.reduce((s, [w]) => s + w, 0);
  for (let i = 0; i < steps; i++) {
    let x = r.int(total);
    const [, name, run] = ops.find(([w]) => (x -= w) < 0)!;
    let result: string;
    try {
      result = await run();
    } catch (e) {
      result = `THREW ${(e as Error).message.slice(0, 160)}`;
    }
    log.push(`${i + 1}. ${name}: ${result}`);
    const problems = await invariants(ctx);
    if (result.startsWith("THREW")) problems.push(`E1 operation threw: ${result}`);
    if (problems.length) return { seed, step: i + 1, problems, log };
  }
  return { seed, step: steps, problems: [] as string[], log };
}

describe("stateful stress simulation", () => {
  const SEEDS = (process.env.NAVI_STRESS_SEEDS ?? "1,2,3,4,5").split(",").map(Number);
  const STEPS = Number(process.env.NAVI_STRESS_STEPS ?? 40);
  for (const seed of SEEDS) {
    it(`seed ${seed}: ${STEPS} steps keep every invariant`, async () => {
      const res = await simulate(seed, STEPS);
      if (res.problems.length) console.log(`\nREPRO seed=${res.seed} step=${res.step}\n${res.problems.join("\n")}\n--- operations ---\n${res.log.join("\n")}`);
      expect(res.problems).toEqual([]);
    }, 240_000);
  }
});
