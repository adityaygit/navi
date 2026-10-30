import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev runs the scheduler tick server-side even when the app is closed.
// Set TRIGGER_PROJECT_REF after creating the project (npx trigger.dev@latest login / init).
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_set_me",
  dirs: ["./trigger"],
  maxDuration: 300,
  retries: { enabledInDev: false, default: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 } },
});
