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

  it("doesn't let the day-plan function touch someone else's plan", async () => {
    const day = "2030-01-02";
    const { error: seedErr } = await alice.db.from("plan_blocks").insert({ title: "Alice's block", plan_date: day, starts_at: `${day}T10:00:00Z`, ends_at: `${day}T11:00:00Z` });
    expect(seedErr).toBeNull();
    const block = { title: "Bob was here", starts_at: `${day}T12:00:00Z`, ends_at: `${day}T13:00:00Z` };
    const { error } = await bob.db.rpc("replace_day_plan", { p_user: alice.userId, p_day: day, p_blocks: [block] });
    expect(error).not.toBeNull();
    const { data } = await admin().from("plan_blocks").select("title").eq("user_id", alice.userId).eq("plan_date", day);
    expect(data).toEqual([{ title: "Alice's block" }]);
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    expect((await anon.rpc("replace_day_plan", { p_user: alice.userId, p_day: day, p_blocks: [] })).error).not.toBeNull();
    expect((await admin().from("plan_blocks").select("id").eq("user_id", alice.userId).eq("plan_date", day)).data).toHaveLength(1);
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

  it("lets a user mark their own notification read, but change nothing else about it", async () => {
    const a = admin();
    const { data: n } = await a
      .from("notifications")
      .insert({ user_id: alice.userId, kind: "deadline", title: "Due soon", body: "Essay", url: "/tasks", dedupe_key: `rls-${Date.now()}` })
      .select("id")
      .single();
    try {
      // Rewriting what a notification says or where it links is refused.
      await alice.db.from("notifications").update({ url: "https://evil.example", title: "Click me" }).eq("id", n!.id);
      await alice.db.from("notifications").update({ status: "queued" }).eq("id", n!.id);
      const { data: same } = await a.from("notifications").select("url,title,status").eq("id", n!.id).single();
      expect(same).toEqual({ url: "/tasks", title: "Due soon", status: "queued" });
      const { error } = await alice.db.from("notifications").update({ status: "read" }).eq("id", n!.id);
      expect(error).toBeNull();
      const { data: read } = await a.from("notifications").select("status").eq("id", n!.id).single();
      expect(read!.status).toBe("read");
      // And never someone else's.
      await a.from("notifications").update({ status: "queued" }).eq("id", n!.id);
      await bob.db.from("notifications").update({ status: "read" }).eq("id", n!.id);
      const { data: notBob } = await a.from("notifications").select("status").eq("id", n!.id).single();
      expect(notBob!.status).toBe("queued");
    } finally {
      await a.from("notifications").delete().eq("id", n!.id);
    }
  });

  it("rejects sign-ups that are not on the invite list", async () => {
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { error } = await anon.auth.signUp({ email: `stranger-${Date.now()}@example.com`, password: "whatever-123456" });
    // Refused either by public sign-up being off or by the invite hook.
    expect(error?.message).toMatch(/invite-only|access list|signups? not allowed/i);
  });

  it("won't let anyone register an invited email from the client (accounts are created server-side)", async () => {
    // An attacker who knows an invited address tries to claim it with their own password.
    const email = `invited-${Date.now()}@navi.test`;
    const a = admin();
    await a.from("allowed_emails").upsert({ email, note: "rls test" });
    try {
      const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
      const up = await anon.auth.signUp({ email, password: "attacker-password-1" });
      expect(up.error?.message).toMatch(/signups? not allowed/i);
      // Nor through an email link: links never create accounts.
      const otp = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      expect(otp.error).not.toBeNull();
      const { data } = await a.auth.admin.listUsers({ perPage: 1000 });
      expect(data.users.find((u) => u.email === email)).toBeUndefined();
      const signIn = await anon.auth.signInWithPassword({ email, password: "attacker-password-1" });
      expect(signIn.error).not.toBeNull();
    } finally {
      await a.from("allowed_emails").delete().eq("email", email);
    }
  });
});
