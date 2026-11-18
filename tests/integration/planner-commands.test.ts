import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { executeCommand, confirmChange, replan } from "@/server/planner/commands";
import { revertActivities } from "@/server/domain/activity";
import { decideApproval } from "@/server/domain/approvals";
import { placeTask } from "@/server/planner/place";
import type { Ctx } from "@/server/context";
import type { PlanBlock } from "@/lib/types";

// The scheduling-command pipeline end to end on the local database:
// interpret → preview → impact → (challenge once) → authorize → apply (one
// change set) → verify (read back) → report. The person's zone is picked so
// it's morning there and 2 PM today is still ahead.

const CANDIDATE_ZONES = ["Pacific/Kiritimati", "Pacific/Auckland", "Australia/Sydney", "Asia/Tokyo", "Asia/Shanghai", "Asia/Bangkok", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "Europe/Moscow", "Europe/Berlin", "Europe/London", "Atlantic/Azores", "America/Noronha", "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Pacific/Pago_Pago"];
const zone = CANDIDATE_ZONES.find((z) => { const h = DateTime.now().setZone(z).hour; return h >= 7 && h <= 10; }) ?? "UTC";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
let navi: Ctx;
const today = () => DateTime.now().setZone(zone).toISODate()!;
const at = (hm: string) => DateTime.fromISO(`${today()}T${hm}`, { zone });
const hm = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("HH:mm");

async function blocksOn(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}
async function addTask(values: Record<string, unknown>) {
  const { data, error } = await me.db.from("tasks").insert({ user_id: me.userId, ...values }).select("id,title").single();
  if (error) throw error;
  return data as { id: string; title: string };
}
async function canvasBacklog(n = 40) {
  const now = DateTime.now();
  const rows = Array.from({ length: n }, (_, i) => ({ user_id: me.userId, title: `Canvas overdue ${i}`, source: "external", external_ref: `ext:old${i}`, due_is_hard: true, due_at: now.minus({ days: 1 + (i % 30) }).toISO(), status: "todo" }));
  const { error } = await me.db.from("tasks").insert(rows);
  if (error) throw error;
}
async function approvalsOpen() {
  const { count } = await me.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "proposed");
  return count ?? 0;
}

beforeAll(async () => {
  me = await userClient("planner-commands@navi.test");
  user = ctxFor(me.db, me.userId, zone);
  navi = { ...user, actor: "navi", autonomy: "auto" };
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ timezone: zone, availability: [], preferences: { planner_v2: true, planner_commands: true, wake_time: "07:00", bed_time: "23:00", plan_load_cap: 1 } }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});

describe("R1: an explicit placement is a saved block, not a priority flag", () => {
  it("“Put Navi work at 2 PM” saves Navi work at 2 PM, verified, with old Canvas work held for triage", async () => {
    await canvasBacklog();
    const nav = await addTask({ title: "Navi work block", estimate_minutes: 60 });
    const r = await executeCommand({ ...navi, userMessage: "Put Navi work at 2 PM" }, { kind: "schedule_task", task_id: nav.id, start: "14:00" });
    expect(r.status).toBe("applied");
    expect(r.verification?.ok).toBe(true);
    expect(r.summary).toMatch(/Applied and verified/);
    const blocks = await blocksOn(today());
    const b = blocks.find((x) => x.task_id === nav.id)!;
    expect(hm(b.starts_at)).toBe("14:00");
    expect(hm(b.ends_at)).toBe("15:00");
    expect(b.pinned).toBe(true);
    expect(b.placement).toBe("requested");
    // No overdue imported work was planned on its own.
    expect(blocks.filter((x) => x.title.startsWith("Canvas overdue"))).toHaveLength(0);
    // One Undo takes it all back.
    await revertActivities(user, r.undo);
    expect((await blocksOn(today())).some((x) => x.task_id === nav.id)).toBe(false);
  });

  it("over a fixed event it changes nothing and says why, with free times that work", async () => {
    const nav = await addTask({ title: "Navi work block", estimate_minutes: 60 });
    await me.db.from("events").insert({ user_id: me.userId, title: "Dentist", starts_at: at("14:00").toISO(), ends_at: at("15:00").toISO() });
    const r = await executeCommand(navi, { kind: "schedule_task", task_id: nav.id, start: "14:30" });
    expect(r.status).toBe("infeasible");
    expect(r.summary).toMatch(/overlap “Dentist”/);
    expect(r.alternatives?.length).toBeGreaterThan(0);
    expect(await blocksOn(today())).toHaveLength(0);
  });
});

describe("R1/R6: swap, and exclusions that survive re-planning", () => {
  it("puts Navi work in Algebra's slot, takes Algebra off today (task kept), and a re-plan doesn't bring it back", async () => {
    const algebra = await addTask({ title: "Algebra Unit 4 Quiz", estimate_minutes: 60, due_is_hard: true, due_at: DateTime.now().plus({ days: 4 }).toISO() });
    const nav = await addTask({ title: "Navi work block", estimate_minutes: 60 });
    await replan(user, [today()], { trigger: "button" });
    const alg = (await blocksOn(today())).find((b) => b.task_id === algebra.id)!;
    expect(alg).toBeTruthy();
    const r = await executeCommand({ ...navi, userMessage: "Put Navi work where Algebra is and take Algebra off today" }, { kind: "swap", place_task_id: nav.id, remove_task_id: algebra.id });
    expect(r.status).toBe("applied");
    expect(r.verification?.ok).toBe(true);
    let blocks = await blocksOn(today());
    expect(blocks.find((b) => b.task_id === nav.id)!.starts_at).toBe(alg.starts_at);
    expect(blocks.some((b) => b.task_id === algebra.id)).toBe(false);
    expect((await me.db.from("tasks").select("status").eq("id", algebra.id).single()).data!.status).toBe("todo");
    // Re-planning (button, chat, morning tick) respects the exclusion.
    await replan(user, [today()], { trigger: "button" });
    await replan({ ...user, actor: "system" }, [today()], { trigger: "tick" });
    blocks = await blocksOn(today());
    expect(blocks.some((b) => b.task_id === algebra.id)).toBe(false);
    expect(blocks.some((b) => b.task_id === nav.id)).toBe(true);
  });
});

describe("R4: clearing a day", () => {
  async function setupDay(withMust = false) {
    const rows = [];
    for (let i = 0; i < 13; i++) {
      const t = await addTask({ title: `Study ${i}`, estimate_minutes: 25, ...(withMust && i === 0 ? { commitment: "must" } : {}) });
      const s = at("11:00").plus({ minutes: i * 30 });
      rows.push({ user_id: me.userId, task_id: t.id, title: `Study ${i}`, plan_date: today(), starts_at: s.toISO(), ends_at: s.plus({ minutes: 25 }).toISO(), is_flexible: true, created_by: "navi", status: "planned" });
    }
    await me.db.from("plan_blocks").insert(rows);
    await me.db.from("events").insert({ user_id: me.userId, title: "Practice", starts_at: at("18:00").toISO(), ends_at: at("19:00").toISO() });
    const mine = await addTask({ title: "Piano", estimate_minutes: 30 });
    await placeTask(user, { taskId: mine.id, startsAt: at("09:30").plus({ hours: 12 }).toISO(), minutes: 30 });
  }

  it("is one coherent change: 13 blocks off, tasks kept, the event and the person's own block stay, one Undo", async () => {
    await setupDay();
    const r = await executeCommand({ ...navi, userMessage: "clear my full schedule today" }, { kind: "clear_day" });
    expect(r.status).toBe("applied");
    expect(r.verification?.ok).toBe(true);
    expect(await approvalsOpen()).toBe(0);
    const blocks = await blocksOn(today());
    expect(blocks.filter((b) => b.title.startsWith("Study"))).toHaveLength(0);
    expect(blocks.some((b) => b.title === "Piano")).toBe(true);
    const { count } = await me.db.from("tasks").select("id", { count: "exact", head: true }).like("title", "Study%").eq("status", "todo");
    expect(count).toBe(13);
    // It stays clear: a re-plan doesn't refill it with the same work.
    await replan(user, [today()], { trigger: "button" });
    expect((await blocksOn(today())).filter((b) => b.title.startsWith("Study"))).toHaveLength(0);
    // One Undo brings all 13 back (the re-plan didn't touch them, so nothing blocks it).
    const { data: log } = await me.db.from("activity_log").select("id").eq("action", "plan_applied").eq("entity_id", r.changesetId!).single();
    await revertActivities(user, [log!.id]);
    expect((await blocksOn(today())).filter((b) => b.title.startsWith("Study"))).toHaveLength(13);
  });

  it("with must-do work in it, it's ONE card listing the consequence; approving runs it once and checks it", async () => {
    await setupDay(true);
    const r = await executeCommand({ ...navi, userMessage: "clear my day" }, { kind: "clear_day" });
    expect(r.status).toBe("proposed");
    expect(await approvalsOpen()).toBe(1);
    expect(r.impact?.consequences.some((c) => c.key.startsWith("must:"))).toBe(true);
    expect((await blocksOn(today())).filter((b) => b.title.startsWith("Study"))).toHaveLength(13);
    const a = await decideApproval(user, r.actionId!, "approve");
    expect(a.status).toBe("completed");
    expect(String((a.result as { summary: string }).summary)).toMatch(/Applied and checked/);
    const again = await decideApproval(user, r.actionId!, "approve");
    expect(again.status).toBe("completed");
    expect((await blocksOn(today())).filter((b) => b.title.startsWith("Study"))).toHaveLength(0);
  });
});

describe("D6 authorization, R13 staleness, idempotency", () => {
  it("high impact needs the person's own words naming the consequence; a generic go-ahead isn't enough", async () => {
    const quiz = await addTask({ title: "Chem quiz prep", estimate_minutes: 45, due_is_hard: true, due_at: DateTime.now().plus({ hours: 20 }).toISO() });
    await replan(user, [today()], { trigger: "button" });
    const first = await executeCommand({ ...navi, userMessage: "just do whatever" }, { kind: "unschedule", task_ids: [quiz.id] }, { reaffirmed: true });
    expect(first.status).toBe("proposed");
    const key = first.impact!.consequences.find((c) => c.level === "high")!.key;
    await me.db.from("approvals").update({ status: "declined" }).eq("id", first.actionId!);
    const quote = "take chem quiz prep off today, I know it's due tomorrow";
    const ok = await executeCommand({ ...navi, userMessage: quote }, { kind: "unschedule", task_ids: [quiz.id] }, { authorize: [key], userQuote: "take chem quiz prep off today", reaffirmed: true });
    expect(ok.status).toBe("applied");
    expect((await blocksOn(today())).some((b) => b.task_id === quiz.id)).toBe(false);
  });

  it("a preview approved after the person changed the day expires instead of overlapping it", async () => {
    await addTask({ title: "Essay", estimate_minutes: 45 });
    const piano = await addTask({ title: "Piano", estimate_minutes: 30 });
    const r = await executeCommand(navi, { kind: "replan", dates: [today()] }, { mode: "preview" });
    expect(r.status).toBe("proposed");
    const { data: cs } = await me.db.from("plan_changesets").select("ops").eq("id", r.changesetId!).single();
    const ins = (cs!.ops as { op: string; block?: { starts_at: string } }[]).find((o) => o.op === "insert")!;
    await placeTask(user, { taskId: piano.id, startsAt: ins.block!.starts_at, minutes: 30 });
    const a = await decideApproval(user, r.actionId!, "approve");
    expect(a.status).toBe("expired");
    const blocks = await blocksOn(today());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe("Piano");
  });

  it("the same request (same key) runs once", async () => {
    const t = await addTask({ title: "Read chapter 4", estimate_minutes: 30 });
    const a = await executeCommand(navi, { kind: "schedule_task", task_id: t.id, start: "15:00" }, { idempotencyKey: "turn-1:schedule" });
    const b = await executeCommand(navi, { kind: "schedule_task", task_id: t.id, start: "15:00" }, { idempotencyKey: "turn-1:schedule" });
    expect(a.status).toBe("applied");
    expect(b.status).toBe("duplicate");
    expect((await blocksOn(today())).filter((x) => x.task_id === t.id)).toHaveLength(1);
  });
});

describe("conversational approval resolves to exactly one shown proposal", () => {
  async function offer(conversationId: string, title: string, start: string, date: "today" | "tomorrow" = "today") {
    const t = await addTask({ title, estimate_minutes: 30 });
    return executeCommand({ ...navi, conversationId }, { kind: "schedule_task", task_id: t.id, start, date }, { mode: "preview" });
  }
  async function conversation() {
    const { data } = await me.db.from("conversations").insert({ user_id: me.userId, kind: "chat" }).select("id").single();
    return data!.id as string;
  }
  const later = () => new Date(Date.now() + 1000).toISOString();

  it("“yes” applies the one pending offer it refers to", async () => {
    const c = await conversation();
    const o = await offer(c, "Bio notes", "16:00");
    expect(o.status).toBe("proposed");
    const r = await confirmChange({ ...navi, conversationId: c, userMessage: "yes please", turnStartedAt: later() });
    expect(r.ok).toBe(true);
    expect((await blocksOn(today())).some((b) => b.title === "Bio notes")).toBe(true);
  });

  it("a newer offer for the same day replaces the older one (its card expires); “yes” means the newer", async () => {
    const c = await conversation();
    const old = await offer(c, "Bio notes", "16:00");
    await offer(c, "Spanish", "17:00");
    expect((await me.db.from("approvals").select("status").eq("id", old.actionId!).single()).data!.status).toBe("expired");
    const r = await confirmChange({ ...navi, conversationId: c, userMessage: "yes", turnStartedAt: later() });
    expect(r.ok).toBe(true);
    const blocks = await blocksOn(today());
    expect(blocks.map((b) => b.title)).toEqual(["Spanish"]);
    expect(hm(blocks[0].starts_at)).toBe("17:00");
  });

  it("two pending offers (different days): “yes” approves nothing and asks which", async () => {
    const c = await conversation();
    await offer(c, "Bio notes", "16:00");
    await offer(c, "Spanish", "17:00", "tomorrow");
    const r = await confirmChange({ ...navi, conversationId: c, userMessage: "yes", turnStartedAt: later() });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/2 changes are waiting/);
    expect(await blocksOn(today())).toHaveLength(0);
  });

  it("a “no”, or an offer made in this same turn, is never treated as a yes", async () => {
    const c = await conversation();
    await offer(c, "Bio notes", "16:00");
    expect((await confirmChange({ ...navi, conversationId: c, userMessage: "no, don't", turnStartedAt: later() })).ok).toBe(false);
    expect((await confirmChange({ ...navi, conversationId: c, userMessage: "yes", turnStartedAt: new Date(Date.now() - 60_000).toISOString() })).ok).toBe(false);
    expect(await blocksOn(today())).toHaveLength(0);
  });
});

describe("grouped work sessions move and resize as a unit; each task keeps its identity", () => {
  it("groups three tasks back to back, moves them together, resizes them proportionally, and Undo restores", async () => {
    const a = await addTask({ title: "Pneumatic sketch", estimate_minutes: 30 });
    const b = await addTask({ title: "CAD model", estimate_minutes: 60 });
    const c = await addTask({ title: "Isometric sketch", estimate_minutes: 30 });
    const g = await executeCommand(navi, { kind: "group_session", task_ids: [a.id, b.id, c.id], start: "13:00", title: "Engineering PBL" });
    expect(g.status).toBe("applied");
    let blocks = (await blocksOn(today())).filter((x) => x.session_id);
    expect(blocks.map((x) => [hm(x.starts_at), hm(x.ends_at)])).toEqual([["13:00", "13:30"], ["13:30", "14:30"], ["14:30", "15:00"]]);
    expect(new Set(blocks.map((x) => x.session_id)).size).toBe(1);
    const m = await executeCommand(navi, { kind: "move_block", block_id: blocks[1].id, start: "16:00" });
    expect(m.status).toBe("applied");
    expect(m.verification?.ok).toBe(true);
    blocks = (await blocksOn(today())).filter((x) => x.session_id);
    // The CAD block (13:30) moved to 4 PM: the whole session moved by the same amount.
    expect(blocks.map((x) => hm(x.starts_at))).toEqual(["15:30", "16:00", "17:00"]);
    const r = await executeCommand(navi, { kind: "resize_block", block_id: blocks[0].id, minutes: 60 });
    expect(r.status).toBe("applied");
    blocks = (await blocksOn(today())).filter((x) => x.session_id);
    expect(blocks.map((x) => [hm(x.starts_at), hm(x.ends_at)])).toEqual([["15:30", "15:45"], ["15:45", "16:15"], ["16:15", "16:30"]]);
    expect(blocks.map((x) => x.task_id)).toEqual([a.id, b.id, c.id]);
    const { data: open } = await me.db.from("tasks").select("status").in("id", [a.id, b.id, c.id]);
    expect(open!.every((t) => t.status === "todo")).toBe(true);
    await revertActivities(user, r.undo);
    blocks = (await blocksOn(today())).filter((x) => x.session_id);
    expect(blocks.map((x) => hm(x.starts_at))).toEqual(["15:30", "16:00", "17:00"]);
  });
});

describe("R9: accountability challenges once, then respects the choice", () => {
  it("a repeatedly skipped task: one challenge (nothing changes), then the reaffirmed choice runs; never asked twice", async () => {
    const chem = await addTask({ title: "Chemistry Unit 3 review", estimate_minutes: 30 });
    const past = DateTime.now().setZone(zone).minus({ days: 3 });
    await me.db.from("plan_blocks").insert([1, 2, 3].map((i) => ({ user_id: me.userId, task_id: chem.id, title: "Chemistry Unit 3 review", plan_date: past.minus({ days: i }).toISODate(), starts_at: past.minus({ days: i }).toISO(), ends_at: past.minus({ days: i }).plus({ minutes: 30 }).toISO(), status: "skipped", outcome_reason: "Avoided it" })));
    await replan(user, [today()], { trigger: "button" });
    const first = await executeCommand({ ...navi, userMessage: "skip chemistry today" }, { kind: "unschedule", task_ids: [chem.id] });
    expect(first.status).toBe("challenged");
    expect(first.summary).toMatch(/skipped 3 times/);
    expect((await blocksOn(today())).some((b) => b.task_id === chem.id)).toBe(true);
    const second = await executeCommand({ ...navi, userMessage: "move it anyway" }, { kind: "unschedule", task_ids: [chem.id] });
    expect(second.status).toBe("applied");
    expect((await blocksOn(today())).some((b) => b.task_id === chem.id)).toBe(false);
    const { data } = await me.db.from("accountability_checks").select("status").eq("task_id", chem.id);
    expect(data).toEqual([{ status: "reaffirmed" }]);
  });

  it("the person's own direct edits are never challenged", async () => {
    const chem = await addTask({ title: "Chemistry", estimate_minutes: 30, commitment: "must" });
    await replan(user, [today()], { trigger: "button" });
    const r = await executeCommand(user, { kind: "unschedule", task_ids: [chem.id] });
    expect(r.status).toBe("applied");
  });
});

describe("D5: planning rules with source, scope and the person's control", () => {
  it("a stated rule applies at once; an inferred one is only a suggestion until confirmed; both can be removed", async () => {
    const { runTool } = await import("@/server/ai/tools");
    const ela = await addTask({ title: "ELA essay", estimate_minutes: 60 });
    const said = "ELA stuff always takes me 50% longer";
    const stated = await runTool({ ...navi, userMessage: said }, "learn_planning_rule", { kind: "estimate_scale", scope: "task", scope_id: ela.id, factor: 1.5, origin: "stated", user_quote: "always takes me 50% longer" });
    expect(stated.ok).toBe(true);
    await replan(user, [today()], { trigger: "button" });
    const minutes = (await blocksOn(today())).filter((b) => b.task_id === ela.id).reduce((s, b) => s + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000, 0);
    expect(minutes).toBe(90);
    // A guess (or a "stated" rule whose quote isn't the person's words) is only a suggestion.
    const guess = await runTool({ ...navi, userMessage: "plan my day" }, "learn_planning_rule", { kind: "daily_load_cap", scope: "global", cap: 0.3, origin: "stated", user_quote: "only fill 30%" });
    expect(guess.summary).toMatch(/suggestion/);
    const list = await runTool(navi, "list_planning_rules", {});
    const rules = list.data as { id: string; status: string; source: string }[];
    expect(rules.map((r) => r.status).sort()).toEqual(["active", "suggested"]);
    const suggested = rules.find((r) => r.status === "suggested")!;
    await runTool({ ...navi, userMessage: "yes, keep that" }, "update_planning_rule", { id: suggested.id, action: "confirm" });
    expect((await me.db.from("planning_rules").select("status").eq("id", suggested.id).single()).data!.status).toBe("active");
    for (const r of rules) await runTool(navi, "update_planning_rule", { id: r.id, action: "remove" });
    expect((await me.db.from("planning_rules").select("id")).data).toHaveLength(0);
  });
});

describe("concurrency", () => {
  it("two placements in the same slot at the same moment: one is saved, the other changes nothing and says why", async () => {
    const a = await addTask({ title: "Essay", estimate_minutes: 60 });
    const b = await addTask({ title: "Lab report", estimate_minutes: 60 });
    const [ra, rb] = await Promise.all([
      executeCommand(navi, { kind: "schedule_task", task_id: a.id, start: "14:00" }),
      executeCommand(navi, { kind: "schedule_task", task_id: b.id, start: "14:00" }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual(["applied", "infeasible"]);
    const blocks = await blocksOn(today());
    expect(blocks).toHaveLength(1);
    expect(hm(blocks[0].starts_at)).toBe("14:00");
  });

  it("a re-plan and a placement at the same moment never double-book or overlap", async () => {
    for (const t of ["Reading", "Spanish", "Piano practice"]) await addTask({ title: t, estimate_minutes: 45 });
    const nav = await addTask({ title: "Navi work block", estimate_minutes: 60 });
    await Promise.all([replan(user, [today()], { trigger: "button" }), executeCommand(navi, { kind: "schedule_task", task_id: nav.id, start: "12:00" })]);
    const blocks = await blocksOn(today());
    const overlaps = blocks.some((x) => blocks.some((y) => x.id !== y.id && Date.parse(x.starts_at) < Date.parse(y.ends_at) && Date.parse(y.starts_at) < Date.parse(x.ends_at)));
    expect(overlaps).toBe(false);
    expect(new Set(blocks.map((x) => x.task_id)).size).toBe(blocks.length);
    expect(hm(blocks.find((x) => x.task_id === nav.id)!.starts_at)).toBe("12:00");
  });
});

describe("realistic overload with a Canvas-heavy list", () => {
  it("70 imported items + 10 h of the person's own work in a short day: must-do first, no backlog planned, honest counts", async () => {
    await canvasBacklog(40);
    const now = DateTime.now();
    await me.db.from("tasks").insert(Array.from({ length: 30 }, (_, i) => ({ user_id: me.userId, title: `Canvas future ${i}`, source: "external", external_ref: `ext:new${i}`, due_is_hard: true, due_at: now.plus({ days: 5 + i }).toISO(), status: "todo" })));
    // Only 3–8 PM free today (one-day fact), and 10 hours of the person's own work, two of it must-do.
    const mustA = await addTask({ title: "Physics lab writeup", estimate_minutes: 120, commitment: "must" });
    const mustB = await addTask({ title: "History essay draft", estimate_minutes: 90, commitment: "must" });
    for (let i = 0; i < 6; i++) await addTask({ title: `Own task ${i}`, estimate_minutes: 65 });
    const r = await executeCommand(navi, { kind: "replan", dates: [today()], exceptions: [{ kind: "busy", start_time: "07:00", end_time: "15:00", note: "school" }] });
    expect(r.status).toBe("applied");
    const blocks = await blocksOn(today());
    const minutesOf = (id: string) => blocks.filter((b) => b.task_id === id).reduce((s, b) => s + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000, 0);
    expect(minutesOf(mustA.id)).toBe(120);
    expect(minutesOf(mustB.id)).toBe(90);
    // Overdue imports are never planned on their own; upcoming imported deadlines within the
    // week may be (deadline-aware), but only after the person's must-do work.
    expect(blocks.some((b) => b.title.startsWith("Canvas overdue"))).toBe(false);
    const { data: soon } = await me.db.from("tasks").select("id").like("title", "Canvas future%").lte("due_at", DateTime.now().plus({ days: 7 }).toISO());
    const soonIds = new Set((soon ?? []).map((t) => t.id));
    expect(blocks.filter((b) => b.title.startsWith("Canvas future")).every((b) => soonIds.has(b.task_id!))).toBe(true);
    const firstImported = blocks.find((b) => b.title.startsWith("Canvas"));
    const lastMust = blocks.filter((b) => b.task_id === mustA.id || b.task_id === mustB.id).at(-1)!;
    if (firstImported) expect(Date.parse(firstImported.starts_at)).toBeGreaterThanOrEqual(Date.parse(lastMust.ends_at));
    const result = r.run!.results[0];
    expect(result.triage).toHaveLength(40);
    // Future Canvas work and the person's undated tasks wait for later days; none of it is "didn't fit today".
    expect(r.view.leftover?.line ?? "").not.toMatch(/\b\d{2,} things didn't fit/);
    // Nothing was shortened: placed + still to do = each estimate.
    for (const u of result.unscheduled.filter((x) => x.title.startsWith("Own task"))) expect(minutesOf(u.task_id) + u.remaining_minutes).toBe(65);
  });
});

describe("row level security on the new tables", () => {
  it("another person can't read or write someone's scope, rules or accountability records, nor fingerprint their plan", async () => {
    const t = await addTask({ title: "Private", estimate_minutes: 30 });
    await executeCommand(user, { kind: "set_scope", mode: "exclude", task_ids: [t.id] });
    await me.db.from("planning_rules").insert({ user_id: me.userId, kind: "daily_load_cap", scope: "global", params: { cap: 0.5 }, source: "stated" });
    await me.db.from("accountability_checks").insert({ user_id: me.userId, task_id: t.id, decision: "exclude", context_key: "k1", challenge: "c" });
    const other = await userClient("planner-commands-other@navi.test");
    for (const table of ["day_plan_scope", "planning_rules", "accountability_checks"]) {
      expect((await other.db.from(table).select("id")).data).toEqual([]);
      const ins = await other.db.from(table).insert(table === "day_plan_scope" ? { user_id: me.userId, date: today(), task_id: t.id, mode: "only" } : table === "planning_rules" ? { user_id: me.userId, kind: "daily_load_cap", scope: "global", params: { cap: 0.2 }, source: "stated" } : { user_id: me.userId, decision: "exclude", context_key: "x", challenge: "c" });
      expect(ins.error).toBeTruthy();
    }
    const mine = await me.db.rpc("plan_inputs_version", { p_user: me.userId, p_dates: [today()] });
    const theirs = await other.db.rpc("plan_inputs_version", { p_user: me.userId, p_dates: [today()] });
    const empty = await other.db.rpc("plan_inputs_version", { p_user: other.userId, p_dates: [today()] });
    expect(theirs.data).toBe(empty.data);
    expect(theirs.data).not.toBe(mine.data);
  });
});
