import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ANON, URL_, admin, resetUser, userClient } from "./helpers";

// Verifies per-user isolation is enforced by the database itself (RLS),
// not just by application code.

describe("row level security", () => {
  let alice: Awaited<ReturnType<typeof userClient>>;
  let bob: Awaited<ReturnType<typeof userClient>>;
  let aliceTaskId: string;

  beforeAll(async () => {
    alice = await userClient("alice@navi.test");
    bob = await userClient("bob@navi.test");
    await resetUser(alice.userId);
    await resetUser(bob.userId);
    const { data, error } = await alice.db.from("tasks").insert({ title: "Alice's private task" }).select().single();
    if (error) throw error;
    aliceTaskId = data.id;
    await alice.db.from("memories").insert({ kind: "profile", content: "Alice secret", origin: "stated" });
  });

  it("lets a user read their own rows", async () => {
    const { data } = await alice.db.from("tasks").select("id,title,user_id");
    expect(data?.map((t) => t.id)).toContain(aliceTaskId);
    expect(data?.every((t) => t.user_id === alice.userId)).toBe(true);
  });

  it("hides other users' rows", async () => {
    for (const table of ["tasks", "memories", "profiles"]) {
      const { data } = await bob.db.from(table).select("*");
      expect((data ?? []).some((r: Record<string, unknown>) => r.user_id === alice.userId || r.id === alice.userId)).toBe(false);
    }
  });

  it("blocks updating or deleting another user's rows", async () => {
    await bob.db.from("tasks").update({ title: "hacked" }).eq("id", aliceTaskId);
    await bob.db.from("tasks").delete().eq("id", aliceTaskId);
    const { data } = await admin().from("tasks").select("title").eq("id", aliceTaskId).single();
    expect(data?.title).toBe("Alice's private task");
  });

  it("blocks inserting rows owned by someone else", async () => {
    const { error } = await bob.db.from("tasks").insert({ title: "forged", user_id: alice.userId });
    expect(error).not.toBeNull();
  });

  it("gives anonymous clients nothing", async () => {
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data } = await anon.from("tasks").select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("does not let users change approval execution state or read the allowlist", async () => {
    const { data: ap } = await alice.db
      .from("approvals")
      .insert({ action_type: "external.gmail.send", summary: "test", details: {}, idempotency_key: `t-${Date.now()}` })
      .select()
      .single();
    await alice.db.from("approvals").update({ status: "executed" }).eq("id", ap!.id);
    const { data: after } = await admin().from("approvals").select("status").eq("id", ap!.id).single();
    expect(after?.status).toBe("pending");
    const { data: allow } = await alice.db.from("allowed_emails").select("*");
    expect(allow ?? []).toHaveLength(0);
  });

  it("rejects sign-ups that are not on the invite list", async () => {
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { error } = await anon.auth.signUp({ email: `stranger-${Date.now()}@example.com`, password: "whatever-123456" });
    expect(error?.message).toMatch(/invite-only|access list/i);
  });
});
