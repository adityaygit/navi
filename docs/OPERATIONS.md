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
`bob@navi.test`. Sign in with "Use a password instead"; the first sign-in
creates the account. Magic-link emails land in Mailpit at http://127.0.0.1:54324.

Without an `ANTHROPIC_API_KEY`, set `NAVI_AI_PROVIDER=devsim` to use the
development simulator: a rule-based stand-in whose every reply is labelled
"[Simulated AI — development mode]". Production builds refuse it unless
`NAVI_ALLOW_DEVSIM=true` is set, which is meant only for running the browser
tests against `next start`.

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

1. Apply the schema. Both migrations are required:
   `20261030000001_core_schema.sql` and `20261031000001_replace_day_plan.sql`.
   ```bash
   npx supabase link --project-ref gxfkumxjeemceoygtuod   # uses SUPABASE_ACCESS_TOKEN; asks for the DB password
   npx supabase db push                                   # applies supabase/migrations/*
   npx supabase migration list                            # both should show as applied remotely
   ```
   Do **not** run `supabase/seed.sql` against the hosted project (it invites
   test accounts). With the Supabase MCP server loaded, its migration tools
   can do the same; apply the files exactly as they are in the repo.
2. Enable the invite check (Auth → Hooks, below). Until then anyone could sign up.
3. Set Site URL and redirect URLs once the app's URL is known (below).
4. Invite the owner: `node scripts/allow-email.mjs add <email> "owner"` with the
   hosted URL and secret key in the environment.
5. Verify: `npm run check:deploy` (read-only; checks schema tables, invite
   list, hook, redirects with `SUPABASE_ACCESS_TOKEN`), then try signing up
   with an uninvited email and expect "Navi is invite-only right now".

General steps:

1. Create a project. Link it and push the schema:
   `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   Do not run `supabase/seed.sql` against production.
2. **Auth → Hooks:** enable the *Before User Created* hook pointing at the
   Postgres function `public.navi_before_user_created`. Without it, anyone
   could sign up. Check it by trying to sign up with an email that isn't
   invited: you should get "Navi is invite-only right now".
3. **Auth → URL configuration:** set the Site URL to the app origin and add
   `https://<app>/auth/callback` and `https://<app>/auth/confirm` as redirect URLs.
4. Invite people:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<secret> \
     node scripts/allow-email.mjs add person@example.com "note"
   ```
   `list` and `remove` work the same way. Removing someone blocks new sign-ups
   only; it doesn't delete their account.

### 2. Google sign-in (optional)

1. In Google Cloud, create an OAuth client (Web application). Authorized
   redirect URI: `https://<ref>.supabase.co/auth/v1/callback`.
2. In Supabase **Auth → Providers → Google**, paste the client ID and secret.
3. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in the app environment.

Google sign-in still goes through the invite hook. Signing in with Google does
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

Leave `NAVI_ALLOW_DEVSIM` unset in production.

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
npx trigger.dev@latest login
export TRIGGER_PROJECT_REF=proj_...
npx trigger.dev@latest deploy
```

In the Trigger.dev project, set `NAVI_APP_URL` (the app origin) and
`CRON_SECRET`. The `navi-tick` task runs every 10 minutes.

Any other scheduler that can send an authenticated POST every 5 to 15 minutes
works too. Vercel Cron on the Hobby plan runs at most daily, so it can't
deliver local-time briefings on its own.

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
`src/server/ai/config.ts`. Treat it as a guard, not billing. Also set hard
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
