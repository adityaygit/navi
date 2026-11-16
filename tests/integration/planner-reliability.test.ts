import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { runTool } from "@/server/ai/tools";
import { decideApproval } from "@/server/domain/approvals";
import { placeTask } from "@/server/planner/place";
import type { Ctx } from "@/server/context";
import type { PlanBlock } from "@/lib/types";

// Planner reliability overhaul: the historical failures (R1–R14 from the
// planner audit handoff) reproduced end to end on the local database, through
// the same tool registry chat and voice use. The person's zone is picked so
// it's morning there now and "today" has room.

const CANDIDATE_ZONES = ["Pacific/Kiritimati", "Pacific/Auckland", "Australia/Sydney", "Asia/Tokyo", "Asia/Shanghai", "Asia/Bangkok", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "Europe/Moscow", "Europe/Berlin", "Europe/London", "Atlantic/Azores", "America/Noronha", "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Pacific/Pago_Pago"];
const zone = CANDIDATE_ZONES.find((z) => { const h = DateTime.now().setZone(z).hour; return h >= 7 && h <= 10; }) ?? "UTC";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
let navi: Ctx;
const today = () => DateTime.now().setZone(zone).toISODate()!;

async function blocksOn(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}
async function addTask(values: Record<string, unknown>) {
  const { data, error } = await me.db.from("tasks").insert({ user_id: me.userId, ...values }).select("id,title").single();
  if (error) throw error;
  return data as { id: string; title: string };
}
/** Imported Canvas-like backlog: hard deadlines, many already overdue. */
async function canvasBacklog(n = 40) {
  const now = DateTime.now();
  const rows = Array.from({ length: n }, (_, i) => ({ user_id: me.userId, title: `Canvas overdue ${i}`, source: "external", external_ref: `ext:old${i}`, due_is_hard: true, due_at: now.minus({ days: 1 + (i % 30) }).toISO(), status: "todo" }));
  const { error } = await me.db.from("tasks").insert(rows);
  if (error) throw error;
}

beforeAll(async () => {
  me = await userClient("planner-reliability@navi.test");
  user = ctxFor(me.db, me.userId, zone);
  navi = { ...user, actor: "navi", autonomy: "auto" };
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ timezone: zone, availability: [], preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00", plan_load_cap: 1 } }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

describe("R1 (current failure): an explicit placement request becomes a must-do flag", () => {
  it.fails("“Put Navi work on today's plan” ends with Navi work actually planned today", async () => {
    await canvasBacklog();
    const navWork = await addTask({ title: "Navi work block", estimate_minutes: 60 });
    // What the documented tool path does today: mark it must-do, then re-plan.
    const marked = await runTool({ ...navi, userMessage: "Put Navi work on today's plan" }, "update_task", { id: navWork.id, commitment: "must" });
    expect(marked.display).toMatch(/must-do/);
    await runTool(navi, "plan", {});
    const blocks = await blocksOn(today());
    expect(blocks.some((b) => b.task_id === navWork.id)).toBe(true);
  });
});

describe("R4 (current failure): clearing a day takes one card per block", () => {
  it.fails("removing 13 planned blocks is one coherent action, not 13 cards", async () => {
    const rows = Array.from({ length: 13 }, (_, i) => {
      const s = DateTime.now().setZone(zone).startOf("hour").plus({ hours: 1, minutes: i * 30 });
      return { user_id: me.userId, title: `Study ${i}`, plan_date: today(), starts_at: s.toISO(), ends_at: s.plus({ minutes: 25 }).toISO(), is_flexible: true, created_by: "navi", status: "planned" };
    });
    const { data } = await me.db.from("plan_blocks").insert(rows).select("id");
    for (const b of data ?? []) await runTool(navi, "delete_item", { table: "plan_blocks", id: b.id });
    const { count } = await me.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "proposed");
    expect(count).toBeLessThanOrEqual(1);
  });
});

describe("R6 (current failure): work taken off today comes back on the next re-plan", () => {
  it.fails("a task removed from today's plan stays off it when the day is re-planned", async () => {
    const algebra = await addTask({ title: "Algebra Unit 4 Quiz", estimate_minutes: 45, due_is_hard: true, due_at: DateTime.now().plus({ days: 2 }).toISO() });
    await runTool(navi, "plan", {});
    const block = (await blocksOn(today())).find((b) => b.task_id === algebra.id)!;
    expect(block).toBeTruthy();
    const card = await runTool(navi, "delete_item", { table: "plan_blocks", id: block.id });
    await decideApproval(user, card.actionId!, "approve");
    await runTool(navi, "plan", {});
    expect((await blocksOn(today())).some((b) => b.task_id === algebra.id)).toBe(false);
  });
});

describe("R13 (current failure): an approved proposal ignores a block the person placed since", () => {
  it.fails("approving a plan made before a manual change doesn't overlap that change", async () => {
    await addTask({ title: "Essay", estimate_minutes: 45 });
    const own = await addTask({ title: "Piano", estimate_minutes: 30 });
    const proposed = await runTool({ ...navi, autonomy: "ask" }, "plan", {});
    expect(proposed.actionId).toBeTruthy();
    const { data: cs } = await me.db.from("plan_changesets").select("ops").eq("status", "proposed").single();
    const insert = (cs!.ops as { op: string; block?: { starts_at: string } }[]).find((o) => o.op === "insert")!;
    // The person puts Piano exactly where the proposal would put the essay.
    await placeTask(user, { taskId: own.id, startsAt: insert.block!.starts_at, minutes: 30 });
    await decideApproval(user, proposed.actionId!, "approve");
    const blocks = await blocksOn(today());
    const overlaps = blocks.some((a) => blocks.some((b) => a.id !== b.id && Date.parse(a.starts_at) < Date.parse(b.ends_at) && Date.parse(b.starts_at) < Date.parse(a.ends_at)));
    expect(overlaps).toBe(false);
  });
});
