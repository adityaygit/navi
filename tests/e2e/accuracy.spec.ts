import { test, expect } from "@playwright/test";
import { DateTime } from "luxon";
import { admin, freshSetUpAccount } from "./helpers";

// Labels that must say what's true: a routine whose time can move isn't
// "fixed", and an accepted inbox question is kept (in Memory), not dropped.

test("routines are labelled fixed only when they are", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `labels-${info.project.name}@navi.test`);
  const tomorrow = DateTime.utc().plus({ days: 1 });
  const dow = tomorrow.weekday % 7;
  await admin.from("routines").insert({ user_id: userId, title: "Evening reading", days: [dow], start_time: "19:00", duration_minutes: 30, is_fixed: false });
  await admin.from("routines").insert({ user_id: userId, title: "Swim practice", days: [dow], start_time: "16:00", duration_minutes: 60, is_fixed: true });
  await page.goto(`/planner?start=${tomorrow.toISODate()}&view=day`);
  const day = page.getByRole("region", { name: tomorrow.toFormat("cccc LLL d") });
  await expect(day.locator("li", { hasText: "Evening reading" }).locator(".badge")).toHaveText("routine");
  await expect(day.locator("li", { hasText: "Swim practice" }).locator(".badge")).toHaveText("fixed");
});

test("accepting an inbox question saves it to memory", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `question-${info.project.name}@navi.test`);
  await admin.from("proposals").insert({ user_id: userId, kind: "question", payload: { question: "Should I drop AP chemistry?" }, source_excerpt: "should i drop ap chem", origin: "stated", confidence: 0.9 });
  await page.goto("/inbox");
  const card = page.getByRole("article", { name: "Question: Should I drop AP chemistry?" });
  await expect(card.getByText("Saving keeps it in Memory as an open question")).toBeVisible();
  await card.getByRole("button", { name: "Save to memory" }).click();
  await expect(card).toHaveCount(0);
  await page.goto("/memory");
  await expect(page.getByText("Open question: Should I drop AP chemistry?")).toBeVisible();
});
