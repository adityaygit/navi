import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/server/context";

// Integration tests run against the local Supabase stack (npm run db:start).
// Users come from the dev allowlist in supabase/seed.sql.

export const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function admin(): SupabaseClient {
  return createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Signs in and returns an RLS-scoped client. On first use the account is
 * created server-side with the admin API (public sign-up is off, as in
 * production), then signed in with its password like the app does.
 */
export async function userClient(email: string, password = "test-password-123"): Promise<{ db: SupabaseClient; userId: string }> {
  const db = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  let { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    const made = await admin().auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error) throw made.error;
    ({ data, error } = await db.auth.signInWithPassword({ email, password }));
    if (error) throw error;
  }
  return { db, userId: data.user!.id };
}

export function ctxFor(db: SupabaseClient, userId: string, timezone = "America/New_York"): Ctx {
  return { db, userId, actor: "user", timezone };
}

/** Wipe one user's rows (service role) so tests start clean. */
export async function resetUser(userId: string) {
  const a = admin();
  for (const t of ["plan_blocks", "focus_sessions", "proposals", "captures", "messages", "conversations", "tasks", "milestones", "projects", "goals", "routines", "events", "memories", "notes", "approvals", "activity_log", "briefings", "notifications", "push_subscriptions", "plan_disruptions", "workspaces"]) {
    await a.from(t).delete().eq("user_id", userId);
  }
  await a.from("profiles").update({ timezone: "America/New_York", availability: [], onboarding_status: "not_started", onboarding_conversation_id: null, quiet_hours_start: null, quiet_hours_end: null }).eq("id", userId);
}
