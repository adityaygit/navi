import { test, expect } from "@playwright/test";
import { admin, freshSetUpAccount } from "./helpers";

// The guided daily review: Today points at yesterday's unmarked blocks, the
// review screen records what happened (with a note), shows the computed
// review, refreshes the stored one, and plans the next day with a summary of
// what the planner did. Also: stopping focus asks why, and an observed
// pattern shows its evidence in Memory.

test("daily review: mark yesterday, see the review, plan ahead", async ({ page }, info) => {
  page.on("dialog", (d) => d.accept());
  const userId = await freshSetUpAccount(page, `review-${info.project.name}@navi.test`);
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const ymd = yesterday.toISOString().slice(0, 10);
  const at = (h: number) => new Date(yesterday.getTime() + h * 3_600_000).toISOString();
  const { data: task } = await admin.from("tasks").insert({ user_id: userId, title: "Read chapter 5", estimate_minutes: 30 }).select("id").single();
  for (const [title, h] of [["Read chapter 5", 10], ["Email coach", 11]] as const) {
    const { error } = await admin.from("plan_blocks").insert({ user_id: userId, title, task_id: title === "Read chapter 5" ? task!.id : null, plan_date: ymd, starts_at: at(h), ends_at: at(h + 0.5), created_by: "navi" });
    expect(error).toBeNull();
  }
  // An evening review was saved last night, before anything was marked.
  await admin.from("briefings").insert({ user_id: userId, kind: "evening", local_date: ymd, title: "Evening review", body: "stale" });
  await admin.from("memories").insert({ user_id: userId, kind: "behavioral", content: "Tends to put off “Tax forms”: skipped 3 times in 3 weeks without an outside reason.", origin: "observed", confidence: 0.6, evidence: [{ pattern: "avoid:x", week_end: "2026-10-25", supports: true, summary: "skipped 3 times without an outside reason (3 weeks to 2026-10-25)" }] });

  await page.goto("/");
  await expect(page.getByText("2 blocks from yesterday aren't marked yet")).toBeVisible();
  await page.getByRole("link", { name: "Mark yesterday" }).click();
  await expect(page).toHaveURL(new RegExp(`/review\\?date=${ymd}`));
  await expect(page.getByText("2 blocks not marked yet.")).toBeVisible();

  const reading = page.getByRole("group", { name: "How did “Read chapter 5” go?" });
  await page.getByLabel("Note (optional)").first().fill("the intro took ages");
  await reading.getByRole("button", { name: "Took longer than estimated" }).click();
  const marked = page.locator("li", { hasText: "Read chapter 5" });
  await expect(marked.getByText("took longer than estimated", { exact: true })).toBeVisible();
  await expect(marked.getByText("Note: Took longer than estimated: the intro took ages")).toBeVisible();
  await page.getByRole("group", { name: "How did “Email coach” go?" }).getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Every block is marked.")).toBeVisible();

  const review = page.getByRole("region", { name: "2. How the day went" });
  await expect(review.getByText("1 done and 0 partly done out of 1 counted blocks (partial = half credit) = 100%.", { exact: false })).toBeVisible();
  await expect(review.getByText(/didn't get done because work took longer than estimated/)).toBeVisible();
  const { data: stored } = await admin.from("briefings").select("body").eq("user_id", userId).eq("kind", "evening").eq("local_date", ymd).single();
  expect(stored!.body).toMatch(/1 done and 0 partly done out of 1 counted blocks/);

  // Plan the next day (here: the rest of today) and see what the planner did.
  const plan = page.getByRole("region", { name: "3. Plan the rest of today" });
  await plan.getByRole("button", { name: "Plan the rest of today" }).click();
  // Late in the day there may be no room left: then it says so instead of placing anything.
  await expect(plan.getByRole("status")).toContainText(/placed \d+ blocks?|Didn't fit: “Read chapter 5” \(30 min left\)/);

  // Today no longer nags about yesterday; tonight's review plans tomorrow.
  await page.goto("/");
  await expect(page.getByText(/from yesterday aren't marked yet|from yesterday isn't marked yet/)).toHaveCount(0);
  await page.goto("/review");
  await page.getByRole("button", { name: "Plan tomorrow" }).click();
  await expect(page.getByRole("region", { name: "3. Plan tomorrow" }).getByRole("status")).toContainText(/placed|no flexible blocks/);

  // Stopping focus asks why; with no reason the block counts as skipped.
  await page.goto("/");
  const today = page.getByRole("region", { name: "Today's plan" });
  const replan = page.getByRole("button", { name: "Re-plan today" });
  await replan.click();
  await expect(replan.locator("xpath=..").getByRole("status")).toContainText(/\w{3} \w{3} \d+: (placed \d+ blocks?|no flexible blocks placed)/);
  // A block running right now (made by the person, so re-planning leaves it), whatever the time of day.
  const start = new Date(Date.now() - 5 * 60_000);
  await admin.from("plan_blocks").insert({ user_id: userId, title: "Focus drill", task_id: task!.id, plan_date: new Date().toISOString().slice(0, 10), starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 30 * 60_000).toISOString(), created_by: "user" });
  await page.reload();
  await today.locator("li", { hasText: "Focus drill" }).getByRole("button", { name: "Focus" }).click();
  const focus = page.getByRole("region", { name: "Focus session" });
  await focus.getByRole("button", { name: "Stop" }).click();
  await expect(focus.getByText("Why stop? Without a reason, this block counts as skipped.")).toBeVisible();
  await focus.getByRole("button", { name: "No reason, just stop" }).click();
  await expect(focus).toBeHidden();
  await expect(today.locator("li", { hasText: "Focus drill" }).getByText("skipped", { exact: true })).toBeVisible();
  const { data: drill } = await admin.from("plan_blocks").select("status,outcome_reason").eq("user_id", userId).eq("title", "Focus drill").single();
  expect(drill).toEqual({ status: "skipped", outcome_reason: "Stopped the focus session without a reason" });

  // An observed pattern shows the evidence behind it.
  await page.goto("/memory");
  const mem = page.locator("li", { hasText: "Tends to put off “Tax forms”" });
  await expect(mem.getByText("Observed from your activity")).toBeVisible();
  await mem.getByText("Evidence (1)").click();
  await expect(mem.getByText("Week ending 2026-10-25: skipped 3 times without an outside reason (3 weeks to 2026-10-25)")).toBeVisible();
});
