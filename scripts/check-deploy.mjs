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
/** PASS with `good` when ok, else report `bad` as a failure (or warning). */
const check = (ok, name, good, bad, onBad = fail) => (ok ? pass(name, good) : onBad(name, bad));

const b64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

function checkEnv() {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SITE_URL",
    "CRON_SECRET",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
    "NAVI_ADMIN_EMAILS",
  ];
  const missing = required.filter((k) => !env[k]);
  if (!env.ANTHROPIC_API_KEY && !env.NAVI_ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  check(!missing.length, "required settings", `${required.length + 1} present`, `missing: ${missing.join(", ")}`);
  check(env.GEMINI_API_KEY, "real-time voice key", "GEMINI_API_KEY present", "GEMINI_API_KEY missing: voice falls back to basic browser speech", warn);

  check(env.NAVI_AI_PROVIDER === "anthropic", "AI provider", "anthropic", `NAVI_AI_PROVIDER is "${env.NAVI_AI_PROVIDER ?? ""}", must be "anthropic" in production`);
  check(env.NAVI_ALLOW_DEVSIM !== "true", "simulator", "not allowed", "NAVI_ALLOW_DEVSIM=true must not be set in production");

  const site = env.NEXT_PUBLIC_SITE_URL ?? "";
  if (site) check(/^https:\/\//.test(site), "site URL", "https", "NEXT_PUBLIC_SITE_URL must be https (push and iPhone install need it)");
  const supa = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (supa) check(/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supa), "Supabase URL", "hosted project", "not a hosted *.supabase.co URL (local stack?)", warn);

  if (env.CRON_SECRET) check(env.CRON_SECRET.length >= 32, "scheduler secret", `${env.CRON_SECRET.length} characters`, "CRON_SECRET should be at least 32 random characters");

  if (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(b64url(env.VAPID_PRIVATE_KEY));
      check(ecdh.getPublicKey().equals(b64url(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)), "push keys", "VAPID public and private keys match", "VAPID public key doesn't belong to the private key");
    } catch {
      fail("push keys", "VAPID private key isn't a valid P-256 key");
    }
  }
  if (env.VAPID_SUBJECT) check(/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT), "push contact", "VAPID_SUBJECT ok", "VAPID_SUBJECT must start with mailto: or https://");

  const cap = Number(env.NAVI_DAILY_BUDGET_USD ?? 2);
  check(cap > 0 && cap <= 2, "daily AI budget", `$${cap}`, `$${cap} (testing guard is $2/day)`, warn);
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
    // Not a HEAD request: hosted PostgREST answers HEAD for a missing table with 204 and no error.
    const { error } = await db.from(t).select("*").limit(0);
    if (error) missing.push(t);
  }
  check(!missing.length, "database schema", "all tables from migrations present", `not reachable or missing: ${missing.join(", ")} (run supabase db push)`);

  const { data: invited, error } = await db.from("allowed_emails").select("email");
  if (error) return;
  const list = new Set((invited ?? []).map((r) => r.email.toLowerCase()));
  check(list.size, "invite list", `${list.size} email(s)`, "nobody is invited yet (npm run allow-email add you@example.com)");
  const admins = (env.NAVI_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const notInvited = admins.filter((a) => !list.has(a));
  if (admins.length) check(!notInvited.length, "admin invited", "admin email(s) on the invite list", `${notInvited.length} admin email(s) not on the invite list`, warn);
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
    check(auth.site_url?.replace(/\/$/, "") === site, "auth site URL", "matches NEXT_PUBLIC_SITE_URL", "Supabase Site URL doesn't match NEXT_PUBLIC_SITE_URL");
    const allow = String(auth.uri_allow_list ?? "");
    check(allow.includes(`${site}/auth/callback`), "auth redirects", "callback allowed", `add ${site}/auth/callback and ${site}/auth/confirm to redirect URLs`);
  }
}

async function checkLiveApp() {
  if (!appUrl) return;
  try {
    const login = await fetch(`${appUrl}/login`, { redirect: "manual" });
    const csp = login.headers.get("content-security-policy") ?? "";
    check(login.ok, "app reachable", `${login.status}`, `/login answered ${login.status}`);
    check(/frame-ancestors 'none'/.test(csp) && /script-src[^;]*'nonce-/.test(csp), "security headers", "nonce CSP + framing blocked", "CSP missing or without nonce");
    const manifest = await fetch(`${appUrl}/manifest.webmanifest`);
    check(manifest.ok, "installable", "manifest served", `manifest ${manifest.status}`);
    const sw = await fetch(`${appUrl}/sw.js`);
    check(sw.ok, "service worker", "served", `${sw.status}`);
    const tick = await fetch(`${appUrl}/api/cron/tick`, { method: "POST" });
    check(tick.status === 401, "scheduler locked", "tick refuses calls without the secret", `tick without secret answered ${tick.status}`);
    const exp = await fetch(`${appUrl}/api/export`);
    check(exp.status === 401, "private APIs", "export refuses signed-out calls", `export answered ${exp.status} signed out`);
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
