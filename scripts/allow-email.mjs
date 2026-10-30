#!/usr/bin/env node
// Manage the invite list (public.allowed_emails) of a Navi Supabase project.
//
//   node scripts/allow-email.mjs add person@example.com ["note"]
//   node scripts/allow-email.mjs remove person@example.com
//   node scripts/allow-email.mjs list
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment, falling back to .env.local. Point it at production by
// exporting those two variables for the target project; the key is never
// printed. Removing an email blocks new sign-ups only; it does not delete an
// existing account.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const [cmd, rawEmail, note] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env.local).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const email = rawEmail?.trim().toLowerCase();
const valid = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function main() {
  console.log(`Project: ${new URL(url).host}`);
  if (cmd === "add" && valid(email)) {
    const { error } = await db.from("allowed_emails").upsert({ email, note: note ?? null });
    if (error) throw error;
    console.log(`Allowed ${email}`);
  } else if (cmd === "remove" && valid(email)) {
    const { error } = await db.from("allowed_emails").delete().eq("email", email);
    if (error) throw error;
    console.log(`Removed ${email} (existing accounts are not deleted)`);
  } else if (cmd === "list") {
    const { data, error } = await db.from("allowed_emails").select("email,note,created_at").order("created_at");
    if (error) throw error;
    for (const r of data) console.log(`${r.email}${r.note ? `  (${r.note})` : ""}`);
    if (data.length === 0) console.log("(empty: nobody can sign up)");
  } else {
    console.error("Usage: node scripts/allow-email.mjs add <email> [note] | remove <email> | list");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
