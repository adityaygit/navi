import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// Day-to-day management flows on an already set-up account: focus, plan
// recovery, memory correction, approvals and settings. Each device profile
// gets its own invited account so runs don't interfere.

config({ path: ".env.local", quiet: true });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PASSWORD = "test-password-123";

async function freshSetUpAccount(page: Page, email: string) {
  await admin.from("allowed_emails").upsert({ email, note: "e2e manage spec" });
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
  // Skip the setup conversation (covered by core.spec) with a known schedule.
  await admin
    .from("profiles")
    .update({ onboarding_status: "completed", timezone: "UTC", availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }] })
    .eq("id", userId);
  return userId;
}

test("focus, recovery, memory, approvals and settings", async ({ page }, info) => {
  page.on("dialog", (d) => d.accept());
  const userId = await freshSetUpAccount(page, `e2e-${info.project.name}@navi.test`);
  const { data: task } = await admin.from("tasks").insert({ user_id: userId, title: "Write lab report", estimate_minutes: 30, priority: 2 }).select("id").single();
  const { data: doomed } = await admin.from("tasks").insert({ user_id: userId, title: "Old errand", estimate_minutes: 15 }).select("id").single();

  // Plan today, focus on the planned block, finish it.
  await page.goto("/");
  await page.getByRole("button", { name: "Re-plan today" }).click();
  const plan = page.getByRole("region", { name: "Today's plan" });
  await expect(plan.getByText("Write lab report")).toBeVisible();
  await plan.locator("li", { hasText: "Write lab report" }).getByRole("button", { name: "Focus" }).click();
  const focus = page.getByRole("region", { name: "Focus session" });
  await expect(focus.getByText("Write lab report")).toBeVisible();
  await focus.getByRole("button", { name: "Finished the task" }).click();
  await expect(focus).toBeHidden();
  await expect(plan.getByText(/1\/\d+ done/)).toBeVisible();
  const { data: doneTask } = await admin.from("tasks").select("status").eq("id", task!.id).single();
  expect(doneTask!.status).toBe("done");

  // "My plan broke": say why, get a re-plan, nothing unfinished is dropped.
  await page.getByRole("button", { name: "My plan broke" }).click();
  const dialog = page.getByRole("dialog", { name: "What happened?" });
  await dialog.getByLabel("Things took longer than planned").check();
  await dialog.getByLabel("Details (optional)").fill("lab ran long");
  await dialog.getByRole("button", { name: "Re-plan my day" }).click();
  await expect(dialog.getByRole("status")).toContainText(/re-planned/i);
  await dialog.getByRole("button", { name: "Close" }).click();
  const { data: errand } = await admin.from("tasks").select("status").eq("id", doomed!.id).single();
  expect(errand!.status).toBe("todo");

  // Memory: add, correct, delete.
  await page.goto("/memory");
  await page.getByRole("button", { name: "+ Tell Navi something to remember" }).click();
  await page.getByLabel("What should Navi remember?").fill("I study best in the morning");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const mem = page.locator("li", { hasText: "I study best in the morning" });
  await expect(mem).toBeVisible();
  await expect(mem.getByText("You told Navi")).toBeVisible();
  await mem.getByRole("button", { name: "Correct" }).click();
  await page.getByLabel("Correct this memory").fill("I study best after 7pm");
  await page.getByRole("button", { name: "Save correction" }).click();
  const corrected = page.locator("li", { hasText: "I study best after 7pm" });
  await expect(corrected).toBeVisible();
  await corrected.getByRole("button", { name: "Delete" }).click();
  await expect(corrected).toBeHidden();

  // Approvals: a deletion Navi asked for waits here, and runs once approved.
  await admin.from("approvals").insert({
    user_id: userId,
    action_type: "internal.delete.tasks",
    summary: "Delete task “Old errand”",
    details: { op: "delete", table: "tasks", id: doomed!.id },
    idempotency_key: `e2e-${Date.now()}:1`,
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Approvals waiting (1)" }).click();
  await expect(page).toHaveURL(/\/activity/);
  const card = page.getByRole("article").filter({ hasText: "Delete task “Old errand”" });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Nothing waiting.")).toBeVisible();
  await expect(page.locator("li", { hasText: "Delete task “Old errand”" }).getByText("executed")).toBeVisible();
  const { data: gone } = await admin.from("tasks").select("id").eq("id", doomed!.id);
  expect(gone).toHaveLength(0);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Today's plan" }).getByText("Old errand")).toHaveCount(0);

  // Settings: name shows up on Today.
  await page.goto("/settings");
  await page.getByLabel("Name").fill("Sam Rivera");
  await page.getByRole("form", { name: "You & your schedule" }).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sam");
  await page.screenshot({ path: `test-results/${info.project.name}-manage-today.png`, fullPage: true });
});
