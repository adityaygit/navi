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
cp .env.example .env.local
npx supabase status     # copy the API URL, publishable key and secret key into .env.local
npm run dev
```

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

## Deploying

### 1. Supabase

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
| `ANTHROPIC_API_KEY` | Text chat, onboarding, capture parsing, planning |
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
