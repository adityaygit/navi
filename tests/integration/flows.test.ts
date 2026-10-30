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
    await handleTurn(ctx, { kind: "onboarding", text: "I'm in school and run a small startup. I need to finish my history essay by friday and email investors tomorrow.", modality: "text" });
    await handleTurn(ctx, { kind: "onboarding", text: "I have soccer practice mon and wed at 4pm. Classes weekdays at 8am.", modality: "voice" });
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

describe("briefings and budget", () => {
  it("stores each briefing once per local day", async () => {
    const { data: profile } = await db.from("profiles").select("*").eq("id", userId).single();
    const date = DateTime.now().setZone(zone).toISODate()!;
    const a = await saveBriefing(admin(), profile as Profile, "morning", date);
    const b = await saveBriefing(admin(), profile as Profile, "morning", date);
    expect(a?.body).toMatch(/Fixed today|No fixed commitments/);
    expect(b).toBeNull();
  });

  it("stops new AI calls at the daily cap", async () => {
    const a = admin();
    const { data: row } = await a
      .from("ai_usage")
      .insert({ user_id: userId, provider: "anthropic", model: "claude-sonnet-5-5", role: "planner", purpose: "test", cost_usd: 1.99, budget_day: budgetDay() })
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
