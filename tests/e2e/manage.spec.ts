import { test, expect } from "@playwright/test";
import { admin, freshSetUpAccount, middayTimezone } from "./helpers";

// Day-to-day management flows on an already set-up account: focus, plan
// recovery, memory correction, approvals and settings. Each device profile
// gets its own invited account so runs don't interfere.

test("focus, recovery, memory, approvals and settings", async ({ page }, info) => {
  page.on("dialog", (d) => d.accept());
  const userId = await freshSetUpAccount(page, `e2e-${info.project.name}@navi.test`);
  // Midday in the account's zone, so there's free time left to plan today whenever the suite runs.
  await admin.from("profiles").update({ timezone: middayTimezone() }).eq("id", userId);
  const { data: task } = await admin.from("tasks").insert({ user_id: userId, title: "Write lab report", estimate_minutes: 30, priority: 2 }).select("id").single();
  const { data: doomed } = await admin.from("tasks").insert({ user_id: userId, title: "Old errand", estimate_minutes: 15 }).select("id").single();

  // Plan today on My day, focus on the planned block, finish it.
  await page.goto("/planner");
  await page.getByRole("button", { name: "Plan my day" }).click();
  const plan = page.getByRole("list", { name: "Timeline" });
  await expect(plan.getByText("Write lab report")).toBeVisible();
  await plan.locator("li", { hasText: "Write lab report" }).getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/focus/);
  const focus = page.getByRole("region", { name: "Focus" });
  await expect(focus.getByText("Write lab report")).toBeVisible();
  // Pause and resume: paused time doesn't count.
  await focus.getByRole("button", { name: "Pause" }).click();
  await expect(focus.getByRole("button", { name: "Resume" })).toBeVisible();
  await focus.getByRole("button", { name: "Resume" }).click();
  await focus.getByRole("button", { name: "I'm done" }).click();
  await focus.getByRole("button", { name: "Finished it" }).click();
  await expect(page).toHaveURL(/\/focus\?ended=/);
  await expect.poll(async () => (await admin.from("tasks").select("status").eq("id", task!.id).single()).data!.status).toBe("done");
  await page.goto("/planner");

  // "My plan broke": say why, get a re-plan, nothing unfinished is dropped.
  await page.getByRole("button", { name: "My plan broke" }).click();
  const dialog = page.getByRole("dialog", { name: "What happened?" });
  await dialog.getByLabel("Things took longer than planned").check();
  await dialog.getByLabel("Details (optional)").fill("lab ran long");
  await dialog.getByRole("button", { name: "Re-plan my day" }).click();
  await expect(dialog.getByRole("status")).toContainText(/Reworked the rest of today/i);
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
    details: { op: "delete", table: "tasks", id: doomed!.id, subject: "Old errand", reason: "deleting can't be undone" },
    idempotency_key: `e2e-${Date.now()}:1`,
  });
  await page.goto("/activity");
  const card = page.getByRole("group", { name: "Delete task: Old errand" });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("Deleted task “Old errand”")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nothing waiting.")).toBeVisible();
  await expect(page.locator("li", { hasText: "Deleted task “Old errand”" }).getByText("done", { exact: true })).toBeVisible();
  const { data: gone } = await admin.from("tasks").select("id").eq("id", doomed!.id);
  expect(gone).toHaveLength(0);
  await page.goto("/planner");
  await expect(page.getByRole("list", { name: "Timeline" }).getByText("Old errand")).toHaveCount(0);

  // Settings: name shows up on Today.
  await page.goto("/settings");
  await page.getByLabel("Name").fill("Sam Rivera");
  await page.getByRole("form", { name: "You & your schedule" }).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sam");
  await page.screenshot({ path: `test-results/${info.project.name}-manage-today.png`, fullPage: true });
});
