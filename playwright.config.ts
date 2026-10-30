import { defineConfig, devices } from "@playwright/test";

// Runs against an already-running app (npm run build && npm start) backed by
// local Supabase with NAVI_AI_PROVIDER=devsim. See BUILD_INTELLIGENCE.md.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
