#!/usr/bin/env node
// Read-only pre-deploy check: is this environment configured the way a real
// (production) Navi needs? Never prints secret values and changes nothing.
//
//   node scripts/check-deploy.mjs                 # env + database checks
//   node scripts/check-deploy.mjs https://app.example.com   # also check the live app
//
// Reads the environment (or .env.local). Optional: SUPABASE_ACCESS_TOKEN lets
// it read the project's auth settings (invite hook, redirect URLs) through the
// Supabase Management API. Real model calls are checked by `npm run smoke:ai`.
import { createECDH } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: process.env.NAVI_ENV_FILE ?? ".env.local", quiet: true });
const env = process.env;
const appUrl = process.argv[2]?.replace(/\/$/, "");
const results = [];
const add = (status, name, detail = "") => results.push({ status, name, detail });
const pass = (n, d) => add("PASS", n, d);
const fail = (n, d) => add("FAIL", n, d);
const warn = (n, d) => add("WARN", n, d);

const b64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

function checkEnv() {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SITE_URL",
    "ANTHROPIC_API_KEY",
    "CRON_SECRET",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
    "NAVI_ADMIN_EMAILS",
  ];
  const missing = required.filter((k) => !env[k]);
  missing.length ? fail("required settings", `missing: ${missing.join(", ")}`) : pass("required settings", `${required.length} present`);
  env.GEMINI_API_KEY ? pass("real-time voice key", "GEMINI_API_KEY present") : warn("real-time voice key", "GEMINI_API_KEY missing: voice falls back to basic browser speech");

  env.NAVI_AI_PROVIDER === "anthropic" ? pass("AI provider", "anthropic") : fail("AI provider", `NAVI_AI_PROVIDER is "${env.NAVI_AI_PROVIDER ?? ""}", must be "anthropic" in production`);
  env.NAVI_ALLOW_DEVSIM === "true" ? fail("simulator", "NAVI_ALLOW_DEVSIM=true must not be set in production") : pass("simulator", "not allowed");

  const site = env.NEXT_PUBLIC_SITE_URL ?? "";
  if (site) /^https:\/\//.test(site) ? pass("site URL", "https") : fail("site URL", "NEXT_PUBLIC_SITE_URL must be https (push and iPhone install need it)");
  const supa = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (supa) /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supa) ? pass("Supabase URL", "hosted project") : warn("Supabase URL", "not a hosted *.supabase.co URL (local stack?)");

  if (env.CRON_SECRET) env.CRON_SECRET.length >= 32 ? pass("scheduler secret", `${env.CRON_SECRET.length} characters`) : fail("scheduler secret", "CRON_SECRET should be at least 32 random characters");

  if (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(b64url(env.VAPID_PRIVATE_KEY));
      ecdh.getPublicKey().equals(b64url(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)) ? pass("push keys", "VAPID public and private keys match") : fail("push keys", "VAPID public key doesn't belong to the private key");
    } catch {
      fail("push keys", "VAPID private key isn't a valid P-256 key");
    }
  }
  if (env.VAPID_SUBJECT) /^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT) ? pass("push contact", "VAPID_SUBJECT ok") : fail("push contact", "VAPID_SUBJECT must start with mailto: or https://");

  const cap = Number(env.NAVI_DAILY_BUDGET_USD ?? 2);
  cap > 0 && cap <= 2 ? pass("daily AI budget", `$${cap}`) : warn("daily AI budget", `$${cap} (testing guard is $2/day)`);
}

function migrationTables() {
  const dir = "supabase/migrations";
  const sql = readdirSync(dir).map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
  return [...sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/gi)].map((m) => m[1]);
}

async function checkDatabase() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const missing = [];
  for (const t of migrationTables()) {
    const { error } = await db.from(t).select("*", { head: true, count: "exact" }).limit(1);
    if (error) missing.push(t);
  }
  missing.length ? fail("database schema", `not reachable or missing: ${missing.join(", ")} (run supabase db push)`) : pass("database schema", "all tables from migrations present");

  const { data: invited, error } = await db.from("allowed_emails").select("email");
  if (error) return;
  const list = new Set((invited ?? []).map((r) => r.email.toLowerCase()));
  list.size ? pass("invite list", `${list.size} email(s)`) : fail("invite list", "nobody is invited yet (npm run allow-email add you@example.com)");
  const admins = (env.NAVI_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const notInvited = admins.filter((a) => !list.has(a));
  if (admins.length) notInvited.length ? warn("admin invited", `${notInvited.length} admin email(s) not on the invite list`) : pass("admin invited", "admin email(s) on the invite list");
  const seeded = [...list].filter((e) => e.endsWith("@navi.test"));
  if (seeded.length) fail("test accounts", `${seeded.length} @navi.test email(s) on the invite list; don't seed production`);
}

async function checkAuthConfig() {
  const ref = env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!env.SUPABASE_ACCESS_TOKEN || !ref) {
    warn("invite hook", "not checked (needs SUPABASE_ACCESS_TOKEN and a hosted project); check Auth → Hooks by hand");
    return;
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } });
  if (!res.ok) return fail("auth settings", `Management API answered ${res.status}`);
  const auth = await res.json();
  if (auth.hook_before_user_created_enabled === undefined) warn("invite hook", "this API version doesn't report the hook; check Auth → Hooks by hand");
  else if (auth.hook_before_user_created_enabled && /navi_before_user_created/.test(auth.hook_before_user_created_uri ?? "")) pass("invite hook", "Before User Created → navi_before_user_created");
  else fail("invite hook", "Before User Created hook is off or not pointing at navi_before_user_created: anyone could sign up");
  const site = env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (site) {
    auth.site_url?.replace(/\/$/, "") === site ? pass("auth site URL", "matches NEXT_PUBLIC_SITE_URL") : fail("auth site URL", "Supabase Site URL doesn't match NEXT_PUBLIC_SITE_URL");
    const allow = String(auth.uri_allow_list ?? "");
    allow.includes(`${site}/auth/callback`) ? pass("auth redirects", "callback allowed") : fail("auth redirects", `add ${site}/auth/callback and ${site}/auth/confirm to redirect URLs`);
  }
}

async function checkLiveApp() {
  if (!appUrl) return;
  try {
    const login = await fetch(`${appUrl}/login`, { redirect: "manual" });
    const csp = login.headers.get("content-security-policy") ?? "";
    login.ok ? pass("app reachable", `${login.status}`) : fail("app reachable", `/login answered ${login.status}`);
    /frame-ancestors 'none'/.test(csp) && /script-src[^;]*'nonce-/.test(csp) ? pass("security headers", "nonce CSP + framing blocked") : fail("security headers", "CSP missing or without nonce");
    const manifest = await fetch(`${appUrl}/manifest.webmanifest`);
    manifest.ok ? pass("installable", "manifest served") : fail("installable", `manifest ${manifest.status}`);
    const sw = await fetch(`${appUrl}/sw.js`);
    sw.ok ? pass("service worker", "served") : fail("service worker", `${sw.status}`);
    const tick = await fetch(`${appUrl}/api/cron/tick`, { method: "POST" });
    tick.status === 401 ? pass("scheduler locked", "tick refuses calls without the secret") : fail("scheduler locked", `tick without secret answered ${tick.status}`);
    const exp = await fetch(`${appUrl}/api/export`);
    exp.status === 401 ? pass("private APIs", "export refuses signed-out calls") : fail("private APIs", `export answered ${exp.status} signed out`);
  } catch (e) {
    fail("app reachable", e.message);
  }
}

checkEnv();
await checkDatabase().catch((e) => fail("database", e.message));
await checkAuthConfig().catch((e) => fail("auth settings", e.message));
await checkLiveApp();
for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(failed ? `\n${failed} problem(s) to fix before going live.` : "\nReady to deploy (then run npm run smoke:ai).");
process.exit(failed ? 1 : 0);
