#!/usr/bin/env node
// Turn the constraint-first planner (planner v2) on or off for ONE account,
// or show its state. It sets profiles.preferences.planner_v2; nothing else
// about the account changes, and turning it off returns to the old planner
// with the person's plans left as they are.
//
//   node scripts/planner-flag.mjs status person@example.com
//   node scripts/planner-flag.mjs on person@example.com
//   node scripts/planner-flag.mjs off person@example.com
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment, falling back to .env.local (the local stack). Locally, run it
// as: scripts/local-only.sh node scripts/planner-flag.mjs on dev@navi.test
// The hosted project needs migration 20261110000001_constraint_planning
// applied first (owner approval); the script refuses if it isn't.
// The key is never printed.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const [cmd, rawEmail] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env.local).");
  process.exit(1);
}
if (!["on", "off", "status"].includes(cmd) || !rawEmail) {
  console.error("Usage: node scripts/planner-flag.mjs on|off|status person@example.com");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const email = rawEmail.trim().toLowerCase();

// The new planner needs its tables; refuse on a project without the migration.
const probe = await db.from("plan_changesets").select("id", { head: true, count: "exact" }).limit(1);
if (probe.error) {
  console.error(`This project doesn't have the planner v2 migration yet (${probe.error.message}). Apply 20261110000001_constraint_planning.sql first.`);
  process.exit(1);
}

let user = null;
for (let page = 1; page < 50 && !user; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error(`Could not list accounts: ${error.message}`);
    process.exit(1);
  }
  user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 200) break;
}
if (!user) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}
const { data: profile, error } = await db.from("profiles").select("preferences").eq("id", user.id).single();
if (error) {
  console.error(`Could not read the profile: ${error.message}`);
  process.exit(1);
}
const prefs = profile.preferences ?? {};
if (cmd === "status") {
  console.log(`${email}: new planner ${prefs.planner_v2 === true ? "ON" : "off"}`);
  process.exit(0);
}
const next = { ...prefs, planner_v2: cmd === "on" };
const { error: upErr } = await db.from("profiles").update({ preferences: next }).eq("id", user.id);
if (upErr) {
  console.error(`Could not update: ${upErr.message}`);
  process.exit(1);
}
await db.from("activity_log").insert({ user_id: user.id, actor: "system", action: "settings_updated", summary: `New planner turned ${cmd} (admin script)` });
console.log(`${email}: new planner ${cmd === "on" ? "ON" : "off"}`);
