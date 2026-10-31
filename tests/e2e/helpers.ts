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

// Real zones without daylight saving, by UTC offset (hours).
const NO_DST_ZONES: Record<number, string> = {
  [-11]: "Pacific/Pago_Pago", [-10]: "Pacific/Honolulu", [-9]: "Pacific/Gambier", [-8]: "Pacific/Pitcairn", [-7]: "America/Phoenix",
  [-6]: "America/Regina", [-5]: "America/Panama", [-4]: "America/Puerto_Rico", [-3]: "America/Sao_Paulo", [-2]: "America/Noronha",
  [-1]: "Atlantic/Cape_Verde", 0: "UTC", 1: "Africa/Lagos", 2: "Africa/Johannesburg", 3: "Europe/Moscow", 4: "Asia/Dubai",
  5: "Asia/Karachi", 6: "Asia/Dhaka", 7: "Asia/Bangkok", 8: "Asia/Shanghai", 9: "Asia/Tokyo", 10: "Australia/Brisbane",
  11: "Pacific/Noumea", 12: "Pacific/Fiji",
};

/**
 * A time zone where it's around midday right now, for tests that need free
 * time left "today" (planning today fails honestly late at night).
 */
export function middayTimezone(): string {
  return NO_DST_ZONES[12 - new Date().getUTCHours()];
}
