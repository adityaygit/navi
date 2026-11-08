import { test, expect } from "@playwright/test";
import { admin, freshSetUpAccount, middayTimezone } from "./helpers";

// Planner v2 in My day (flag on for this account only): with no saved free
// times, "Plan my day" plans in time Navi assumes is free and says so (D1,
// at most two assumptions); answering "No, busy" saves that for the day and
// re-plans the work out of that time.

test("planner v2: a no-setup day is planned in assumed time, and “No, busy” moves the work", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `planner-v2-${info.project.name}@navi.test`);
  await admin
    .from("profiles")
    .update({ timezone: middayTimezone(), availability: [], preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00" } })
    .eq("id", userId);
  const { data: task } = await admin.from("tasks").insert({ user_id: userId, title: "Essay draft", estimate_minutes: 30 }).select("id").single();

  await page.goto("/planner");
  await page.getByRole("button", { name: "Plan my day" }).click();
  await expect(page.getByText("Essay draft").first()).toBeVisible();
  await expect(page.getByText("in time Navi assumed is free").first()).toBeVisible();
  const assumptions = page.getByLabel("Navi's assumptions");
  await expect(assumptions.getByText("I assumed you're free").first()).toBeVisible();
  // Old-planner notice about missing free times isn't shown to v2 accounts.
  await expect(page.getByText(/doesn't know your availability/i)).toHaveCount(0);

  const first = async () =>
    (await admin.from("plan_blocks").select("id, starts_at, basis").eq("user_id", userId).eq("task_id", task!.id).eq("status", "planned")).data ?? [];
  const before = await first();
  expect(before).toHaveLength(1);
  expect(before[0].basis).toBe("inferred");

  await assumptions.getByRole("button", { name: /^No, I'm busy/ }).first().click();
  await expect
    .poll(async () => (await admin.from("day_exceptions").select("kind").eq("user_id", userId)).data?.map((r) => r.kind))
    .toEqual(["busy"]);
  await expect.poll(async () => (await first())[0]?.starts_at, { timeout: 15_000 }).not.toBe(before[0].starts_at);
  // Same block, moved (B7: re-plans keep ids).
  expect((await first())[0].id).toBe(before[0].id);
});
