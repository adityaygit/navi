import { test, expect } from "@playwright/test";
import { admin, freshSetUpAccount } from "./helpers";

// Buttons that need the server say so plainly when the device is offline,
// keep the page usable, and work once the connection is back.

test("actions taken while offline fail visibly and safely", async ({ page, context }, info) => {
  const userId = await freshSetUpAccount(page, `offline-actions-${info.project.name}@navi.test`);
  await admin.from("tasks").insert({ user_id: userId, title: "Return the drill" });
  await page.goto("/tasks");
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Complete Return the drill" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /offline|connection/i })).toBeVisible();
  // Still on the task list, nothing changed on the server.
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  const { data: still } = await admin.from("tasks").select("status").eq("user_id", userId).eq("title", "Return the drill").single();
  expect(still!.status).toBe("todo");

  // Same for a client-side screen: accepting an inbox suggestion.
  await admin.from("proposals").insert({ user_id: userId, kind: "task", payload: { title: "Buy stamps" }, source_excerpt: "buy stamps", origin: "stated", confidence: 0.9 });
  await context.setOffline(false);
  await page.goto("/inbox");
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /offline|connection/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review inbox", level: 1 })).toBeVisible();
  const { count } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("title", "Buy stamps");
  expect(count).toBe(0);

  await context.setOffline(false);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Complete Return the drill" }).click();
  await expect.poll(async () => (await admin.from("tasks").select("status").eq("user_id", userId).eq("title", "Return the drill").single()).data!.status).toBe("done");
});
