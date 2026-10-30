import { test, expect, type Page } from "@playwright/test";
import { admin, freshSetUpAccount, PASSWORD } from "./helpers";

// The person's control over their own data: a full export, a shared device
// where one person's unsent offline captures never reach someone else's
// account, and account deletion that removes everything.

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.goto("/more");
  await page.getByRole("main").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

const capturesOf = async (userId: string) => {
  const { data } = await admin.from("captures").select("raw_text").eq("user_id", userId);
  return (data ?? []).map((c) => c.raw_text as string);
};

test("unsent offline captures stay with the person who made them on a shared device", async ({ page, context }, info) => {
  const first = await freshSetUpAccount(page, `shared-a-${info.project.name}@navi.test`);
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Capture while the server can't be reached, so it waits on the device.
  await context.setOffline(true);
  await page.getByRole("button", { name: /\+ Capture/ }).click();
  await page.getByLabel("What's on your mind?").fill("private: call the clinic about results");
  await page.getByRole("dialog").getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByText(/Waiting to sync \(1\)/)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  // Back online, but captures still can't get through before they sign out.
  await page.route("**/api/capture", (r) => r.abort());
  await context.setOffline(false);
  await signOut(page);
  await page.unroute("**/api/capture");
  // Pages cached for offline reading are gone too.
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.endsWith("-pages")))).toEqual([]);

  // Someone else signs in on the same browser: they neither see nor send it.
  const second = await freshSetUpAccount(page, `shared-b-${info.project.name}@navi.test`);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByRole("button", { name: /\+ Capture/ }).click();
  await expect(page.getByText(/Waiting to sync/)).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(1000);
  expect(await capturesOf(second)).toEqual([]);
  await signOut(page);

  // The person who made it signs back in, and it syncs into their account.
  await signIn(page, `shared-a-${info.project.name}@navi.test`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => capturesOf(first), { timeout: 30_000 }).toEqual(["private: call the clinic about results"]);
  expect(await capturesOf(second)).toEqual([]);
});

test("export contains the person's data and deleting the account removes it", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `account-${info.project.name}@navi.test`);
  await admin.from("tasks").insert({ user_id: userId, title: "Renew passport" });
  await admin.from("memories").insert({ user_id: userId, kind: "profile", content: "Works best in the morning", origin: "stated" });

  const res = await page.request.get("/api/export");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="navi-export-\d{4}-\d{2}-\d{2}\.json"/);
  const data = await res.json();
  expect(data.user_id).toBe(userId);
  expect(data.tasks.map((t: { title: string }) => t.title)).toEqual(["Renew passport"]);
  expect(data.memories.map((m: { content: string }) => m.content)).toEqual(["Works best in the morning"]);
  // Only their own rows: every exported row belongs to them.
  for (const [table, rows] of Object.entries(data)) {
    if (!Array.isArray(rows) || table === "profiles") continue;
    for (const row of rows as { user_id?: string }[]) expect(row.user_id, table).toBe(userId);
  }

  await page.goto("/settings");
  const zone = page.getByRole("region", { name: "Delete account" });
  const button = zone.getByRole("button", { name: "Delete everything" });
  await expect(button).toBeDisabled();
  await zone.getByLabel("Type DELETE").fill("DELETE");
  await button.click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  const { data: gone } = await admin.auth.admin.getUserById(userId);
  expect(gone.user).toBeNull();
  for (const table of ["tasks", "memories", "profiles"]) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq(table === "profiles" ? "id" : "user_id", userId);
    expect(count, table).toBe(0);
  }
  // Signed out: private pages and APIs are closed.
  expect((await page.request.get("/api/export")).status()).toBe(401);
});
