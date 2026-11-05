import { afterEach, describe, expect, it } from "vitest";
import { admin } from "./helpers";
import { decide, findByToken, requestAccess, setAutoApprove, submitApplication } from "@/server/waitlist";
import type { Sender } from "@/server/email/send";
import type { Email } from "@/server/email/templates";

// Full early-access flow against the local stack, with a capturing email sender.
function capture() {
  const sent: { to: string; email: Email }[] = [];
  const send: Sender = async (to, email) => { sent.push({ to, email }); return { ok: true, id: "test" }; };
  const tokenFrom = (i = sent.length - 1) => new URL(/https?:\/\/[^\s"]+apply\?token=[^\s"&]+/.exec(sent[i].email.text)![0]).searchParams.get("token")!;
  return { sent, send, tokenFrom };
}
const answers = { name: "Maya", reason: "I keep losing track of promises.", use_case: "Planning my week around studio work.", timezone: "Europe/London" };
const emails: string[] = [];
const addr = () => { const e = `waitlist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`; emails.push(e); return e; };

afterEach(async () => {
  const a = admin();
  await setAutoApprove(a, false, "test");
  for (const e of emails.splice(0)) {
    await a.from("waitlist").delete().eq("email", e);
    await a.from("allowed_emails").delete().eq("email", e);
    const { data } = await a.auth.admin.listUsers({ perPage: 1000 });
    const u = data?.users.find((x) => x.email === e);
    if (u) await a.auth.admin.deleteUser(u.id);
  }
});

describe("early-access waitlist", () => {
  it("request → apply → approve adds to the allowlist, creates the account and emails a sign-in link", async () => {
    const db = admin(), m = capture(), email = addr();
    expect((await requestAccess(db, email.toUpperCase(), "203.0.113.1", m.send)).outcome).toBe("sent");
    expect(m.sent[0].to).toBe(email);
    const token = m.tokenFrom();
    expect(await findByToken(db, token)).toEqual({ state: "valid", email });
    const { data: stored } = await db.from("waitlist").select("token_hash").eq("email", email).single();
    expect(stored!.token_hash).not.toBe(token); // only the hash is stored

    expect((await submitApplication(db, { token, ...answers }, m.send)).outcome).toBe("applied");
    expect((await findByToken(db, token)).state).toBe("used"); // single use
    expect((await submitApplication(db, { token, ...answers }, m.send)).outcome).toBe("invalid");

    const { data: row } = await db.from("waitlist").select("id,status").eq("email", email).single();
    expect(row!.status).toBe("applied");
    const r = await decide(db, row!.id, "approve", "owner@example.com", m.send);
    expect(r).toEqual({ ok: true, emailed: true });
    const { data: allowed } = await db.from("allowed_emails").select("email").eq("email", email).maybeSingle();
    expect(allowed?.email).toBe(email);
    const users = await db.auth.admin.listUsers({ perPage: 1000 });
    expect(users.data.users.some((u) => u.email === email)).toBe(true);
    const last = m.sent.at(-1)!;
    expect(last.email.subject).toMatch(/You’re in/);
    expect(last.email.text).toMatch(/auth\/confirm\?token_hash=/);
    expect((await decide(db, row!.id, "approve", "owner@example.com", m.send)).ok).toBe(false); // idempotent
  });

  it("re-requesting within the cooldown doesn't send again; an expired link is refused", async () => {
    const db = admin(), m = capture(), email = addr();
    await requestAccess(db, email, null, m.send);
    expect((await requestAccess(db, email, null, m.send)).outcome).toBe("cooldown");
    expect(m.sent).toHaveLength(1);
    const token = m.tokenFrom();
    const later = new Date(Date.now() + 15 * 86_400_000);
    expect((await findByToken(db, token, later)).state).toBe("expired");
    expect((await submitApplication(db, { token, ...answers }, m.send, later)).outcome).toBe("expired");
  });

  it("declining can email a note, and a declined person can still be approved later", async () => {
    const db = admin(), m = capture(), email = addr();
    await requestAccess(db, email, null, m.send);
    await submitApplication(db, { token: m.tokenFrom(), ...answers }, m.send);
    const { data: row } = await db.from("waitlist").select("id").eq("email", email).single();
    expect(await decide(db, row!.id, "decline", "owner@example.com", m.send, undefined, { notify: true })).toEqual({ ok: true, emailed: true });
    expect(m.sent.at(-1)!.email.subject).toBe("About your Navi early access");
    expect((await requestAccess(db, email, null, m.send)).outcome).toBe("already_applied");
    expect((await decide(db, row!.id, "approve", "owner@example.com", m.send)).ok).toBe(true);
  });

  it("with the switch on, a submitted application is approved automatically", async () => {
    const db = admin(), m = capture(), email = addr();
    await setAutoApprove(db, true, "test");
    await requestAccess(db, email, null, m.send);
    expect((await submitApplication(db, { token: m.tokenFrom(), ...answers }, m.send)).outcome).toBe("approved");
    const { data: row } = await db.from("waitlist").select("status,decided_by").eq("email", email).single();
    expect(row).toEqual({ status: "approved", decided_by: "auto" });
    expect(m.sent.at(-1)!.email.subject).toMatch(/You’re in/);
  });
});
