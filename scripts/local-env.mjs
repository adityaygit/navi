#!/usr/bin/env node
// Writes .env.local for local development and CI from the running local
// Supabase stack (npm run db:start), with freshly generated push keys and
// scheduler secret. Uses the development simulator, never real AI providers.
// Never prints values; refuses to overwrite an existing file without --force.
//
//   node scripts/local-env.mjs [--force]
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const file = ".env.local";
if (existsSync(file) && !process.argv.includes("--force")) {
  console.error(`${file} already exists; pass --force to replace it.`);
  process.exit(1);
}
const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const vapid = webpush.generateVAPIDKeys();
const values = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: "false",
  NAVI_AI_PROVIDER: "devsim",
  NAVI_DAILY_BUDGET_USD: "2",
  CRON_SECRET: randomBytes(32).toString("hex"),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:dev@navi.test",
};
const missing = Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Local Supabase didn't report: ${missing.join(", ")}. Is it running (npm run db:start)?`);
  process.exit(1);
}
writeFileSync(file, Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
console.log(`Wrote ${file} (${Object.keys(values).length} settings, development simulator, local database).`);
