import { defineConfig, devices } from "@playwright/test";

// Runs against an already-running app (npm run build && npm start) backed by
// local Supabase with NAVI_AI_PROVIDER=devsim. See BUILD_INTELLIGENCE.md.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  // The browser runs in UTC to match the test accounts (set up in UTC); otherwise
  // Navi adopts the machine's timezone and time-based checks shift.
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", timezoneId: "UTC", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    // Navi 1.5 is a desktop app (Windows and Mac), not a phone app (owner, 2026-11-07).
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
