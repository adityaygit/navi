import { test, expect } from "@playwright/test";
import { admin, freshSetUpAccount, signInWithPassword } from "./helpers";

// Settings → Notifications → Delivery details: the server's view of this
// person's devices and what happened to recent notifications, so a missing
// push on the phone can be diagnosed without developer tools.

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";

test("delivery details list devices and recent notification outcomes, and remove only your own device", async ({ page }, info) => {
  const userId = await freshSetUpAccount(page, `pushdiag-${info.project.name}@navi.test`);
  const other = await freshSetUpAccount(page, `pushdiag-other-${info.project.name}@navi.test`);
  const tag = `${info.project.name}-${Date.now()}`;
  const { data: mine } = await admin.from("push_subscriptions").insert({
    user_id: userId, endpoint: `https://web.push.apple.com/diag-${tag}`, p256dh: "p".repeat(40), auth: "a".repeat(16),
    user_agent: IPHONE_UA, last_success_at: new Date(Date.now() - 3_600_000).toISOString(),
  }).select("id").single();
  const { data: theirs } = await admin.from("push_subscriptions").insert({
    user_id: other, endpoint: `https://fcm.googleapis.com/fcm/send/diag-${tag}`, p256dh: "p".repeat(40), auth: "a".repeat(16),
  }).select("id").single();
  // One insert per row: a bulk insert with differing keys would send NULLs.
  for (const row of [
    { user_id: userId, kind: "briefing", title: "Good morning", body: "x", dedupe_key: `diag-a-${tag}`, status: "sent", sent_at: new Date().toISOString() },
    { user_id: userId, kind: "reminder", title: "Essay due soon", body: "x", dedupe_key: `diag-b-${tag}`, status: "held_quiet_hours", deliver_after: new Date(Date.now() + 3_600_000).toISOString() },
    { user_id: userId, kind: "reminder", title: "Call the clinic", body: "x", dedupe_key: `diag-c-${tag}`, status: "failed", last_error: "push service answered HTTP 403" },
  ]) {
    const { error } = await admin.from("notifications").insert(row);
    expect(error).toBeNull();
  }

  // Signed in as the second account (freshSetUpAccount signed in last): it can't see or remove the first one's device.
  const peek = await page.request.post("/api/push/status", { data: {} });
  expect(peek.ok()).toBe(true);
  const peekBody = await peek.json();
  expect(peekBody.devices.map((d: { id: string }) => d.id)).toEqual([theirs!.id]);
  expect(JSON.stringify(peekBody)).not.toContain("diag-"); // endpoints never leave the server
  const steal = await page.request.delete("/api/push/status", { data: { id: mine!.id } });
  expect(steal.ok()).toBe(true);
  expect((await admin.from("push_subscriptions").select("id").eq("id", mine!.id)).data).toHaveLength(1);

  await page.context().clearCookies();
  await signInWithPassword(page, `pushdiag-${info.project.name}@navi.test`);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/settings");
  await page.getByText("Delivery details").click();
  const devices = page.getByRole("region", { name: "Devices with notifications on" });
  await expect(devices.getByText("Safari on iPhone · Apple")).toBeVisible();
  await expect(devices.getByText(/last delivered/)).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent notifications" });
  await expect(recent.getByText(/Good morning.*delivered to the push service/)).toBeVisible();
  await expect(recent.getByText(/Essay due soon.*held for quiet hours, sends after/)).toBeVisible();
  await expect(recent.getByText(/Call the clinic.*failed \(push service answered HTTP 403\)/)).toBeVisible();

  await devices.getByRole("button", { name: "Remove Safari on iPhone" }).click();
  await expect(devices.getByText("No device has notifications on.")).toBeVisible();
  expect((await admin.from("push_subscriptions").select("id").eq("user_id", userId)).data).toHaveLength(0);
  await admin.from("push_subscriptions").delete().eq("id", theirs!.id);
});
