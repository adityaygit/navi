import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { assertLocalSupabase } from "../local-guard";

config({ path: ".env.local", quiet: true });
assertLocalSupabase();
export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
export const PASSWORD = "test-password-123";

async function findUser(email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email) ?? null;
}

/**
 * Accounts are created server-side only (public sign-up is off), the way
 * scripts/allow-email.mjs does it, but with a password so the UI can sign in.
 * `fresh` deletes any existing account first. Returns the user id.
 */
export async function ensureAccount(email: string, opts: { fresh?: boolean } = {}) {
  await admin.from("allowed_emails").upsert({ email, note: "e2e" });
  const old = await findUser(email);
  if (old && !opts.fresh) return old.id;
  if (old) await admin.auth.admin.deleteUser(old.id);
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

/** Signs in through the login page with the test password. */
export async function signInWithPassword(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * A brand-new invited account that has skipped setup and is free all day in
 * UTC, signed in on `page`. Returns its user id.
 */
export async function freshSetUpAccount(page: Page, email: string) {
  const userId = await ensureAccount(email, { fresh: true });
  await signInWithPassword(page, email);
  await expect(page).toHaveURL(/\/onboarding/);
  await admin
    .from("profiles")
    .update({ onboarding_status: "completed", timezone: "UTC", availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }] })
    .eq("id", userId);
  return userId;
}
