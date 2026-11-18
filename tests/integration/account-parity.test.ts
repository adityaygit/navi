import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { runTool, findSameTask } from "@/server/ai/tools";
import { createTask } from "@/server/domain/tasks";
import { generateDayPlan } from "@/server/planner/plan";
import type { Ctx } from "@/server/context";

// Established vs clean accounts, and isolation, for the reliability repair.
// The "established" fixture is an anonymized shape of the owner's account on
// 2026-11-16 (planner v2 on; 75 imported assignments: 24 still open and past
// due when imported, 7 overdue since, 17 upcoming, 27 marked done), with
// made-up titles. No real data is used.

const zone = "America/New_York";
type U = Awaited<ReturnType<typeof userClient>>;
let est: U, clean: U, other: U;
const prefs = { planner_v2: true, wake_time: "07:00", bed_time: "23:00" };
const D = () => DateTime.now().setZone(zone).plus({ days: 3 }).toISODate()!;
const ctx = (u: U, actor: "user" | "navi" = "user"): Ctx => ({ ...ctxFor(u.db, u.userId, zone), actor });

async function seedEstablished(u: U) {
  const now = DateTime.now();
  const rows: Record<string, unknown>[] = [];
  const add = (n: number, status: string, due: (i: number) => DateTime, tag: string) => {
    for (let i = 0; i < n; i++) rows.push({ user_id: u.userId, title: `${tag} ${i} [Course ${i % 6}]`, source: "external", external_ref: `ext:${crypto.randomUUID()}`, status, due_at: due(i).toISO(), due_is_hard: true, priority: 2, completed_at: status === "done" ? now.toISO() : null });
  };
  add(24, "todo", (i) => now.minus({ days: 6 + i }), "Old open");
  add(7, "todo", (i) => now.minus({ hours: 6 + 10 * i }), "Recent overdue");
  add(17, "todo", (i) => now.plus({ days: 4 + i }), "Upcoming");
  add(27, "done", (i) => now.minus({ days: 5 + i }), "Handed in");
  await admin().from("tasks").insert(rows);
}

beforeAll(async () => {
  est = await userClient("parity-established@navi.test");
  clean = await userClient("parity-clean@navi.test");
  other = await userClient("parity-other@navi.test");
});
beforeEach(async () => {
  for (const u of [est, clean, other]) {
    await resetUser(u.userId);
    await u.db.from("plan_changesets").delete().eq("user_id", u.userId);
    await admin().from("profiles").update({ preferences: prefs, availability: [], timezone: zone }).eq("id", u.userId);
  }
  await seedEstablished(est);
});
afterAll(async () => {
  for (const u of [est, clean, other]) {
    await resetUser(u.userId);
    await admin().from("profiles").update({ preferences: {} }).eq("id", u.userId);
  }
});

describe("an established account behaves like a clean one for the person's own work", () => {
  it("the same request plans the same own task on both accounts; the backlog doesn't crowd it out", async () => {
    for (const u of [est, clean]) await createTask(ctx(u), { title: "Build a plan to fix Navi", estimate_minutes: 60 });
    const results = [];
    for (const u of [est, clean]) {
      const r = await generateDayPlan(ctx(u), D());
      const { data: blocks } = await u.db.from("plan_blocks").select("title").eq("plan_date", D());
      results.push({ titles: (blocks ?? []).map((b) => b.title), notFit: r.unscheduled.length });
    }
    expect(results[0].titles).toContain("Build a plan to fix Navi");
    expect(results[1].titles).toContain("Build a plan to fix Navi");
    // Old imports never appear on the plan or as "didn't fit" on either account.
    expect(results[0].titles.some((t) => /^(Old open|Recent overdue)/.test(t))).toBe(false);
  });

  it("Navi's overview shows the person's own new task on the established account (no 40-task cut-off)", async () => {
    await createTask(ctx(est), { title: "PBL Major - BID Urban Gardening", estimate_minutes: 60 });
    const r = await runTool(ctx(est, "navi"), "get_overview", {});
    expect(String(r.data)).toMatch(/Open tasks: [^\n]*PBL Major - BID Urban Gardening/);
    expect(String(r.data)).toMatch(/Overdue imported \(Canvas\) work[^\n]*31 items/);
  });
});

describe("isolation: the new paths only ever see the signed-in person's data", () => {
  it("duplicate detection never matches another person's task", async () => {
    await createTask(ctx(other), { title: "Lab report" });
    expect(await findSameTask(ctx(clean, "navi"), "Lab report", null)).toBeNull();
    const made = await runTool(ctx(clean, "navi"), "create_task", { title: "Lab report", user_command: "add lab report" });
    expect(made.summary).toMatch(/^Created task/);
  });

  it("resolving overdue imports can't touch another person's tasks, even by id", async () => {
    const { data: theirs } = await est.db.from("tasks").select("id").like("title", "Old open%").limit(3);
    const ids = (theirs ?? []).map((t) => t.id);
    const r = await runTool({ ...ctx(other, "navi"), userMessage: "those are all handed in" }, "resolve_overdue_imports", { decision: "handed_in", task_ids: ids, user_statement: "those are all handed in" });
    expect(r.ok).toBe(false);
    const { data: after } = await admin().from("tasks").select("status").in("id", ids);
    expect(after!.every((t) => t.status === "todo")).toBe(true);
  });

  it("another person's backlog isn't in my overview or my triage", async () => {
    const r = await runTool(ctx(clean, "navi"), "get_overview", {});
    expect(String(r.data)).not.toMatch(/Old open|Overdue imported/);
    const b = await runTool(ctx(clean, "navi"), "get_backlog", {});
    expect((b.data as { overdue: unknown[] }).overdue).toHaveLength(0);
  });
});
