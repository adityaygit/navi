import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { admin, ctxFor, resetUser, userClient } from "./helpers";

// Chatbot truthfulness, through the real tool loop (runAgent → runAnthropic →
// runTool → database) with only the network call replaced. Reproduces the
// production failures of 2026-11-16: a card claimed that was never made, a
// task created twice after "is it added?", and "Done." with nothing done.

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class Fake extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      super(opts);
      (this as unknown as { beta: unknown }).beta = { messages: { create } };
    }
  }
  return { ...actual, default: Fake };
});

const { runAgent } = await import("@/server/ai/agent");

let db: Awaited<ReturnType<typeof userClient>>["db"];
let userId = "";

const reply = (over: Partial<Anthropic.Beta.BetaMessage>): Anthropic.Beta.BetaMessage =>
  ({
    id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", content: [],
    usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...over,
  }) as unknown as Anthropic.Beta.BetaMessage;
const text = (t: string) => reply({ content: [{ type: "text", text: t }] as Anthropic.Beta.BetaContentBlock[] });
const toolCall = (id: string, name: string, input: unknown, say = "") =>
  reply({ stop_reason: "tool_use", content: [...(say ? [{ type: "text", text: say }] : []), { type: "tool_use", id, name, input }] as Anthropic.Beta.BetaContentBlock[] });

const request = (userText: string) => ({
  ctx: ctxFor(db, userId), mode: "chat" as const, role: "fast" as const, system: "SYSTEM", context: "CONTEXT", history: [], userText, purpose: "test",
});

beforeAll(async () => {
  ({ db, userId } = await userClient("truth@navi.test"));
});
beforeEach(async () => {
  await resetUser(userId);
  create.mockReset();
  vi.stubEnv("NAVI_AI_PROVIDER", "anthropic");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await admin().from("ai_usage").delete().eq("user_id", userId).eq("purpose", "test");
});

describe("Navi never reports success from model text alone", () => {
  it("a claimed card that no tool made gets one correction pass; the corrected reply is what's saved", async () => {
    create
      .mockResolvedValueOnce(text("I've sent a card to remove tonight's test block. Approve it and I'll re-plan."))
      .mockResolvedValueOnce(text("I haven't changed anything yet: there's no card. Want me to take the test block off tonight?"));
    const r = await runAgent(request("yes"));
    expect(create).toHaveBeenCalledTimes(2);
    const note = create.mock.calls[1][0].messages.at(-1);
    expect(note.role).toBe("user");
    expect(String(note.content)).toMatch(/Navi system check[\s\S]*made an approval card[\s\S]*no tool in this turn did that/);
    expect(r.text).toBe("I haven't changed anything yet: there's no card. Want me to take the test block off tonight?");
    const { count } = await db.from("approvals").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("if the model keeps claiming it, the claim is removed and the facts are stated", async () => {
    create
      .mockResolvedValueOnce(text("I've added “Read chapter 4” to your list."))
      .mockResolvedValueOnce(text("I've added “Read chapter 4” to your list."));
    const r = await runAgent(request("add read chapter 4"));
    expect(r.text).toBe("Nothing was changed.");
    const { count } = await db.from("tasks").select("id", { count: "exact", head: true });
    expect(count).toBe(0);
  });

  it("a failed tool can't be reported as done; an empty reply is never a bare 'Done.'", async () => {
    create
      .mockResolvedValueOnce(toolCall("t1", "update_task", { id: "00000000-0000-4000-8000-000000000000", priority: 1 }))
      .mockResolvedValueOnce(reply({ content: [] }));
    const r = await runAgent(request("make my essay top priority"));
    expect(r.toolEvents).toEqual([expect.objectContaining({ name: "update_task", ok: false })]);
    expect(r.text).not.toMatch(/^Done/);
    expect(r.text).toMatch(/Not everything worked/);
  });

  it("a true claim backed by a real change passes untouched (no extra model call)", async () => {
    create
      .mockResolvedValueOnce(toolCall("t1", "create_task", { title: "Email Ms. Lee", user_command: "add a task to email Ms. Lee" }))
      .mockResolvedValueOnce(text("I added “Email Ms. Lee” to your list."));
    const r = await runAgent(request("add a task to email Ms. Lee"));
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.text).toBe("I added “Email Ms. Lee” to your list.");
    const { data } = await db.from("tasks").select("title");
    expect(data!.map((t) => t.title)).toEqual(["Email Ms. Lee"]);
  });
});

describe("create_task is idempotent for the same task", () => {
  it("'okay now is it added' doesn't create a second copy", async () => {
    const add = { title: "PBL Major - BID Urban Gardening", estimate_minutes: 60, user_command: "add a urban gardening bid major project for engineering" };
    create
      .mockResolvedValueOnce(toolCall("t1", "create_task", add))
      .mockResolvedValueOnce(text("I added it."))
      .mockResolvedValueOnce(toolCall("t2", "create_task", { ...add, user_command: "okay now is it added" }))
      .mockResolvedValueOnce(text("Yes, it's on your list."));
    await runAgent(request("add a urban gardening bid major project for engineering"));
    const second = await runAgent(request("okay now is it added"));
    const { data } = await db.from("tasks").select("id,title");
    expect(data).toHaveLength(1);
    expect(second.toolEvents[0]).toMatchObject({ name: "create_task", ok: true });
    expect(second.toolEvents[0].summary).toMatch(/NOT created again/);
    expect(second.mutated).toBe(false);
  });

  it("matches an imported Canvas assignment due around the same time instead of making a personal copy", async () => {
    await admin().from("tasks").insert({ user_id: userId, title: "Unit 3 HW Set 2 [Hons Chem 2026]", source: "external", external_ref: "ext:00000000-0000-4000-8000-0000000000a1", due_at: "2026-11-20T04:59:00Z", due_is_hard: true });
    create
      .mockResolvedValueOnce(toolCall("t1", "create_task", { title: "Unit 3 HW set 2", due_at: "2026-11-19T23:59:00-05:00", user_command: "add unit 3 hw set 2 due thursday" }))
      .mockResolvedValueOnce(text("That's already on your list from Canvas."));
    const r = await runAgent(request("add unit 3 hw set 2 due thursday"));
    expect(r.toolEvents[0].summary).toMatch(/already on the list \(imported from Canvas\)/);
    const { count } = await db.from("tasks").select("id", { count: "exact", head: true });
    expect(count).toBe(1);
  });

  it("a second copy is made only when the person explicitly asks for one", async () => {
    await admin().from("tasks").insert({ user_id: userId, title: "Run", source: "user" });
    create
      .mockResolvedValueOnce(toolCall("t1", "create_task", { title: "Run", allow_duplicate: true, user_command: "add another separate run task" }))
      .mockResolvedValueOnce(text("I added a second “Run” task."));
    await runAgent(request("add another separate run task"));
    const { count } = await db.from("tasks").select("id", { count: "exact", head: true });
    expect(count).toBe(2);
  });
});

describe("overdue imports: the person's decision, verified", () => {
  it("'they're all handed in' marks overdue imports done (read back); words that don't say so change nothing", async () => {
    const past = new Date(Date.now() - 5 * 86400_000).toISOString();
    const future = new Date(Date.now() + 5 * 86400_000).toISOString();
    await admin().from("tasks").insert([
      { user_id: userId, title: "Old lab [Chem]", source: "external", external_ref: "ext:00000000-0000-4000-8000-0000000000b1", due_at: past, due_is_hard: true },
      { user_id: userId, title: "Old essay [Lit]", source: "external", external_ref: "ext:00000000-0000-4000-8000-0000000000b2", due_at: past, due_is_hard: true },
      { user_id: userId, title: "Next quiz [Chem]", source: "external", external_ref: "ext:00000000-0000-4000-8000-0000000000b3", due_at: future, due_is_hard: true },
    ]);
    create
      .mockResolvedValueOnce(toolCall("t1", "resolve_overdue_imports", { decision: "handed_in", all_overdue: true, user_statement: "plan my evening" }))
      .mockResolvedValueOnce(text("Okay."));
    const refused = await runAgent(request("plan my evening"));
    expect(refused.toolEvents[0]).toMatchObject({ ok: false });

    create
      .mockResolvedValueOnce(toolCall("t2", "resolve_overdue_imports", { decision: "handed_in", all_overdue: true, user_statement: "the old canvas ones are all turned in" }))
      .mockResolvedValueOnce(text("I marked both old Canvas items done."));
    const r = await runAgent(request("the old canvas ones are all turned in"));
    expect(r.toolEvents[0].summary).toMatch(/Marked done \(handed in\): 2 of 2/);
    expect(r.text).toBe("I marked both old Canvas items done.");
    const { data } = await db.from("tasks").select("title,status").order("title");
    expect(data).toEqual([
      { title: "Next quiz [Chem]", status: "todo" },
      { title: "Old essay [Lit]", status: "done" },
      { title: "Old lab [Chem]", status: "done" },
    ]);
  });
});
