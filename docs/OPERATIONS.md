# Navi operations guide

How to run Navi locally, test it, and stand up a real deployment. Nothing here
has been done against a hosted project yet: hosted Supabase, Vercel,
Trigger.dev, Google OAuth and the AI provider keys still need the owner's
accounts. `BUILD_INTELLIGENCE.md` tracks what is verified.

## Local development

Requirements: Node 22+, Docker, the Supabase CLI (installed as a dev dependency).

```bash
npm install
npm run db:start        # local Supabase in Docker (applies migrations + seed)
npm run env:local       # writes .env.local: local keys, fresh push keys + scheduler secret, simulator
npm run dev
```

`npm run env:local` won't overwrite an existing `.env.local` (pass `-- --force`).
To use real models locally, add `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` and set
`NAVI_AI_PROVIDER=anthropic`.

CI (`.github/workflows/ci.yml`) runs the same steps on every push to `main` or
`claude/**` and on pull requests: typecheck, lint, unit and integration tests
against a throwaway local Supabase, a production build, and the browser tests.

Seeded invite list (local only): `dev@navi.test`, `alice@navi.test`,
`bob@navi.test`. Public sign-up is off locally too (`[auth] enable_signup =
false`, as on hosted), so the sign-in page never creates accounts. Create one
with `node scripts/allow-email.mjs add <email>` (passwordless: sign in with an
email link, then set a password in Settings); the test helpers create theirs
with the admin API and a password. Magic-link emails land in Mailpit at
http://127.0.0.1:54324.

Without an `ANTHROPIC_API_KEY`, set `NAVI_AI_PROVIDER=devsim` to use the
development simulator: a rule-based stand-in whose every reply is labelled
"[Simulated AI — development mode]". Production builds refuse it unless
`NAVI_ALLOW_DEVSIM=true` is set, which is meant only for running the browser
tests against `next start`.

Don't set `[auth.email] enable_signup = false` in `config.toml`: in the CLI it
turns off the whole email provider (password and email-link sign-in too).

If you change `[auth.hook.*]` in `supabase/config.toml`, run
`npx supabase stop --no-backup && npm run db:start`; a plain restart does not
reload hooks.

## Tests

```bash
npm run typecheck && npm run lint
npm test                       # unit: scheduler, DST, parsing
npm run test:integration       # RLS isolation and domain flows against local Supabase
npm run test:e2e               # Playwright, desktop + iPhone 13 profiles
```

`test:e2e` expects a running app at `E2E_BASE_URL` (default
`http://localhost:3000`). For a production build:

```bash
npm run build
NAVI_ALLOW_DEVSIM=true npx next start -p 3000
```

The e2e suite deletes and recreates the seeded `dev@` and `alice@` accounts.
Never point it at a deployment with real data.

**When the environment also holds hosted or provider settings** (for example a
cloud session whose environment has `SUPABASE_*`, `GEMINI_API_KEY`, ...), run
every test and local build through `scripts/local-only.sh`. Existing
environment variables, even empty ones, take precedence over `.env.local`, so
without it the tests either fail or, worse, would point at the hosted project.
The wrapper removes those settings and loads `.env.local`; the test helpers
also refuse to start unless the Supabase URL is local (`tests/local-guard.ts`).

```bash
scripts/local-only.sh npx vitest run
scripts/local-only.sh npx next build
NAVI_ALLOW_DEVSIM=true scripts/local-only.sh npx next start -p 3000 &
E2E_BASE_URL=http://localhost:3000 scripts/local-only.sh npx playwright test
```

The test browser runs in UTC (`playwright.config.ts`) to match the test
accounts, whatever the machine's `TZ`.

## Deploying

### 1. Supabase

#### Moving to hosted Supabase (project `gxfkumxjeemceoygtuod`, "Navi")

Settings come from Supabase → Project Settings → API Keys, and go into the
environment (cloud environment settings, Vercel project settings), never into
the repo:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://gxfkumxjeemceoygtuod.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **publishable** key (`sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | the **secret** key (`sb_secret_…`), server only |
| `SUPABASE_ACCESS_TOKEN` | a **personal access token** (`sbp_…`, Account → Access Tokens), scoped to this project. Used by the Supabase CLI, the Supabase MCP server (`.mcp.json`) and `check:deploy`. Not used by the app. |

A personal access token is not a project key: in the app's
`SUPABASE_SERVICE_ROLE_KEY` it is rejected (401).

Steps (each is a change to the hosted project; do them deliberately, once):

1. Apply the schema. All migrations in `supabase/migrations` are required, in
   order. `20261101000001_api_privileges.sql` matters on hosted: newer
   Supabase projects don't give the API roles access to new tables, so without
   it even the secret key gets "permission denied".
   `20261102000001_security_hardening.sql` (security review, session 3) adds
   the atomic budget reservation functions the app now calls before every AI
   request and voice token (`ai_reserve`, `ai_voice_settle`, `ai_usage.session_id`)
   and limits notification updates to `status`; **the app's AI calls fail
   without it**, so apply it before deploying this code. If you apply them through
   the Management API or MCP, the recorded versions are the apply time; set
   them back to the file versions in `supabase_migrations.schema_migrations`
   so `supabase db push` doesn't re-run them.
   ```bash
   npx supabase link --project-ref gxfkumxjeemceoygtuod   # uses SUPABASE_ACCESS_TOKEN; asks for the DB password
   npx supabase db push                                   # applies supabase/migrations/*
   npx supabase migration list                            # both should show as applied remotely
   ```
   Do **not** run `supabase/seed.sql` against the hosted project (it invites
   test accounts). With the Supabase MCP server loaded, its migration tools
   can do the same; apply the files exactly as they are in the repo.
2. **Auth → Sign In / Providers:** turn **"Allow new users to sign up" OFF**
   and keep **"Confirm email" ON** (email provider stays enabled). Accounts are
   created only server-side by the invite script, so nobody can register an
   invited email with their own password before its owner does. Keep the
   invite check (Auth → Hooks, below) on as a second layer.
3. Set Site URL and redirect URLs once the app's URL is known (below).
4. Invite the owner: `node scripts/allow-email.mjs add <email> "owner"` with the
   hosted URL and secret key in the environment. This adds the email to the
   invite list **and creates a confirmed, passwordless account** (no email is
   sent; `--invite` sends Supabase's invite email instead). The owner signs in
   with "Email me a sign-in link", then can set a password in Settings →
   Password.
5. Verify: `npm run check:deploy` (read-only; checks schema tables, invite
   list, hook, redirects with `SUPABASE_ACCESS_TOKEN`), then try signing up
   with an uninvited email and expect "Signups not allowed".

General steps:

1. Create a project. Link it and push the schema:
   `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   Do not run `supabase/seed.sql` against production.
2. **Auth → Hooks:** enable the *Before User Created* hook pointing at the
   Postgres function `public.navi_before_user_created`. Without it, anyone
   could sign up. Check it by trying to sign up with an email that isn't
   invited: you should get "Navi is invite-only right now".
3. **Auth → URL configuration:** set the Site URL to the app origin and add
   `https://<app>/auth/callback**` and `https://<app>/auth/confirm**` as
   redirect URLs. The trailing `**` matters: the callback carries `?next=…`,
   and an exact entry doesn't match a query string, so Supabase would fall back
   to the Site URL and the email link wouldn't sign anyone in.
   **Auth → Sign In / Providers:** "Allow new users to sign up" **off**,
   "Confirm email" **on**.
4. Invite people (adds them to the invite list and creates their account
   server-side; idempotent, and never sets a password):
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<secret> \
     node scripts/allow-email.mjs add person@example.com "note"            # no email sent
   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
     node scripts/allow-email.mjs add person@example.com "note" --invite   # Supabase emails an invite link
   ```
   They sign in with an email link and can add a password in Settings.
   `list` and `remove` work the same way. Removing someone blocks new sign-ups
   only; it doesn't delete their account.

### 2. Google sign-in (optional)

1. In Google Cloud, create an OAuth client (Web application). Authorized
   redirect URI: `https://<ref>.supabase.co/auth/v1/callback`.
2. In Supabase **Auth → Providers → Google**, paste the client ID and secret.
   From a Claude Code session: put them in the environment as
   `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`. The session sets
   them with the Management API (`PATCH /v1/projects/<ref>/config/auth`,
   `external_google_enabled`, `external_google_client_id`, `external_google_secret`).
3. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in the app environment and
   redeploy (it is read at build time).

With sign-up off, Google sign-in works only for accounts the invite script
already created (Supabase links the Google identity to the existing
confirmed email); it can't create new ones. It still goes through the invite hook. Signing in with Google does
not give Navi access to Calendar, Gmail or Drive; those integrations are not
built yet and show as "not connected".

### 3. App on Vercel

Import the repo and set the environment variables from `.env.example`:

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project URL and publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key. Server only, used by jobs and the account-deletion route |
| `NEXT_PUBLIC_SITE_URL` | Public origin, used for auth redirects and push links |
| `ANTHROPIC_API_KEY` | Text chat, onboarding, capture parsing, planning. In a Claude Code cloud environment use `NAVI_ANTHROPIC_API_KEY` instead: the environment reserves `ANTHROPIC_API_KEY` and does not pass it to sessions |
| `GEMINI_API_KEY` | Real-time voice. Without it, voice falls back to the browser's speech recognition and the same text pipeline |
| `NAVI_AI_PROVIDER` | `anthropic` in production |
| `NAVI_MODEL_*` | Model roles; defaults are in `.env.example` |
| `NAVI_DAILY_BUDGET_USD` | Aggregate daily AI cap (default 2) |
| `NAVI_ADMIN_EMAILS` | Your sign-in email(s). Only these accounts can approve a one-day budget override; if empty, nobody can in production |
| `CRON_SECRET` | Long random string shared with the scheduler |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push. Generate with `npx web-push generate-vapid-keys` |

Leave `NAVI_ALLOW_DEVSIM` and `NAVI_ALLOW_LOCAL_PUSH` unset in production.
(`NAVI_ALLOW_LOCAL_PUSH=true` lets a production build accept push
subscriptions on localhost, for tests only; otherwise only the browsers' push
services are accepted: `fcm.googleapis.com`, `*.push.apple.com`,
`updates.push.services.mozilla.com`, `*.notify.windows.com`.)

### Pre-deploy check

With the production values in the environment (or `.env.local`), run:

```bash
npm run check:deploy -- https://<app>
```

It is read-only and never prints secret values. It checks that required
settings are present, the AI provider is real and the simulator is off, the
site is https, the scheduler secret is long enough, the VAPID keys belong
together, every table from the migrations exists, the invite list is non-empty
and free of `@navi.test` accounts, and that the admin email is invited. With
`SUPABASE_ACCESS_TOKEN` set, it also reads the project's auth settings: the
invite hook, Site URL and redirect URLs. Given the app URL, it checks the live
app: security headers, manifest, service worker, and that the scheduler and
private APIs refuse unauthenticated calls. Then run `npm run smoke:ai` for the
real model calls.

### 4. Scheduler (Trigger.dev)

Briefings (06:00 and 21:00 local), the weekly review, deadline reminders and
push delivery run from one idempotent endpoint, `POST /api/cron/tick`, which
requires `Authorization: Bearer $CRON_SECRET`. It runs safely as often as every
few minutes: each briefing is stored once per local day, and a missed run is
caught up within 3 hours.

```bash
npx trigger.dev@latest login          # or set TRIGGER_ACCESS_TOKEN (tr_pat_…) instead, e.g. in a cloud session
export TRIGGER_PROJECT_REF=proj_...
npx trigger.dev@latest deploy
```

In the Trigger.dev project's production environment, set `NAVI_APP_URL` (the
app origin) and `CRON_SECRET` (the same value as in Vercel). The `navi-tick`
task runs every 10 minutes. Vercel stores `CRON_SECRET` as a sensitive value
that can't be read back, so to share it, generate a new one, set it in both
places, and redeploy the Vercel app.

Any other scheduler that can send an authenticated POST every 5 to 15 minutes
works too.

**Current fallback: Vercel Cron.** `vercel.json` defines 24 daily cron jobs
on `/api/cron/tick`, one per UTC hour. Hobby allows 100 jobs per project, each
at most once a day and fired anywhere within its hour, so this gives roughly
hourly ticks: briefings arrive within about two hours of 06:00/21:00, but
"due in 2 hours" reminders can be up to an hour late. Vercel sends
`Authorization: Bearer $CRON_SECRET` automatically. Once Trigger.dev is
deployed (needs a personal access token `tr_pat_…` for `deploy`, a project ref,
and a production secret key), remove the `crons` from `vercel.json`.

Manual check:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/tick
```

## Checking the AI providers

Once `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY` are set (in `.env.local`, or
exported), run:

```bash
npm run smoke:ai
```

It confirms each configured Claude model role is accessible and answers, mints
a Gemini Live ephemeral token, and has a short live voice exchange using that
token, the way the browser does. Total cost is well under one cent, it's
recorded against the daily budget, and it refuses to run if the budget is used
up. Use `npm run smoke:ai -- anthropic` or `-- gemini` to check one provider.

## Spend controls

The app enforces `NAVI_DAILY_BUDGET_USD` across all users (default $2 per day,
resetting at midnight in `NAVI_BUDGET_TIMEZONE`). It warns at 75%, then stops
new AI calls, both text and voice, until the budget owner (`NAVI_ADMIN_EMAILS`) approves a
one-day override in Settings. Cost is estimated from token and audio-minute prices in
`src/server/ai/config.ts`. Treat it as a guard, not billing.

How it holds: every Claude call first reserves its worst case (full output
budget) in one locked database step (`ai_reserve`), so simultaneous calls
can't all slip under the cap, then the row is settled to the real usage.
Every Gemini Live token reserves $0.25 (its 10-minute lifetime of two-way
audio) before it is minted, and each person can mint at most 6 per 10
minutes. Voice turns the browser reports are clamped to what the session
could have used and reconciled with the reservation, so a session costs
max(reserved, reported): a client that never reports is still charged. Also set hard
spend limits in the Anthropic Console and Google AI Studio so a bug can't
exceed them.

Gemini's free tier may use prompts to improve Google's products. Use a paid
key for real personal data. The Settings page tells users this.

## iPhone

Open the app in Safari, then Share → Add to Home Screen. Web push works only
from the installed app on iOS 16.4+, after the user taps "Enable notifications" in
Settings. Microphone access for voice is requested the first
time voice starts.

## Data

- Export: Settings → "Export all my data (JSON)" downloads every row the user owns as JSON.
- Delete: Settings → Delete account (type DELETE). Rows cascade from `auth.users`.
- Raw audio is never stored. Voice transcripts are saved as messages.
