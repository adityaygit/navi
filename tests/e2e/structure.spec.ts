import { test, expect } from "@playwright/test";
import { DateTime } from "luxon";
import { admin, freshSetUpAccount } from "./helpers";

// Building structure by hand: goals, projects, milestones, and fixed
// commitments in the planner that flexible work is scheduled around.

test("goals, projects, milestones and fixed commitments", async ({ page }, info) => {
  // Each create form has its own "Add"; click the one in the form holding this field.
  const addFor = (label: string) => page.getByLabel(label, { exact: true }).locator("xpath=ancestor::form").getByRole("button", { name: "Add", exact: true }).click();
  const userId = await freshSetUpAccount(page, `structure-${info.project.name}@navi.test`);

  // Goal → project linked to it → milestone done.
  await page.goto("/projects");
  await page.getByRole("button", { name: "+ goal" }).click();
  await page.getByLabel("New goal").fill("Make the varsity team");
  await page.getByLabel("How you'll measure it").fill("Selected at tryouts");
  await addFor("New goal");
  await expect(page.getByText("Make the varsity team").first()).toBeVisible();

  await page.getByRole("button", { name: "+ project" }).click();
  await page.getByLabel("New project").fill("Conditioning plan");
  await page.getByLabel("Goal", { exact: true }).selectOption({ label: "Make the varsity team" });
  await addFor("New project");
  await page.getByRole("link", { name: "Conditioning plan" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Conditioning plan" })).toBeVisible();
  const { data: project } = await admin.from("projects").select("id,goals(title)").eq("user_id", userId).eq("name", "Conditioning plan").single();
  expect((project!.goals as unknown as { title: string }).title).toBe("Make the varsity team");

  const milestones = page.getByRole("region", { name: "Milestones" });
  await milestones.getByRole("button", { name: "+ Milestone" }).click();
  await page.getByLabel("New milestone").fill("Run 5k under 25 min");
  await addFor("New milestone");
  const ms = milestones.locator("li", { hasText: "Run 5k under 25 min" });
  await expect(ms).toBeVisible();
  await ms.getByRole("button", { name: "Done" }).click();
  await expect(ms.getByRole("button", { name: "Reopen" })).toBeVisible();

  // A fixed commitment tomorrow; planned flexible work must not overlap it.
  for (let i = 0; i < 12; i++) {
    await admin.from("tasks").insert({ user_id: userId, title: `Practice drill ${i + 1}`, estimate_minutes: 90, priority: 3 });
  }
  const tomorrowDt = DateTime.utc().plus({ days: 1 });
  const tomorrow = tomorrowDt.toISODate()!;
  // Free only tomorrow 09:00–13:00, so the plan has to work around the dentist.
  await admin.from("profiles").update({ availability: [{ days: [tomorrowDt.weekday % 7], start: "09:00", end: "13:00" }] }).eq("id", userId);
  await page.goto("/planner");
  await page.getByRole("button", { name: "+ Add fixed commitment" }).click();
  await page.getByLabel("What").fill("Dentist");
  await page.getByLabel("Date").fill(tomorrow);
  await page.getByLabel("Start").fill("10:00");
  await page.getByLabel("End").fill("11:30");
  await addFor("What");
  await expect(page.getByText("Added")).toBeVisible();
  await page.getByRole("button", { name: "Plan next 7 days" }).click();
  await expect(page.getByText(/Practice drill \d+/).first()).toBeVisible();
  await expect(page.getByText("Dentist").first()).toBeVisible();

  const dentistStart = `${tomorrow}T10:00:00Z`;
  const dentistEnd = `${tomorrow}T11:30:00Z`;
  const { data: blocks } = await admin.from("plan_blocks").select("title,starts_at,ends_at,is_flexible").eq("user_id", userId);
  expect(blocks!.length).toBeGreaterThan(0);
  const overlapping = blocks!.filter((b) => b.is_flexible && Date.parse(b.starts_at) < Date.parse(dentistEnd) && Date.parse(b.ends_at) > Date.parse(dentistStart));
  expect(overlapping).toEqual([]);
  const tomorrowBlocks = blocks!.filter((b) => b.starts_at.startsWith(tomorrow));
  expect(tomorrowBlocks.some((b) => Date.parse(b.ends_at) <= Date.parse(dentistStart))).toBe(true);
  expect(tomorrowBlocks.some((b) => Date.parse(b.starts_at) >= Date.parse(dentistEnd))).toBe(true);
  // The day reads in time order: work before the dentist, the dentist, work after.
  const day = await page.getByRole("region", { name: tomorrowDt.toFormat("cccc LLL d") }).innerText();
  const before = day.indexOf("Practice drill");
  const dentist = day.indexOf("Dentist");
  expect(before).toBeGreaterThanOrEqual(0);
  expect(before).toBeLessThan(dentist);
  expect(day.indexOf("Practice drill", dentist)).toBeGreaterThan(dentist);
  await page.screenshot({ path: `test-results/${info.project.name}-planner.png`, fullPage: true });
});
