import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { handleTurn } from "@/server/ai/chat";
import { acceptMany, acceptProposal, setProposalStatus } from "@/server/domain/proposals";
import { generateDayPlan, generateWeekPlan, recoverPlan, setBlockOutcome } from "@/server/planner/plan";
import { processCapture, saveCapture } from "@/server/domain/capture";
import { createTask } from "@/server/domain/tasks";
import { deleteEntity, updateEntity } from "@/server/domain/entities";
import { decideApproval } from "@/server/domain/approvals";
import { saveBriefing } from "@/server/jobs/briefings";
import { assertBudget, budgetDay, BudgetExceededError } from "@/server/ai/budget";
import type { Profile } from "@/lib/types";

// Exercises the real domain layer against the local database with the
// development simulator standing in for the model (no provider calls).

let db: Awaited<ReturnType<typeof userClient>>["db"];
let userId: string;
const zone = "America/New_York";

beforeAll(async () => {
  ({ db, userId } = await userClient("dev@navi.test"));
  await resetUser(userId);
});

describe("conversational onboarding", () => {
  it("asks questions, then proposes a setup that only activates after review", async () => {
    const ctx = ctxFor(db, userId, zone);
    const first = await handleTurn(ctx, { kind: "onboarding", text: "hi", modality: "text" });
    expect(first.assistantMessage.content).toMatch(/main areas of your life/i);
    await handleTurn(ctx, { kind: "onboarding", text: "I'm in school and run a small startup. For my startup I'm working on an app called Tally. My goal is to get an A in chemistry class. I need to finish my history essay by friday and email investors tomorrow.", modality: "text" });
    await handleTurn(ctx, { kind: "onboarding", text: "I have soccer practice mon and wed at 4pm. Classes weekdays at 8am. I go to the gym every morning at 7.", modality: "voice" });
    const last = await handleTurn(ctx, { kind: "onboarding", text: "I'm free after 6pm on weekdays. Quiet 10pm to 7am. That's it.", modality: "text" });
    expect(last.assistantMessage.tool_events.map((e) => e.name)).toContain("propose_items");

    const { data: profile } = await db.from("profiles").select("*").eq("id", userId).single();
    expect(profile.onboarding_status).toBe("reviewing");
    const { data: proposals } = await db.from("proposals").select("*").eq("batch", "onboarding").eq("status", "pending");
    const kinds = new Set(proposals!.map((p) => p.kind));
    expect(kinds).toContain("workspace");
    expect(kinds).toContain("event");
    expect(kinds).toContain("task");
    expect(kinds).toContain("preference");
    expect(kinds).toContain("goal");
    expect(kinds).toContain("project");
    expect(kinds).toContain("routine");
    // Nothing is active before review.
    const { count: tasksBefore } = await db.from("tasks").select("id", { count: "exact", head: true });
    expect(tasksBefore).toBe(0);

    // The user approves everything except one task, which stays in review.
    const keepForLater = proposals!.find((p) => p.kind === "task")!;
    const results = await acceptMany(ctx, proposals!.filter((p) => p.id !== keepForLater.id).map((p) => p.id));
    expect(results.filter((r) => !r.ok)).toEqual([]);
    const week = await generateWeekPlan(ctx);

    const [{ data: ws }, { data: events }, { data: tasks }, { data: prof2 }, { data: pending }] = await Promise.all([
      db.from("workspaces").select("name"),
      db.from("events").select("title,recurrence"),
      db.from("tasks").select("title,workspace_id,source"),
      db.from("profiles").select("availability,quiet_hours_start,quiet_hours_end").eq("id", userId).single(),
      db.from("proposals").select("id").eq("id", keepForLater.id).eq("status", "pending"),
    ]);
    expect(ws!.map((w) => w.name)).toEqual(expect.arrayContaining(["School", "Startups", "Fitness"]));
    expect(events!.some((e) => /soccer practice/i.test(e.title) && e.recurrence?.days?.join() === "1,3")).toBe(true);
    expect(tasks!.length).toBeGreaterThan(0);
    expect(tasks!.every((t) => t.source === "onboarding" && t.workspace_id)).toBe(true);
    expect(prof2!.availability[0]).toMatchObject({ days: [1, 2, 3, 4, 5], start: "18:00" });
    const [{ data: goals }, { data: projects }, { data: routines }] = await Promise.all([
      db.from("goals").select("title,workspaces(name)"),
      db.from("projects").select("name,workspaces(name)"),
      db.from("routines").select("title,start_time,days,is_fixed"),
    ]);
    expect(goals).toEqual([{ title: "Get an A in chemistry class", workspaces: { name: "School" } }]);
    expect(projects).toEqual([{ name: "Tally", workspaces: { name: "Startups" } }]);
    expect(routines).toEqual([{ title: "Go to the gym", start_time: "07:00:00", days: [0, 1, 2, 3, 4, 5, 6], is_fixed: false }]);
    expect(prof2!.quiet_hours_start).toBe("22:00:00");
    expect(pending).toHaveLength(1);
    expect(week.reduce((s, d) => s + d.blocks.length, 0)).toBeGreaterThan(0);
  });

  it("shares one history between text and voice turns", async () => {
    const { data: p } = await db.from("profiles").select("onboarding_conversation_id").eq("id", userId).single();
    const { data: msgs } = await db.from("messages").select("modality").eq("conversation_id", p!.onboarding_conversation_id);
    expect(new Set(msgs!.map((m) => m.modality))).toEqual(new Set(["text", "voice"]));
  });
});

describe("capture → review inbox", () => {
  it("stores raw words once, proposes items, and creates nothing until accepted", async () => {
    const ctx = ctxFor(db, userId, zone);
    const clientId = `test-${Date.now()}`;
    const raw = "need to buy running shoes tomorrow. call grandma on sunday";
    const first = await saveCapture(ctx, { client_id: clientId, raw_text: raw, source: "offline" });
    const again = await saveCapture(ctx, { client_id: clientId, raw_text: raw, source: "offline" });
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.capture.id).toBe(first.capture.id);

    const { count: before } = await db.from("tasks").select("id", { count: "exact", head: true });
    await processCapture(ctx, first.capture.id);
    const { data: proposals } = await db.from("proposals").select("*").eq("capture_id", first.capture.id);
    expect(proposals!.length).toBe(2);
    expect(proposals!.every((p) => p.status === "pending" && p.source_excerpt)).toBe(true);
    const { count: mid } = await db.from("tasks").select("id", { count: "exact", head: true });
    expect(mid).toBe(before);

    const shoes = proposals!.find((p) => /shoes/i.test(p.source_excerpt))!;
    const grandma = proposals!.find((p) => /grandma/i.test(p.source_excerpt))!;
    const accepted = await acceptProposal(ctx, shoes.id, { estimate_minutes: 40 });
    await setProposalStatus(ctx, grandma.id, "rejected");
    const { data: task } = await db.from("tasks").select("*").eq("id", accepted.result_id).single();
    expect(task.title).toMatch(/running shoes/i);
    expect(task.estimate_minutes).toBe(40);
    expect(task.source).toBe("capture");
    const { data: cap } = await db.from("captures").select("raw_text").eq("id", first.capture.id).single();
    expect(cap!.raw_text).toBe(raw);
  });
});

describe("approval boundary", () => {
  it("routes Navi's destructive and hard-deadline changes to approval and executes exactly once", async () => {
    const user = ctxFor(db, userId, zone);
    const navi = { ...user, actor: "navi" as const };
    const t = await createTask(user, { title: "Submit application", due_at: DateTime.now().plus({ days: 3 }).toISO(), due_is_hard: true });

    const moved = await updateEntity(navi, "tasks", t.id, { due_at: DateTime.now().plus({ days: 10 }).toISO() });
    expect(moved.kind).toBe("approval_requested");
    const del = await deleteEntity(navi, "tasks", t.id);
    expect(del.kind).toBe("approval_requested");
    const dup = await deleteEntity(navi, "tasks", t.id);
    expect(dup).toEqual(del); // duplicate request reuses the pending approval

    const { data: stillThere } = await db.from("tasks").select("id,due_at").eq("id", t.id).single();
    expect(stillThere!.due_at).toBe(t.due_at);

    const approvalId = (del as { approvalId: string }).approvalId;
    const done = await decideApproval(user, approvalId, "approve", admin());
    expect(done.status).toBe("executed");
    await expect(decideApproval(user, approvalId, "approve", admin())).rejects.toThrow(/already decided/);
    const { data: gone } = await db.from("tasks").select("id").eq("id", t.id);
    expect(gone).toHaveLength(0);
  });

  it("never pretends an external action happened when the service isn't connected", async () => {
    const user = ctxFor(db, userId, zone);
    const { requestApproval } = await import("@/server/domain/approvals");
    const a = await requestApproval({ ...user, actor: "navi" }, { actionType: "external.gmail.send", summary: "Email coach about Saturday", details: { to: "coach@example.com" } });
    const r = await decideApproval(user, a.id, "approve", admin());
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/isn't connected/);
  });

  it("refuses to let Navi mark work completed", async () => {
    const navi = { ...ctxFor(db, userId, zone), actor: "navi" as const };
    const start = DateTime.now().setZone(zone);
    const { data: block, error } = await db
      .from("plan_blocks")
      .insert({ user_id: userId, title: "Block", plan_date: start.toISODate(), starts_at: start.toISO(), ends_at: start.plus({ minutes: 30 }).toISO() })
      .select("id")
      .single();
    expect(error).toBeNull();
    await expect(setBlockOutcome(navi, block!.id, "done")).rejects.toThrow(/only you/i);
    const { data: after } = await db.from("plan_blocks").select("status").eq("id", block!.id).single();
    expect(after!.status).toBe("planned");
  });
});

describe("plan recovery", () => {
  it("keeps unfinished work and records the disruption", async () => {
    const ctx = ctxFor(db, userId, zone);
    await db.from("profiles").update({ availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }] }).eq("id", userId);
    await createTask(ctx, { title: "Recovery test task", estimate_minutes: 30, priority: 1 });
    await generateDayPlan(ctx);
    const { count: openBefore } = await db.from("tasks").select("id", { count: "exact", head: true }).in("status", ["todo", "in_progress"]);
    const r = await recoverPlan(ctx, { description: "Family emergency", category: "interruption", availableFrom: DateTime.now().plus({ hours: 1 }).toISO() });
    const { count: openAfter } = await db.from("tasks").select("id", { count: "exact", head: true }).in("status", ["todo", "in_progress"]);
    expect(openAfter).toBe(openBefore);
    expect(r.summary).toMatch(/re-planned/);
    const { data: dis } = await db.from("plan_disruptions").select("*");
    expect(dis!.some((d) => d.description === "Family emergency")).toBe(true);
  });
});

describe("memory across sessions", () => {
  it("brings back a project's memories in a brand-new conversation, but not rejected ones", async () => {
    const ctx = ctxFor(db, userId, zone);
    const { data: project } = await db.from("projects").insert({ user_id: userId, name: "Robotics" }).select("id").single();
    for (const row of [
      { content: "Competition moved to March 14; drivetrain is the bottleneck", origin: "stated" },
      { content: "Team wants to drop the arm design", origin: "inferred", confidence: 0.4, status: "rejected" },
    ]) {
      const { error } = await db.from("memories").insert({ user_id: userId, kind: "project", project_id: project!.id, ...row });
      expect(error).toBeNull();
    }
    const { buildContext } = await import("@/server/ai/chat");
    // A new conversation: nothing about the project is in its history.
    const fresh = { ...ctx, conversationId: undefined };
    const context = await buildContext(fresh, "how is robotics going?", "chat");
    expect(context).toContain("[Robotics] Competition moved to March 14; drivetrain is the bottleneck");
    expect(context).not.toContain("drop the arm design");
  });
});

describe("plan stays in step with tasks", () => {
  it("settles open blocks when a task is finished, cancelled or deleted", async () => {
    const ctx = ctxFor(db, userId, zone);
    const today = DateTime.now().setZone(zone);
    const block = async (taskId: string, title: string, day: DateTime) => {
      const start = day.set({ hour: 12, minute: 0 });
      const { data } = await db.from("plan_blocks").insert({ user_id: userId, task_id: taskId, title, plan_date: day.toISODate(), starts_at: start.toISO(), ends_at: start.plus({ minutes: 30 }).toISO() }).select("id").single();
      return data!.id as string;
    };
    const finished = await createTask(ctx, { title: "Finish me" });
    const todayBlock = await block(finished.id, "Finish me", today);
    const laterBlock = await block(finished.id, "Finish me", today.plus({ days: 2 }));
    const { completeTask } = await import("@/server/domain/tasks");
    await completeTask(ctx, finished.id);
    const { data: afterDone } = await db.from("plan_blocks").select("id,status").in("id", [todayBlock, laterBlock]);
    expect(afterDone).toEqual([{ id: todayBlock, status: "done" }]);

    const cancelled = await createTask(ctx, { title: "Cancel me" });
    const cBlock = await block(cancelled.id, "Cancel me", today);
    await updateEntity(ctx, "tasks", cancelled.id, { status: "cancelled" });
    const deleted = await createTask(ctx, { title: "Delete me" });
    const dBlock = await block(deleted.id, "Delete me", today);
    await deleteEntity(ctx, "tasks", deleted.id);
    const { data: dropped } = await db.from("plan_blocks").select("id").in("id", [cBlock, dBlock]);
    expect(dropped).toHaveLength(0);
  });
});

describe("recurring tasks", () => {
  const successors = async (title: string) => {
    const { data } = await db.from("tasks").select("due_at,status").eq("user_id", userId).eq("title", title).eq("status", "todo");
    return data ?? [];
  };

  it("schedules the next occurrence after today even when finished late, not in the past", async () => {
    const ctx = ctxFor(db, userId, zone);
    const now = DateTime.now().setZone(zone);
    const due = now.minus({ days: 5 }).set({ hour: 7, minute: 0, second: 0, millisecond: 0 });
    const t = await createTask(ctx, { title: "Water plants", due_at: due.toISO()!, recurrence: { freq: "daily" } });
    const { completeTask } = await import("@/server/domain/tasks");
    await completeTask(ctx, t.id);
    const next = await successors("Water plants");
    expect(next).toHaveLength(1);
    const nextDue = DateTime.fromISO(next[0].due_at!).setZone(zone);
    expect(nextDue > now).toBe(true);
    expect(nextDue.diff(now, "hours").hours).toBeLessThanOrEqual(24);
    expect(nextDue.toFormat("HH:mm")).toBe("07:00");
  });

  it("lands weekly repeats on the chosen weekdays", async () => {
    const ctx = ctxFor(db, userId, zone);
    const now = DateTime.now().setZone(zone);
    const due = now.minus({ days: 10 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
    const t = await createTask(ctx, { title: "Gym", due_at: due.toISO()!, recurrence: { freq: "weekly", days: [1, 4] } });
    const { completeTask } = await import("@/server/domain/tasks");
    await completeTask(ctx, t.id);
    const [next] = await successors("Gym");
    const nextDue = DateTime.fromISO(next.due_at!).setZone(zone);
    expect([1, 4]).toContain(nextDue.weekday % 7);
    expect(nextDue > now).toBe(true);
    expect(nextDue.diff(now, "days").days).toBeLessThanOrEqual(7);
  });

  it("finishing the same occurrence twice creates only one next one", async () => {
    const ctx = ctxFor(db, userId, zone);
    const t = await createTask(ctx, { title: "Take vitamins", recurrence: { freq: "daily" } });
    const { completeTask } = await import("@/server/domain/tasks");
    await completeTask(ctx, t.id);
    await completeTask(ctx, t.id);
    expect(await successors("Take vitamins")).toHaveLength(1);
  });
});

describe("simultaneous repeats", () => {
  it("accepting the same proposal twice at once creates one item", async () => {
    const ctx = ctxFor(db, userId, zone);
    await db.from("tasks").delete().eq("title", "Return library books");
    const { data: p } = await db.from("proposals").insert({ user_id: userId, kind: "task", payload: { title: "Return library books" }, source_excerpt: "return library books", origin: "stated", confidence: 0.9 }).select("id").single();
    await Promise.allSettled([acceptProposal(ctx, p!.id), acceptProposal(ctx, p!.id)]);
    const { count } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("title", "Return library books");
    expect(count).toBe(1);
  });

  it("finishing a recurring task twice at once creates one next occurrence", async () => {
    const ctx = ctxFor(db, userId, zone);
    await db.from("tasks").delete().eq("title", "Feed the cat");
    const t = await createTask(ctx, { title: "Feed the cat", recurrence: { freq: "daily" } });
    const { completeTask } = await import("@/server/domain/tasks");
    await Promise.allSettled([completeTask(ctx, t.id), completeTask(ctx, t.id)]);
    const { count } = await db.from("tasks").select("id", { count: "exact", head: true }).eq("title", "Feed the cat").eq("status", "todo");
    expect(count).toBe(1);
  });
});

describe("accountability", () => {
  it("scores only what was recorded, excuses rest and real blockers, and asks about avoidance", async () => {
    const day = DateTime.now().setZone(zone).minus({ days: 3 }).startOf("day");
    const date = day.toISODate()!;
    await db.from("plan_blocks").delete().eq("plan_date", date);
    const outcomes: [string, string | null][] = [
      ["done", null], ["partial", null], ["rest", null], ["interrupted", null],
      ["skipped", "Blocked: missing the rubric"], ["skipped", null], ["planned", null],
    ];
    for (const [i, [status, reason]] of outcomes.entries()) {
      const start = day.set({ hour: 9 + i });
      const { error } = await db.from("plan_blocks").insert({ user_id: userId, title: `Block ${i}`, plan_date: date, starts_at: start.toISO(), ends_at: start.plus({ minutes: 45 }).toISO(), status, outcome_reason: reason });
      expect(error).toBeNull();
    }
    const { dayReview } = await import("@/server/domain/insights");
    const r = await dayReview(db, userId, zone, date);
    // Counted: done, partial, skipped-without-reason, unmarked = 4. (1 + 0.5) / 4.
    expect(r.completionRate).toBeCloseTo(0.375);
    expect(r.explanation).toMatch(/1 done and 1 partly done out of 4 counted blocks .* = 38%/);
    expect(r.explanation).toMatch(/3 blocks excluded/);
    expect(r.explanation).toMatch(/1 wasn't marked; mark it/);
    expect(r.findings.join(" ")).toMatch(/skipped 1 block without an outside reason/);
    expect(r.findings.join(" ")).toMatch(/blocked on missing information/);
  });
});

describe("briefings and budget", () => {
  it("stores each briefing once per local day", async () => {
    const { data: profile } = await db.from("profiles").select("*").eq("id", userId).single();
    const date = DateTime.now().setZone(zone).toISODate()!;
    const a = await saveBriefing(admin(), profile as Profile, "morning", date);
    const b = await saveBriefing(admin(), profile as Profile, "morning", date);
    expect(a?.body).toMatch(/Fixed today|No fixed commitments/);
    expect(b).toBeNull();
  });

  it("sends deadline reminders that still matter, holding or dropping them around quiet hours", async () => {
    const a = admin();
    const now = DateTime.now().setZone(zone);
    const hhmm = (d: DateTime) => d.toFormat("HH:mm");
    await a.from("notifications").delete().eq("user_id", userId);
    const soon = await createTask(ctxFor(db, userId, zone), { title: "Soon thing", due_at: now.plus({ hours: 1 }).toISO() });
    const hard = await createTask(ctxFor(db, userId, zone), { title: "Hard thing", due_at: now.plus({ hours: 10 }).toISO(), due_is_hard: true });
    const { tickUser } = await import("@/server/jobs/tick");
    const load = async () => {
      const { data } = await a.from("profiles").select("*").eq("id", userId).single();
      return data as Profile;
    };
    const reminders = async () => {
      const { data } = await a.from("notifications").select("title,status,dedupe_key").eq("user_id", userId).like("dedupe_key", "due%");
      return data!;
    };

    // Quiet for the next 3 hours: the 1-hour reminder would arrive too late, so it's dropped;
    // the hard deadline 10 hours out is held until quiet hours end.
    await a.from("profiles").update({ quiet_hours_start: hhmm(now.minus({ hours: 1 })), quiet_hours_end: hhmm(now.plus({ hours: 3 })) }).eq("id", userId);
    await tickUser(a, await load());
    let r = await reminders();
    expect(r.find((n) => n.dedupe_key.startsWith(`due2h:${soon.id}`))).toBeUndefined();
    const held = r.find((n) => n.dedupe_key.startsWith(`due24h:${hard.id}`))!;
    expect(held.status).toBe("held_quiet_hours");
    const dueLocal = DateTime.fromISO(hard.due_at!).setZone(zone);
    expect(held.title).toBe(dueLocal.hasSame(now, "day") ? "Hard deadline today" : "Hard deadline tomorrow");

    // Outside quiet hours the 1-hour reminder goes out.
    await a.from("profiles").update({ quiet_hours_start: null, quiet_hours_end: null }).eq("id", userId);
    await tickUser(a, await load());
    r = await reminders();
    expect(r.find((n) => n.dedupe_key.startsWith(`due2h:${soon.id}`))?.title).toBe("Due soon");
  });

  it("stops new AI calls at the daily cap", async () => {
    const a = admin();
    // Fill today's budget to 1 cent below the cap, whatever was already spent.
    const { getBudgetStatus } = await import("@/server/ai/budget");
    const before = await getBudgetStatus();
    const { data: row } = await a
      .from("ai_usage")
      .insert({ user_id: userId, provider: "anthropic", model: "claude-sonnet-5-5", role: "planner", purpose: "test", cost_usd: before.capUsd - before.spentUsd - 0.01, budget_day: budgetDay() })
      .select()
      .single();
    try {
      await expect(assertBudget(0.05)).rejects.toBeInstanceOf(BudgetExceededError);
      await expect(assertBudget(0)).resolves.toBeTruthy();
    } finally {
      await a.from("ai_usage").delete().eq("id", row!.id);
    }
  });
});

afterAll(async () => {
  await db.auth.signOut();
});
