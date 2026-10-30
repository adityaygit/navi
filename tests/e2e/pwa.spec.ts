import { test, expect } from "@playwright/test";
import { freshSetUpAccount } from "./helpers";

// Installable-app behaviour that can be checked in Chromium: the manifest,
// the service worker turning a push message into a notification, and pages
// still opening offline. Real iPhone install and push remain a device check.

// The headless shell always denies notifications; full Chromium (new headless) doesn't.
test.use({ channel: "chromium" });

test("manifest describes an installable app", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ name: "Navi", start_url: "/", scope: "/", display: "standalone" });
  const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of m.icons) expect((await request.get(icon.src)).headers()["content-type"]).toBe("image/png");
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toContain("/?capture=1");
});

test("service worker shows pushed notifications and keeps pages available offline", async ({ page, context, baseURL }, info) => {
  await context.grantPermissions(["notifications"], { origin: baseURL! });
  await freshSetUpAccount(page, `pwa-${info.project.name}@navi.test`);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  // Deliver a push message the way the browser's push service would.
  const cdp = await context.newCDPSession(page);
  const registrationId = await new Promise<string>((resolve) => {
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e: { registrations: { registrationId: string; scopeURL: string; isDeleted: boolean }[] }) => {
      const r = e.registrations.find((x) => !x.isDeleted && x.scopeURL.endsWith("/"));
      if (r) resolve(r.registrationId);
    });
    void cdp.send("ServiceWorker.enable");
  });
  const origin = new URL(page.url()).origin;
  const shown = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, url: n.data?.url })));
  // DevTools push delivery is occasionally dropped by the browser harness, so
  // a missing notification gets one more delivery before the test fails.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId,
      data: JSON.stringify({ title: "Due soon", body: "“Essay” is due Fri 5:00 PM.", url: "/tasks", tag: "due2h:test" }),
    });
    let n: unknown[] = [];
    for (let i = 0; i < 20 && !n.length; i++) {
      n = await shown();
      if (!n.length) await page.waitForTimeout(100);
    }
    if (n.length) break;
  }
  await expect.poll(shown).toEqual([{ title: "Due soon", body: "“Essay” is due Fri 5:00 PM.", url: "/tasks" }]);

  // Pages this person opened stay readable offline; others fall back to the offline page.
  await page.goto("/inbox");
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review inbox");
  await page.goto("/insights").catch(() => undefined);
  await expect(page.getByText(/offline/i).first()).toBeVisible();
  await context.setOffline(false);
});
