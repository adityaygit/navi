import { test, expect } from "@playwright/test";
import { admin, freshSetUpAccount } from "./helpers";

// Web Today with an overdue Canvas backlog: one "needs a decision" row,
// the person's own work listed normally, "All handed in" clears the row.

test("Today shows overdue Canvas imports as one decision row, and resolving them clears it", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `today-triage-${info.project.name}@navi.test`);
  const now = Date.now();
  const rows = Array.from({ length: 9 }, (_, i) => ({ user_id: userId, title: `Old worksheet ${i} [Chem]`, source: "external", external_ref: `ext:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, due_at: new Date(now - (3 + i) * 86400_000).toISOString(), due_is_hard: true, priority: 2 }));
  rows.push({ user_id: userId, title: "My own late essay", source: "user", external_ref: null as unknown as string, due_at: new Date(now - 2 * 86400_000).toISOString(), due_is_hard: false, priority: 2 });
  const { error } = await admin.from("tasks").insert(rows);
  expect(error).toBeNull();

  await page.goto("/tasks");
  const row = page.getByRole("region", { name: "Past-due Canvas items" });
  await expect(row).toContainText("9 past-due Canvas items need a decision");
  await expect(page.getByRole("region", { name: "Overdue" })).toContainText("My own late essay");
  await expect(page.getByRole("region", { name: "Overdue" })).not.toContainText("Old worksheet");
  await row.getByRole("button", { name: "Show" }).click();
  await expect(row).toContainText("Old worksheet 0 [Chem]");
  await page.screenshot({ path: test.info().outputPath("today-triage.png"), fullPage: true });

  await row.getByRole("button", { name: "All handed in" }).click();
  await row.getByRole("button", { name: "Mark all 9 done" }).click();
  await expect(page.getByRole("region", { name: "Past-due Canvas items" })).toHaveCount(0);
  const { count } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("source", "external").eq("status", "done");
  expect(count).toBe(9);
});
