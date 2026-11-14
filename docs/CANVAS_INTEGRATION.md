# Canvas LMS integration (private calendar feed)

Status: **implemented and verified locally** (fixtures + local Supabase + real browser on a dev server). **Not yet verified against a real Canvas account or on the hosted deployment**: that needs the steps below.

No Canvas OAuth, developer keys or API tokens. The person pastes their personal Calendar Feed link; Navi reads it on a schedule. Read-only: Navi never writes to Canvas.

## How it works

```
Settings → Connect Canvas → paste link
  → normalize (webcal→https) + allowlist (*.instructure.com, NAVI_CANVAS_ALLOWED_HOSTS)
  → SSRF-safe fetch (DNS checked + pinned, redirects re-checked, 20 s, 5 MB)
  → ical.js parse (TZID/VTIMEZONE/floating/all-day, RRULE + EXDATE + RECURRENCE-ID, cancellations)
  → Canvas adapter (assignment vs event, course from link / "[Course]" suffix, only Canvas links kept)
  → reconcile external_items (idempotent upserts keyed by connection + UID + occurrence)
  → settle into ordinary Navi tasks (assignments) and events (timed calendar events)
```

| Layer | File | Reusable for |
|---|---|---|
| Credential encryption (AES-256-GCM, bound to user + connection) | `src/server/integrations/crypto.ts` | any integration secret |
| SSRF-safe fetcher | `src/server/integrations/safe-fetch.ts` | any user-supplied URL |
| iCalendar reader | `src/server/integrations/ics/parse.ts`, `ics/text.ts` | any ICS feed |
| Provider contract | `src/server/integrations/providers/types.ts` | new calendar/school providers |
| Canvas adapter | `src/server/integrations/providers/canvas.ts` | — |
| Sync engine (lock, reconcile, settle, status) | `src/server/integrations/feed-sync.ts` | any feed provider |
| User operations (connect, refresh, disconnect, hide, courses) | `src/server/integrations/connections.ts` | any feed provider |

To add another feed provider: implement `FeedProvider` (URL rules, fetch policy, confirmed window, `toItems`), add it to `providers` and to the `provider` check constraint, and reuse the rest.

### Ownership

- **Canvas owns** title and due date (assignment) / time and place (event). Copied on every sync. Navi refuses edits to a Canvas task's title or due date (`updateEntity` guard), and the task card shows them read-only with a "From Canvas" label.
- **Navi owns** status/completion, priority, estimate, notes, space/project, plan blocks, and the person's choices: hidden items, excluded courses, course → space/project links, duplicate decisions.
- Assignments → `tasks` (`source='external'`, `external_ref='ext:<item id>'`, `due_is_hard=true`; all-day → 11:59 PM local). Timed events → `events` (planner already never moves external events). All-day events (holidays) don't block planning time: they show in the calendar's all-day strip from `external_items`.
- Event descriptions are untrusted: HTML, invisible and bidi-override characters are stripped. They're stored only on `external_items` (not in task notes) and never sent to the AI.

### Removal safety (Canvas's rolling window and partial feeds)

Canvas exports 30 days back and 366 days ahead, at most 1,000 items, and no To Do items. So:
- Missing items are only considered inside the **confirmed window** (30−2 days back, 366−2 days ahead of the sync).
- Removal needs **two successful syncs at least 30 minutes apart** where the item is missing.
- No removals at all when the feed hits the **1,000-item cap**, a recurring series hits the expansion cap, or the feed comes back **empty** while items exist. The run is marked "partial" with a warning.
- Removal **parks** the task (`cancelled`, prior status remembered). It's never deleted, and it's restored if the item reappears. Items that **age out** of the window are never touched, so planning history stays.
- A failed sync changes nothing that was imported, records a plain error, and retries with backoff (15 min → 6 h; a refused/reset link waits 24 h and shows "link needs updating").

### Duplicates

A new assignment whose title (minus the `[Course]` suffix) matches one of the person's own open tasks due within ±36 h is **held**, not imported or merged. The person picks "Import it too" or "Keep mine only" on the Courses & items page.

### Security

- Feed URLs: encrypted (`integration_secrets`, no API-role access at all), fingerprinted with a keyed HMAC for duplicate detection, never returned to the browser, never logged. Next's development server-function argument logging is turned off (`next.config.ts`) because it printed the link.
- Strict URL rules: https on port 443 only (webcal → https), no userinfo, no query string, path `/feeds/calendars/(user|course|group)_<token>.ics`, host on the allowlist.
- SSRF: every hop's host checked; DNS resolved once, all answers must be public (private, loopback, link-local, metadata, CGNAT, multicast, reserved, IPv4-mapped/NAT64/6to4 embedded) and the socket is pinned to the checked address (no DNS rebinding). Redirects are followed by hand (≤3), each re-checked. 20 s deadline, 5 MB cap.
- Access: people can **read** their own connection status, courses, items and runs (RLS). Every write goes through server code that checks ownership and uses the service role.
- Rate limits: connect/relink 8 per 15 min per person; refresh once a minute per connection and 20 per hour per person.

## Migration

`supabase/migrations/20261111000001_external_calendar_feeds.sql` is additive. It:
- adds `tasks.external_ref` and `'external'` to the `tasks.source` check;
- adds `unique (user_id, external_ref)` on `tasks` and `events`;
- creates `integration_connections`, `integration_secrets`, `external_courses`, `external_items`, `integration_sync_runs`, `integration_rate_events`, plus the `integration_rate_hit()` function.

It's **applied locally only**. Apply it to the hosted project with the owner's OK:

```bash
npx supabase db push
```

## Deploy

1. **Encryption key** (Vercel → Project → Settings → Environment Variables, Production + Preview): `NAVI_INTEGRATION_ENCRYPTION_KEY` = 32 random bytes, base64:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Keep it stable: changing it makes saved links unreadable (people would re-paste them).
2. Optional `NAVI_CANVAS_ALLOWED_HOSTS` for schools on their own Canvas domain (e.g. `canvas.myschool.edu` or `*.myschool.edu`). `*.instructure.com` is always allowed.
3. Apply the migration (above), then deploy the app (merge to the deployed branch).
4. **Trigger.dev:** deploy `trigger/integrations-sync.ts` (runs every 30 min; each feed syncs every 6 h). It needs `NAVI_APP_URL` and `CRON_SECRET` in Trigger.dev, the same as the existing tick:
   ```bash
   npx trigger.dev@latest deploy
   ```
   `vercel.json` also calls `/api/cron/integrations` 4× a day as a fallback.
5. `npm run check:deploy` now warns if the key is missing or `NAVI_ALLOW_LOCAL_FEEDS` is set.

## Test with your own Canvas account

1. On the deployed app: **Settings → Connected services → Connect Canvas**.
2. In Canvas, **in a web browser** (not the mobile app): **Calendar → Calendar Feed** (bottom of the right-hand column) → copy the link.
3. Paste it and press **Connect**. Expect a one-line summary, e.g. "Imported 18 assignments and 6 events from 4 courses."
4. Check:
   - **Tasks → Upcoming** shows assignments with Canvas due dates; opening one shows "From Canvas" and a read-only due date.
   - **My day → Calendar** shows class events; all-day Canvas events sit in the all-day strip.
   - **Settings → Canvas → Courses & items**: exclude a course, link a course to a space or project, hide an item, and confirm the tasks follow.
5. In Canvas, change a due date on something (or wait for a teacher to), then press **Refresh now** (at most once a minute). The task's due date should update; your priority, estimate and done state stay as they were.
6. Disconnect (with or without removing imported items) and check your own tasks are untouched.

If something fails, the Settings card shows the reason, and the **Sync history** on the Courses & items page lists every run.

## Local development

```bash
NAVI_ALLOW_LOCAL_FEEDS=true scripts/local-only.sh npx next dev
```

This is development only and ignored in production builds. It allows `http://localhost:<port>/feeds/calendars/user_<token>.ics`, so a fixture from `tests/fixtures/canvas/` can be served locally.

Tests:
- `tests/unit/canvas-feed.test.ts`: URL rules, SSRF guard, parser, Canvas mapping, crypto.
- `tests/integration/canvas-sync.test.ts`: the sync engine against local Supabase.
