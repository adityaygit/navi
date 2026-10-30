import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { assertLocalSupabase } from "../local-guard";

config({ path: ".env.local", quiet: true });
assertLocalSupabase();
export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
export const PASSWORD = "test-password-123";

/**
 * A brand-new invited account that has skipped setup and is free all day in
 * UTC, signed in on `page`. Returns its user id.
 */
export async function freshSetUpAccount(page: Page, email: string) {
  await admin.from("allowed_emails").upsert({ email, note: "e2e" });
  const { data } = await admin.auth.admin.listUsers();
  const old = data.users.find((u) => u.email === email);
  if (old) await admin.auth.admin.deleteUser(old.id);
  await page.goto("/login");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  const { data: after } = await admin.auth.admin.listUsers();
  const userId = after.users.find((u) => u.email === email)!.id;
  await admin
    .from("profiles")
    .update({ onboarding_status: "completed", timezone: "UTC", availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }] })
    .eq("id", userId);
  return userId;
}
