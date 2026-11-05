import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicEnv, serverEnv } from "@/lib/env";
import { applyEmail, approvedEmail, declinedEmail } from "@/server/email/templates";
import { resendSender, type Sender } from "@/server/email/send";

// Early access: request → application → (manual or automatic) approval → allowlist + invite.
// All reads and writes use the service role; the tables have no user-facing policies.

export const TOKEN_TTL_DAYS = 14;
export const RESEND_COOLDOWN_MIN = 10;
export const MAX_REQUESTS_PER_IP_PER_HOUR = 5;

export type WaitlistStatus = "requested" | "applied" | "approved" | "declined";
export type WaitlistRow = {
  id: string; email: string; status: WaitlistStatus; token_hash: string | null; token_expires_at: string | null;
  name: string | null; reason: string | null; use_case: string | null; timezone: string | null; referral: string | null;
  request_count: number; last_email_at: string | null; created_at: string; applied_at: string | null;
  decided_at: string | null; decided_by: string | null; decision_email_sent: boolean;
};

// ---------- pure helpers (unit-tested) ----------

export const emailSchema = z.string().trim().toLowerCase().max(254).email();

export const applicationSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1, "Tell us your name").max(120),
  reason: z.string().trim().min(10, "A sentence or two, please").max(2000),
  use_case: z.string().trim().min(10, "A sentence or two, please").max(2000),
  timezone: z.string().trim().min(1).max(64),
  referral: z.string().trim().max(300).optional().default(""),
});
export type Application = z.infer<typeof applicationSchema>;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`navi-waitlist:${ip}`).digest("hex").slice(0, 32);
}
export function tokenExpiry(now = new Date()): string {
  return new Date(now.getTime() + TOKEN_TTL_DAYS * 86_400_000).toISOString();
}
export function isExpired(expiresAt: string | null, now = new Date()): boolean {
  return !expiresAt || new Date(expiresAt).getTime() <= now.getTime();
}
/** Resend the application email only if the last one is older than the cooldown. */
export function canResend(lastEmailAt: string | null, now = new Date()): boolean {
  return !lastEmailAt || now.getTime() - new Date(lastEmailAt).getTime() >= RESEND_COOLDOWN_MIN * 60_000;
}
/** Which decision is allowed from which status. Decisions are only made on applications. */
export function canDecide(status: WaitlistStatus, decision: "approve" | "decline"): boolean {
  if (status === "applied") return true;
  if (status === "declined" && decision === "approve") return true; // you can change your mind
  return false;
}
export function applyUrl(token: string, site = publicEnv.siteUrl): string {
  return `${site.replace(/\/$/, "")}/early-access/apply?token=${encodeURIComponent(token)}`;
}

// ---------- database-backed operations ----------

export function waitlistDb(): SupabaseClient {
  return createClient(publicEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

export type RequestResult = { outcome: "sent" | "resent" | "cooldown" | "already_applied" | "already_approved" | "rate_limited" | "email_failed" };

/**
 * Someone asked for early access. Always answers the visitor the same way
 * ("check your inbox") so the endpoint can't be used to discover who signed up;
 * the outcome is for logs and tests.
 */
export async function requestAccess(db: SupabaseClient, rawEmail: string, ip: string | null, send: Sender = resendSender, now = new Date()): Promise<RequestResult> {
  const email = emailSchema.parse(rawEmail);
  const ipHash = hashIp(ip);
  if (ipHash) {
    const since = new Date(now.getTime() - 3_600_000).toISOString();
    const { count } = await db.from("waitlist").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since);
    if ((count ?? 0) >= MAX_REQUESTS_PER_IP_PER_HOUR) return { outcome: "rate_limited" };
  }
  const { data: existing } = await db.from("waitlist").select("*").eq("email", email).maybeSingle<WaitlistRow>();
  if (existing?.status === "approved") return { outcome: "already_approved" };
  if (existing?.status === "applied" || existing?.status === "declined") return { outcome: "already_applied" };
  if (existing && !canResend(existing.last_email_at, now)) return { outcome: "cooldown" };

  const { token, hash } = newToken();
  const row = { email, status: "requested", token_hash: hash, token_expires_at: tokenExpiry(now), last_email_at: now.toISOString(), ip_hash: ipHash };
  if (existing) {
    const { error } = await db.from("waitlist").update({ ...row, request_count: existing.request_count + 1 }).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await db.from("waitlist").insert(row);
    if (error) throw error;
  }
  const sent = await send(email, applyEmail(applyUrl(token)));
  if (!sent.ok) return { outcome: "email_failed" };
  return { outcome: existing ? "resent" : "sent" };
}

/** Looks up an application link. Returns only what the form needs. */
export async function findByToken(db: SupabaseClient, token: string, now = new Date()): Promise<{ state: "valid"; email: string } | { state: "invalid" | "expired" | "used" }> {
  const { data } = await db.from("waitlist").select("email,status,token_expires_at").eq("token_hash", hashToken(token)).maybeSingle<Pick<WaitlistRow, "email" | "status" | "token_expires_at">>();
  if (!data) return { state: "invalid" };
  if (data.status !== "requested") return { state: "used" };
  if (isExpired(data.token_expires_at, now)) return { state: "expired" };
  return { state: "valid", email: data.email };
}

export async function getSettings(db: SupabaseClient): Promise<{ auto_approve: boolean }> {
  const { data } = await db.from("waitlist_settings").select("auto_approve").eq("id", 1).maybeSingle<{ auto_approve: boolean }>();
  return { auto_approve: data?.auto_approve ?? false };
}

export async function setAutoApprove(db: SupabaseClient, on: boolean, by: string) {
  const { error } = await db.from("waitlist_settings").upsert({ id: 1, auto_approve: on, updated_at: new Date().toISOString(), updated_by: by });
  if (error) throw error;
}

/** Saves the answers. The link becomes single-use: the token is cleared. Auto-approves if the switch is on. */
export async function submitApplication(db: SupabaseClient, input: unknown, send: Sender = resendSender, now = new Date()): Promise<{ outcome: "applied" | "approved" | "invalid" | "expired" | "used" }> {
  const a = applicationSchema.parse(input);
  const found = await findByToken(db, a.token, now);
  if (found.state !== "valid") return { outcome: found.state };
  const { data, error } = await db.from("waitlist")
    .update({ status: "applied", name: a.name, reason: a.reason, use_case: a.use_case, timezone: a.timezone, referral: a.referral || null, applied_at: now.toISOString(), token_hash: null, token_expires_at: null })
    .eq("token_hash", hashToken(a.token)).eq("status", "requested")
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw error;
  if (!data) return { outcome: "used" }; // lost a race with a second submit
  if ((await getSettings(db)).auto_approve) {
    await decide(db, data.id, "approve", "auto", send, now);
    return { outcome: "approved" };
  }
  return { outcome: "applied" };
}

export async function listWaitlist(db: SupabaseClient, status?: WaitlistStatus): Promise<WaitlistRow[]> {
  let q = db.from("waitlist").select("*").order("created_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as WaitlistRow[];
}

/**
 * Approve: add to the allowlist, create the account if needed, and email a one-time sign-in link.
 * Decline: optionally email a polite note. Both are idempotent per status.
 */
export async function decide(db: SupabaseClient, id: string, decision: "approve" | "decline", by: string, send: Sender = resendSender, now = new Date(), opts: { notify?: boolean } = {}): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string }> {
  const { data: row } = await db.from("waitlist").select("*").eq("id", id).maybeSingle<WaitlistRow>();
  if (!row) return { ok: false, error: "Not found" };
  if (!canDecide(row.status, decision)) return { ok: false, error: `Can't ${decision} an entry that is ${row.status}` };

  if (decision === "decline") {
    await db.from("waitlist").update({ status: "declined", decided_at: now.toISOString(), decided_by: by }).eq("id", id);
    if (!opts.notify) return { ok: true, emailed: false };
    const sent = await send(row.email, declinedEmail());
    if (sent.ok) await db.from("waitlist").update({ decision_email_sent: true }).eq("id", id);
    return { ok: true, emailed: sent.ok };
  }

  const { error: allowErr } = await db.from("allowed_emails").upsert({ email: row.email, note: `waitlist ${row.id}` });
  if (allowErr) throw allowErr;
  // Create the account server-side (confirmed, no password), as scripts/allow-email.mjs does; an existing one is left alone.
  const created = await db.auth.admin.createUser({ email: row.email, email_confirm: true });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) throw created.error;
  const site = publicEnv.siteUrl.replace(/\/$/, "");
  const link = await db.auth.admin.generateLink({ type: "magiclink", email: row.email });
  let signIn = `${site}/login`;
  if (!link.error && link.data.properties?.hashed_token) {
    signIn = `${site}/auth/confirm?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent("/onboarding")}`;
  } else if (link.error) {
    console.error("[waitlist] generateLink failed; sending plain sign-in link", link.error.message);
  }
  await db.from("waitlist").update({ status: "approved", decided_at: now.toISOString(), decided_by: by }).eq("id", id);
  const sent = await send(row.email, approvedEmail(signIn, site));
  if (sent.ok) await db.from("waitlist").update({ decision_email_sent: true }).eq("id", id);
  return { ok: true, emailed: sent.ok };
}

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && serverEnv.adminEmails().includes(email.toLowerCase());
}
