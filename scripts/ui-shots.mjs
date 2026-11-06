#!/usr/bin/env node
// Screenshots of app pages at phone and desktop width, signed in as the local
// demo account (scripts/demo-seed.mjs). Usage:
//   node scripts/ui-shots.mjs <outDir> [baseUrl] [path ...]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const [outDir = "ui-shots", base = "http://localhost:3100", ...paths] = process.argv.slice(2);
const pages = paths.length ? paths : ["/", "/chat", "/insights", "/inbox", "/planner", "/projects", "/tasks", "/memory", "/notes", "/activity", "/settings", "/review", "/more"];
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const [name, opts] of [
  ["phone", { ...devices["iPhone 13"], deviceScaleFactor: 2 }],
  ["desktop", { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 }],
]) {
  const ctx = await browser.newContext({ ...opts, timezoneId: "UTC", colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(process.env.DEMO_EMAIL ?? "demo@navi.local");
  await page.getByLabel("Password").fill("test-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  for (const p of pages) {
    await page.goto(`${base}${p}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(600);
    const file = `${outDir}/${name}${p === "/" ? "-today" : p.replaceAll("/", "-").replace(/[?=&]/g, "_")}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
  await ctx.close();
}
await browser.close();
