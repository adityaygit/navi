import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { runTool } from "@/server/ai/tools";
import { actionViews, decideApproval, requestApproval, reviseApproval } from "@/server/domain/approvals";
import { revertActivities } from "@/server/domain/activity";
import { createTask, updateTask } from "@/server/domain/tasks";
import { handleTurn, listMessages, messageActions } from "@/server/ai/chat";
import type { Ctx } from "@/server/context";

// Inline action cards end to end against the local database: what runs on its
// own, what waits for a tap, and that a waiting action runs exactly once, only
// as approved, and only if it still makes sense.

let me: Awaited<ReturnType<typeof userClient>>;
let other: Awaited<ReturnType<typeof userClient>>;
const zone = "America/New_York";
let user: Ctx;
let navi: Ctx;

async function setAutonomy(value: "auto" | "ask") {
  await admin().from("profiles").update({ preferences: { autonomy: value } }).eq("id", me.userId);
}
async function tasksTitled(title: string) {
  return (await me.db.from("tasks").select("*").eq("title", title)).data ?? [];
}

beforeAll(async () => {
  me = await userClient("actions@navi.test");
  other = await userClient("actions-other@navi.test");
  user = ctxFor(me.db, me.userId, zone);
  navi = { ...user, actor: "navi" };
});
beforeEach(async () => {
  await resetUser(me.userId);
  await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
});
afterAll(async () => {
  await resetUser(me.userId);
  await resetUser(other.userId);
});

describe("automatic low-risk actions", () => {
  it("creates an ordinary task right away, records it, and can undo it (once)", async () => {
    const r = await runTool(navi, "create_task", { title: "Buy printer ink", user_command: "add a task to buy printer ink" });
    expect(r.ok).toBe(true);
    expect(r.actionId).toBeUndefined();
    expect(r.undo?.length).toBe(1);
    expect(await tasksTitled("Buy printer ink")).toHaveLength(1);
    const { data: log } = await me.db.from("activity_log").select("actor,reversible").eq("id", r.undo![0]).single();
    expect(log).toMatchObject({ actor: "navi", reversible: true });

    const [a, b] = await Promise.all([revertActivities(user, r.undo!), revertActivities(user, r.undo!)]);
    expect(a.undone + b.undone).toBe(1); // two taps, one undo
    expect(await tasksTitled("Buy printer ink")).toHaveLength(0);
  });

  it("won't undo an automatic edit the person has changed again since", async () => {
    const t = await createTask(user, { title: "Draft" });
    const r = await runTool(navi, "update_task", { id: t.id, title: "Draft essay" });
    expect(r.undo?.length).toBe(1);
    await updateTask(user, t.id, { title: "Final essay" });
    await expect(revertActivities(user, r.undo!)).rejects.toThrow(/changed again since/);
    expect((await tasksTitled("Final essay"))).toHaveLength(1);
  });
});

describe("ask-first actions", () => {
  it("with 'ask me first', a new task becomes a card and is created only on approval, exactly once", async () => {
    await setAutonomy("ask");
    const due = DateTime.now().setZone(zone).plus({ days: 2 }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
    const r = await runTool(navi, "create_task", { title: "Call the dentist", due_at: due.toISO(), estimate_minutes: 15, user_command: "add a task to call the dentist" });
    expect(r.ok).toBe(true);
    expect(r.actionId).toBeTruthy();
    expect(await tasksTitled("Call the dentist")).toHaveLength(0);

    const view = (await actionViews(user, [r.actionId!]))[r.actionId!];
    expect(view).toMatchObject({ status: "proposed", verb: "Create task", subject: "Call the dentist", revision: 1 });
    expect(view.fields).toEqual(expect.arrayContaining([{ label: "Due", value: due.toFormat("ccc LLL d, h:mm a"), from: undefined }, { label: "Estimate", value: "15 min", from: undefined }]));

    // The same request again (a retried call) is the same card, not a second one.
    const again = await runTool(navi, "create_task", { title: "Call the dentist", due_at: due.toISO(), estimate_minutes: 15, user_command: "add a task to call the dentist" });
    expect(again.actionId).toBe(r.actionId);

    // Five taps at once (double clicks, a retry, a reconnect): one task.
    const results = await Promise.all(Array.from({ length: 5 }, () => decideApproval(user, r.actionId!, "approve", admin())));
    const finalStates = new Set((await Promise.all(results.map((x) => x.status))).values());
    expect([...finalStates].every((s) => ["approved", "executing", "completed"].includes(s))).toBe(true);
    const settled = await decideApproval(user, r.actionId!, "approve", admin());
    expect(settled.status).toBe("completed");
    expect(await tasksTitled("Call the dentist")).toHaveLength(1);
    expect((settled.result as { summary: string }).summary).toMatch(/Created task “Call the dentist”, due/);

    // Undo from the card removes what it created.
    const done = (await actionViews(user, [r.actionId!]))[r.actionId!];
    expect(done.undo.length).toBeGreaterThan(0);
    await revertActivities(user, done.undo);
    expect(await tasksTitled("Call the dentist")).toHaveLength(0);
    expect((await actionViews(user, [r.actionId!]))[r.actionId!].undone).toBe(true);
  });

  it("two identical proposals at the same instant make one card", async () => {
    const req = { actionType: "external.gmail.send", summary: "Email coach about Saturday", details: { to: "coach@example.com" } };
    const [a, b, c] = await Promise.all([requestApproval(navi, req), requestApproval(navi, req), requestApproval(navi, req)]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    const { count } = await admin().from("approvals").select("id", { count: "exact", head: true }).eq("user_id", me.userId);
    expect(count).toBe(1);
  });

  it("can be changed by talking before approval: same card, new details, and a stale tap approves nothing", async () => {
    await setAutonomy("ask");
    const r = await runTool(navi, "create_task", { title: "Essay", user_command: "add a task for the essay" });
    const revised = await runTool(navi, "revise_action", { action_id: r.actionId!, changes: { title: "Draft history essay", estimate_minutes: 90 } });
    expect(revised.ok).toBe(true);
    expect(revised.actionId).toBe(r.actionId);
    const view = (await actionViews(user, [r.actionId!]))[r.actionId!];
    expect(view).toMatchObject({ subject: "Draft history essay", revision: 2, status: "proposed" });
    expect(view.fields).toContainEqual({ label: "Estimate", value: "1 h 30 min", from: undefined });

    // The person tapped Approve on the old version (revision 1): nothing runs.
    const stale = await decideApproval(user, r.actionId!, "approve", admin(), 1);
    expect(stale.status).toBe("proposed");
    expect(await tasksTitled("Essay")).toHaveLength(0);

    const ok = await decideApproval(user, r.actionId!, "approve", admin(), 2);
    expect(ok.status).toBe("completed");
    const [task] = await tasksTitled("Draft history essay");
    expect(task.estimate_minutes).toBe(90);
    expect(await tasksTitled("Essay")).toHaveLength(0);

    // Invalid changes are refused with the same validation as the original tool.
    const r2 = await runTool(navi, "create_task", { title: "Another", user_command: "add another task" });
    const bad = await runTool(navi, "revise_action", { action_id: r2.actionId!, changes: { priority: 9 } });
    expect(bad.ok).toBe(false);
    const decided = await runTool(navi, "revise_action", { action_id: r.actionId!, changes: { title: "Too late" } });
    expect(decided.ok).toBe(false);
    expect(decided.summary).toMatch(/already completed/);
  });

  it("declined actions never run, even if approved afterwards", async () => {
    const t = await createTask(user, { title: "Gym bag" });
    const r = await runTool(navi, "update_task", { id: t.id, status: "cancelled" });
    expect(r.summary).toMatch(/needs the user's OK because it cancels a task/);
    const declined = await runTool(navi, "decline_action", { action_id: r.actionId! });
    expect(declined.ok).toBe(true);
    const late = await decideApproval(user, r.actionId!, "approve", admin());
    expect(late.status).toBe("declined");
    const [task] = await tasksTitled("Gym bag");
    expect(task.status).toBe("todo");
  });

  it("deleting always asks, and runs once approved", async () => {
    const t = await createTask(user, { title: "Old errand" });
    const r = await runTool(navi, "delete_item", { table: "tasks", id: t.id });
    expect(r.actionId).toBeTruthy();
    expect(await tasksTitled("Old errand")).toHaveLength(1);
    const view = (await actionViews(user, [r.actionId!]))[r.actionId!];
    expect(view).toMatchObject({ verb: "Delete task", subject: "Old errand", reason: "deleting can't be undone" });
    expect((await decideApproval(user, r.actionId!, "approve", admin())).status).toBe("completed");
    expect(await tasksTitled("Old errand")).toHaveLength(0);
  });
});

describe("rechecked at execution", () => {
  it("expires instead of overwriting the person's newer edit", async () => {
    const t = await createTask(user, { title: "Report", due_at: DateTime.now().plus({ days: 2 }).toISO(), due_is_hard: true });
    const r = await runTool(navi, "update_task", { id: t.id, due_at: DateTime.now().plus({ days: 20 }).toISO() });
    const view = (await actionViews(user, [r.actionId!]))[r.actionId!];
    expect(view.fields[0]).toMatchObject({ label: "Due" });
    expect(view.fields[0].from).toBeTruthy(); // shows old → new
    const mine = DateTime.now().plus({ days: 4 }).toISO()!;
    await updateTask(user, t.id, { due_at: mine });
    const result = await decideApproval(user, r.actionId!, "approve", admin());
    expect(result.status).toBe("expired");
    expect(result.error).toMatch(/changed since/);
    const [after] = await tasksTitled("Report");
    expect(Date.parse(after.due_at)).toBe(Date.parse(mine));
  });

  it("expires when the item is gone", async () => {
    const t = await createTask(user, { title: "Temp" });
    const r = await runTool(navi, "update_task", { id: t.id, status: "cancelled" });
    await me.db.from("tasks").delete().eq("id", t.id);
    const result = await decideApproval(user, r.actionId!, "approve", admin());
    expect(result.status).toBe("expired");
    expect(result.error).toMatch(/no longer exists/);
  });

  it("validates stored arguments again and fails honestly instead of running them", async () => {
    const t = await createTask(user, { title: "Target" });
    // A row tampered with (or written by older, looser code): a forbidden column.
    const { data: row } = await admin()
      .from("approvals")
      .insert({ user_id: me.userId, action_type: "internal.update.tasks", summary: "Update task", details: { op: "update", table: "tasks", id: t.id, patch: { user_id: other.userId } }, idempotency_key: `bad-${Date.now()}` })
      .select("id")
      .single();
    const result = await decideApproval(user, row!.id, "approve", admin());
    expect(result.status).toBe("failed");
    const view = (await actionViews(user, [row!.id]))[row!.id];
    expect(view.status).toBe("failed");
    expect(view.result).toBeNull();
    const [task] = await tasksTitled("Target");
    expect(task.user_id).toBe(me.userId);
  });

  it("never reports an outside action as done when the service isn't connected", async () => {
    const r = await runTool(navi, "request_external_action", { service: "gmail", action: "send", exact_description: "Email coach@example.com: I'll be late Saturday", parameters: { to: "coach@example.com" } });
    expect(r.summary).toMatch(/Nothing has been sent/);
    const result = await decideApproval(user, r.actionId!, "approve", admin());
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/isn't connected/);
    expect((await actionViews(user, [r.actionId!]))[r.actionId!].result).toBeNull();
  });

  it("expires old proposals; a new request then makes a fresh card", async () => {
    const req = { actionType: "external.gmail.send", summary: "Email x", details: { to: "x@example.com" } };
    const a = await requestApproval(navi, req);
    await admin().from("approvals").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", a.id);
    expect((await actionViews(user, [a.id]))[a.id].status).toBe("expired");
    const decided = await decideApproval(user, a.id, "approve", admin());
    expect(decided.status).toBe("expired");
    const b = await requestApproval(navi, req);
    expect(b.id).not.toBe(a.id);
    expect(b.status).toBe("proposed");
  });

  it("only the owner can see, approve, decline or change an action", async () => {
    const a = await requestApproval(navi, { actionType: "external.gmail.send", summary: "Email y", details: { to: "y@example.com" } });
    const stranger = ctxFor(other.db, other.userId, zone);
    await expect(decideApproval(stranger, a.id, "approve", admin())).rejects.toThrow(/doesn't exist/);
    await expect(decideApproval(stranger, a.id, "reject", admin())).rejects.toThrow(/doesn't exist/);
    await expect(reviseApproval(stranger, a.id, { exact_description: "Email someone else entirely" }, admin())).rejects.toThrow(/doesn't exist/);
    expect(await actionViews(stranger, [a.id])).toEqual({});
    expect((await admin().from("approvals").select("status").eq("id", a.id).single()).data!.status).toBe("proposed");
  });
});

describe("in the conversation", () => {
  it("links each card to the reply that proposed it, survives a reload, and handles 'no' and 'make it…' by talking", async () => {
    await setAutonomy("ask");
    const first = await handleTurn(user, { kind: "chat", text: "add a task to call the dentist tomorrow", modality: "text" });
    const conv = first.conversationId;
    const ev = first.assistantMessage.tool_events.find((e) => e.name === "create_task")!;
    expect(ev.action_id).toBeTruthy();
    expect(first.actions?.[ev.action_id!]?.status).toBe("proposed");
    expect(await tasksTitled("call the dentist")).toHaveLength(0);

    // "make it 30 minutes" changes the same card.
    const second = await handleTurn(user, { kind: "chat", text: "make it 30 minutes instead", modality: "text", conversationId: conv });
    const rev = second.assistantMessage.tool_events.find((e) => e.name === "revise_action")!;
    expect(rev.action_id).toBe(ev.action_id);
    expect(second.actions?.[ev.action_id!]).toMatchObject({ revision: 2, status: "proposed" });

    // A reload rebuilds the same cards from the database.
    const reloaded = await messageActions(user, await listMessages(user, conv));
    expect(reloaded.actions[ev.action_id!].fields).toContainEqual({ label: "Estimate", value: "30 min", from: undefined });

    // A second proposal in the same chat is a separate card; "no" drops the newest one only.
    const t = await createTask(user, { title: "Laundry" });
    void t;
    const third = await handleTurn(user, { kind: "chat", text: "cancel laundry", modality: "text", conversationId: conv });
    const cancel = third.assistantMessage.tool_events.find((e) => e.name === "update_task")!;
    expect(cancel.action_id).toBeTruthy();
    expect(cancel.action_id).not.toBe(ev.action_id);
    const fourth = await handleTurn(user, { kind: "chat", text: "no, don't", modality: "text", conversationId: conv });
    expect(fourth.assistantMessage.content).toMatch(/won't do that/);
    expect(fourth.actions?.[cancel.action_id!]?.status).toBe("declined");
    expect((await actionViews(user, [ev.action_id!]))[ev.action_id!].status).toBe("proposed");
    expect((await tasksTitled("Laundry"))[0].status).toBe("todo");

    // Approving the remaining card creates the revised task.
    await decideApproval(user, ev.action_id!, "approve", admin(), 2);
    const [made] = await tasksTitled("call the dentist");
    expect(made.estimate_minutes).toBe(30);
  });

  it("with the default setting, an explicit request is done at once and the reply offers Undo", async () => {
    const turn = await handleTurn(user, { kind: "chat", text: "add a task to water the plants", modality: "text" });
    const ev = turn.assistantMessage.tool_events.find((e) => e.name === "create_task")!;
    expect(ev.action_id).toBeUndefined();
    expect(ev.undo?.length).toBe(1);
    expect(await tasksTitled("water the plants")).toHaveLength(1);
    await revertActivities(user, ev.undo!);
    const after = await messageActions(user, await listMessages(user, turn.conversationId));
    expect(after.undone).toContain(ev.undo![0]);
  });
});
