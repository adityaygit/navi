#!/usr/bin/env node
// Manage who can use a Navi Supabase project: the invite list
// (public.allowed_emails) and the accounts themselves.
//
//   node scripts/allow-email.mjs add person@example.com ["note"]           # invite list + account, no email sent
//   node scripts/allow-email.mjs add person@example.com ["note"] --invite  # same, but Supabase emails them an invite link
//   node scripts/allow-email.mjs remove person@example.com
//   node scripts/allow-email.mjs list
//
// Accounts are only ever created here, server-side: the sign-in page cannot
// create accounts (public sign-up is off), so nobody can claim an invited
// email before its owner does. `add` creates a confirmed account with no
// password (idempotent: an existing account is left as is). The person signs
// in with an email link, then can set a password in Settings. `--invite`
// uses Supabase's invite email instead (needs working email delivery).
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
// environment, falling back to .env.local. Point it at production by
// exporting those two variables for the target project; the key is never
// printed. Removing an email blocks new sign-ups only; it does not delete an
// existing account.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [cmd, rawEmail, note] = args.filter((a) => !a.startsWith("--"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env.local).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const email = rawEmail?.trim().toLowerCase();
const valid = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Create the auth user server-side if it doesn't exist yet. Never sets a password. */
async function ensureAccount(email, invite) {
  if (await findUser(email)) {
    console.log(`Account already exists for ${email} (left unchanged)`);
    return;
  }
  if (invite) {
    const { error } = await db.auth.admin.inviteUserByEmail(email);
    if (error) throw error;
    console.log(`Invite email sent to ${email}`);
    return;
  }
  // Confirmed, passwordless: no email is sent. Sign-in is by email link.
  const { error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error && !/already (been )?registered|email_exists/i.test(`${error.code ?? ""} ${error.message}`)) throw error;
  console.log(`Account ready for ${email} (sign in with an email link; set a password in Settings)`);
}

async function findUser(email) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  console.log(`Project: ${new URL(url).host}`);
  if (cmd === "add" && valid(email)) {
    const { error } = await db.from("allowed_emails").upsert({ email, note: note ?? null });
    if (error) throw error;
    console.log(`Allowed ${email}`);
    await ensureAccount(email, flags.has("--invite"));
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
    console.error("Usage: node scripts/allow-email.mjs add <email> [note] [--invite] | remove <email> | list");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
