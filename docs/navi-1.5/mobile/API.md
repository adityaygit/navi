# Navi phone app: server API

The Navi app for iPhone and Android (`mobile/`, Capacitor) is a bundled React
app. It signs in with Supabase directly and calls this Next.js backend
(production: `https://www.meetnavi.app`) with the person's Supabase access
token. This page is the contract. The request and response types are in
[`src/lib/mobile-api-types.ts`](../../../src/lib/mobile-api-types.ts) (plain
TypeScript, no imports, so the app imports that file directly). Type names
below (`MDay`, `MTaskGroups`, ...) refer to it.

Server code: `src/server/cors.ts` (CORS + bearer parsing), `src/server/context.ts`
(`getCtx`), `src/proxy.ts` (preflights), `src/server/mobile/router.ts` (all
`/api/m` routes), `src/server/mobile/views.ts` (read models). Every route wraps
the same domain function the web's server action calls; nothing is
reimplemented for the app.

## Sign-in (emailed code)

The app talks to Supabase Auth directly with the public URL and publishable key
(the same values as the web's `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`):

```ts
await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
// the person types the 6-digit code from the email
const { data } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
// data.session.access_token → Authorization: Bearer …; refresh with the SDK as usual
```

- Always pass `shouldCreateUser: false`. Navi is invite-only: public sign-up is
  off and the `before_user_created` hook refuses uninvited emails, so a new
  address gets an error, never an account. (The web login does the same.)
- The code is the `{{ .Token }}` in the "Magic Link" email template. The repo's
  local template (`supabase/templates/magic-link.html`, wired in
  `supabase/config.toml` under `[auth.email.template.magic_link]`, `otp_length = 6`,
  `otp_expiry = 600`) already shows it; nothing in the repo had to change.
- Password sign-in (`signInWithPassword`) works too for people who set one in
  Settings on the web.
- The app keeps and refreshes its own session (supabase-js with Capacitor
  Preferences as storage). The server never stores or refreshes it.

## Auth on every request

```
Authorization: Bearer <Supabase access token>
```

- `getCtx` (`src/server/context.ts`) checks the token with Supabase
  (`auth.getClaims(token)`: the signature against the project's signing keys,
  or the Auth server for older keys) and requires `role = authenticated` and a
  user id. The database client then sends that token, so **row-level security
  applies exactly as for the web**: the app can only ever see and change the
  signed-in person's rows.
- A request with a `Bearer` header is judged on the token only; it never falls
  back to a cookie. A missing, malformed, forged, expired or anon token is
  `401 { "error": "Not signed in" }`. On 401 the app refreshes its session once
  and retries, then shows sign-in.
- The web is unchanged: no bearer header → the cookie session, as before.
- The same works on the existing routes the app uses: `POST /api/chat`
  (streaming), `POST /api/capture`, `POST /api/voice/session|turn|tool|end`.

## CORS

Allowed origins (exact match, no wildcard, no credentials/cookies):

| Origin | What |
| --- | --- |
| `capacitor://localhost` | iPhone app |
| `https://localhost` | Android app (`androidScheme: "https"`, Capacitor's default) |
| `http://localhost` | Android with the http scheme |
| `http://localhost:5173` | the app's dev server (Vite) |

Paths: `/api/m/*`, `/api/chat`, `/api/capture`, `/api/voice/*`. Other API
routes (account deletion, export, push, cron) stay same-origin only.

- `OPTIONS` preflights are answered by `src/proxy.ts` with `204`,
  `Access-Control-Allow-Origin: <origin>`, `Allow-Methods: GET, POST, PATCH,
  DELETE, OPTIONS`, `Allow-Headers: Authorization, Content-Type, Accept`,
  `Max-Age: 600`. A preflight from any other origin gets no allow headers, so
  the browser blocks the call.
- Responses (including the proxy's own 401) carry `Access-Control-Allow-Origin`
  for an allowed origin and `Vary: Origin`.
- The list lives in `MOBILE_ORIGINS` in `src/server/cors.ts`. If the app's
  scheme or dev port changes, change it there (and the unit test).

## Errors

Every failure is a JSON body `MApiError`: `{ "error": "<message>", "code"?: "…" }`.

| Status | When |
| --- | --- |
| 400 | Invalid input (zod message, e.g. `title: Too small…`), body isn't JSON, or Navi's rules refused the change. The message is written for the person and is the same text the web shows for that button (e.g. `That time overlaps “Shift”.`). |
| 401 | Not signed in (see above). |
| 404 | No such route, an id that isn't a uuid, or the thing doesn't exist / isn't the person's (RLS makes "someone else's" look like "doesn't exist"). |
| 405 | Wrong method for the path (`Allow` header lists the right ones). |
| 409 | Conflict, e.g. a focus session is already running on something else; `/api/chat` uses 409 with `code` `turn_in_progress` / `turn_incomplete` for a retried message. |
| 402 / 429 / 503 | Only on `/api/voice/session` and `/api/chat`: AI budget reached, rate limited, voice not configured. |
| 500 | Server fault. In production the body is generic plus `code` (a reference to the server log). |

## Conventions

- JSON in and out; send `Content-Type: application/json` with a body.
- Database rows (tasks, proposals, messages, focus sessions, briefings) keep
  their column names in snake_case, exactly as the web and `/api/chat` use them;
  shapes built for a screen are camelCase.
- Times are ISO 8601 (UTC). `date` is `YYYY-MM-DD` in the person's time zone
  (`MMe.timezone`); `HH:MM` is a local clock time.
- Ids in paths are uuids.
- Writes are safe to retry where noted (task create with `id`, approvals,
  focus start/end, undo); the server makes them happen once.

## Endpoints

### Me

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/m/me` | – | `MMe`: id, email, displayName, timezone, naviColor (key, name and its colours), autonomy (`auto`/`ask`), onboarding `{ status, done }`, plannerV2, briefing times, quiet hours, wake/bed, `waiting { proposals, approvals }` for badges. |

| PATCH | `/api/m/settings` | `MSettingsPatch`: any of displayName, timezone, briefingsEnabled, morning, evening, quietHours (`{start,end}` or null), wakeBed (`{wake,bed}` or null), autonomy, naviColor, colourFollowsDay. Unknown keys → 400. | The updated `MMe`. Logged as `settings_updated`. Other preference keys are kept. |

`MMe.colourFollowsDay` (default true) is app-only: the app's colour follows the time of day unless the person fixes one of the eight Navi colours.

### Chats

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/m/chats` | – | `MChatList` `{ chats: [{ id, title, created_at, updated_at }] }`, most recent first (onboarding chat not listed). |
| POST | `/api/m/chats` | – | `MChatCreated` `{ id }` (an empty chat; or just send the first message to `/api/chat` without a `conversationId`). |
| PATCH | `/api/m/chats/:id` | `MChatRename` `{ title }` (1–200 chars) | `MOk` |
| DELETE | `/api/m/chats/:id` | – | `MOk` |
| GET | `/api/m/chats/:id/messages?limit=` | `limit` 1–200, default 60 (newest kept) | `MChatHistory`: `{ id, title, messages, actions, undone }`. Each `MMessage` is the saved row plus, for Navi's replies, `receipts` (the steps as rows, every plan change merged into one "Updated your plan" row with one Undo, exactly as the web draws them; see `src/lib/reply-view.ts`) and `cardIds` (action cards to draw after the text; look them up in `actions`). `undone`: activity ids already undone (show that Undo as done). 404 for a chat that doesn't exist or isn't theirs. |

Sending a message: `POST /api/chat` (existing route) with
`{ text, conversationId?, clientMessageId, stream: true, modality?: "voice" }`
and the bearer header. It streams newline-delimited `ChatStreamEvent`s
(`src/lib/chat-stream.ts`) and ends with `done` (the saved messages). After
`done`, refetch `GET /api/m/chats/:id/messages?limit=2` to get the reply's
`receipts` and card states. Undo on a receipt row: `POST /api/m/undo` with the
row's `undo` ids. Approve/decline a card: `POST /api/m/approvals/:id/decide`.

### Day and week (Plan)

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/m/day?date=YYYY-MM-DD` | `date` optional (default today) | `MDay` |
| GET | `/api/m/week?start=YYYY-MM-DD` | any date in the week (default this week) | `MWeek` |

`MDay`:
- `items: MDayItem[]` in time order: events, timed routines and plan blocks,
  each with `kind`, `look` (`fixed` filled / `flex` time set aside / `routine`
  dashed, as on the web timeline), start/end/minutes, block `status`,
  `open`/`done`/`now`, `space { id, name, color }`, `color`, `taskId`,
  `assumed` (planner v2: in time Navi assumed is free), `pinned`, `recurring`,
  `reason`, and `overlaps` (keys of items it overlaps). `key` is unique per row
  (a weekly event repeats its `id`).
- `earlier` (today only): keys of items that already ended and how many of them
  were marked done ("This morning · 2 done").
- `overlaps: MOverlap[]`: each pair at the same time, with the shared span
  (all-day events excluded) — the amber "overlaps" note.
- `free: MFreeStretch[]`: free stretches of 30+ minutes still ahead and the one
  task that fits each ("“Return library books” fits here").
- `needsTime` (≤ 5, soonest due first) and `needsTimeTotal`: open tasks with
  nothing planned from today on.
- `headline: MLine`: the one-sentence summary in parts (strong parts brighter).
- `untimed`: routines with no set time that day. `plan` (planner v2 only):
  assumptions, unknown time, plans waiting for an OK. `briefing`: today's
  newest unread briefing. `focusSessionId`: the running session, if any.

`MWeek`: `start`, `end`, `headline`, and per day `items`, `plannedMinutes`
(events + blocks, overlaps counted once), `overlaps` (count), `due` (open
tasks due that day).

### Tasks and planning

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/m/tasks` | – | `MTaskGroups` `{ today, needsTime, later, doneToday }` of `MTaskItem` (task row + `space`, `steps { total, done }`, `next` planned time). **today**: open, with a time today or due by the end of today (overdue first, then by time). **needsTime**: open, not today, nothing planned, not parked. **later**: open, not today, planned for a later day or parked for someday (priority 4). **doneToday**: finished today. Top-level tasks only (steps are counted). |
| POST | `/api/m/tasks` | `MTaskCreate` (`title` required; `id` = a uuid made once per submit, so a retry returns the same task) | `MTaskResult` `{ task }` |
| PATCH | `/api/m/tasks/:id` | `MTaskUpdate` (any field, plus `status`) | `MTaskChange` `{ result }`: `{ kind: "updated", row }` or `{ kind: "approval_requested", approvalId, reason }`. `status: "done"` completes it (a recurring task gets its next one). |
| POST | `/api/m/tasks/:id/complete` | `{ actualMinutes? }` | `MTaskChange` (completing twice changes nothing) |
| POST | `/api/m/tasks/:id/uncomplete` | – | `MTaskChange` (back to `todo`) |
| POST | `/api/m/tasks/:id/place` | `MPlaceTask` `{ startsAt (ISO), minutes 5–480 }` | `MOk`. "Put it there": a flexible block the person placed. 400 `That time overlaps “…”.` if it would overlap anything on that day (planner v2: or anything fixed). |
| POST | `/api/m/plan/day` | `{ date? }` | `MPlanResult` `{ message }` — one plain sentence ("Planned 3 things for today. …") |
| POST | `/api/m/plan/week` | `{ start? }` | `MPlanResult` |
| POST | `/api/m/blocks/:id/outcome` | `MBlockOutcome` `{ status: done\|partial\|skipped\|missed\|rest\|interrupted\|planned, reason? }` | `MOk` (undoable from Activity) |

### Inbox, approvals and undo

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/m/inbox` | – | `MInbox`: `groups` (pending suggestions grouped by source: one capture with its raw words, "From your chats with Navi", "Other suggestions"), `deferred` ("Later"), `approvals` (action cards waiting for an OK, newest first), `openTasks` (for "Merge into…"), `counts { proposals, approvals, stated }`. Each `MProposal` has `title`, `origin` (`stated` solid / `inferred` dashed), `confidence`, `source_excerpt`, `payload`, and `area`. |
| POST | `/api/m/proposals/:id/accept` | `MAcceptProposal` `{ edits? }` | `MProposalResult` `{ proposal }` (accepting twice is safe) |
| POST | `/api/m/proposals/accept` | `MAcceptMany` `{ ids }` (≤ 500) | `MAcceptManyResult` `{ results, message }`. If some failed, `message` names them and the rest stay accepted; if all failed, 400 with `results`. ("Accept the 2 you said" = the `stated` ids.) |
| POST | `/api/m/proposals/:id/status` | `MProposalStatus` `{ status: "rejected" \| "deferred" \| "pending" }` | `MOk` (decline / later / back to the inbox) |
| PATCH | `/api/m/proposals/:id` | `MEditProposal` `{ payload }` | `MOk` |
| POST | `/api/m/proposals/:id/merge` | `MMergeProposal` `{ taskId }` | `MOk` |
| POST | `/api/m/approvals/:id/decide` | `MDecide` `{ decision: "approve" \| "decline", revision? }` | `MDecideResult` `{ action, message }`: the card as it really is afterwards (`completed` with `result` and `undo`, `failed`, `declined`, `expired`, or still `proposed` when `revision` is stale because Navi changed it — show the new version). Runs at most once however often it's tapped. Outward actions (email, messages) always need this. |
| POST | `/api/m/undo` | `MUndo` `{ activityIds }` (≤ 100) | `MUndoResult` `{ undone, message }` (receipts' and completed cards' Undo) |
| POST | `/api/m/activity/:id/revert` | – | `MOk` `{ message }` (undo one Activity entry) |

### Focus

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/m/focus` | – | `MFocusCurrent` `{ session }`: the running session with `title`, `space`, `elapsedSeconds` (pauses excluded), or `null` |
| POST | `/api/m/focus/start` | `MFocusStart` `{ taskId?, blockId?, plannedMinutes? }` | `MFocusResult` `{ session }`. A repeat of the same start returns the same session; starting something else while one runs is 409. |
| POST | `/api/m/focus/:id/pause` | – | `MFocusResult` |
| POST | `/api/m/focus/:id/resume` | – | `MFocusResult` |
| POST | `/api/m/focus/:id/end` | `MFocusEnd` `{ outcome: completed\|progress\|interrupted\|abandoned, note?, reason?: rest\|missing_info\|estimate, moreMinutes? }` | `MFocusResult`. `completed` marks the task done; ending twice counts once. |

### Briefings

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/m/briefings/generate` | `MBriefingGenerate` `{ kind: "morning" \| "evening" \| "weekly" }` | `MBriefingGenerated` `{ title, body }` (replaces today's of that kind; `GET /api/m/day` then shows it) |
| POST | `/api/m/briefings/:id/read` | – | `MOk` |

### Existing routes the app uses

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/chat` | Send a message (see Chats). Bearer + CORS. |
| POST | `/api/capture` | Offline capture queue: `{ client_id, raw_text, source?: "text" \| "voice" \| "offline", captured_at? }`; idempotent on `client_id`; suggestions land in the inbox. |
| POST | `/api/voice/session` | Live voice: a single-use ephemeral token for the voice model (never the API key), `{ kind?, conversationId?, resumeHandle?, probe? }`. Then `/api/voice/turn`, `/api/voice/tool`, `/api/voice/end` as the web voice client does (`src/components/voice-session.tsx`). |

## Tests

- `tests/unit/mobile-auth.test.ts`: origins, CORS headers, bearer parsing, and
  the proxy (preflight 204, other origins refused, bearer passes through
  without a redirect, 401 JSON carries CORS, pages and other APIs unchanged).
- `tests/unit/reply-view.test.ts`: receipts (plan rows merged, cards lifted out).
- `tests/integration/mobile-api.test.ts` (local Supabase): real access tokens;
  401 for none/junk/forged/anon; another person sees nothing of yours; chats
  with receipts and cards; task create (idempotent)/group/update/complete/
  uncomplete; place with overlap refusal; day and week (overlaps, free time,
  needs a time, planned minutes); plan day/week; block outcome; inbox accept/
  decline/defer/edit/accept-many; approval with stale revision then approve
  then undo; activity revert; focus start/pause/resume/end/409; briefing
  generate/read; `/api/chat` and `/api/capture` with a bearer token.
- `tests/unit/mobile-api-docs.test.ts`: every route in the router is listed on this page.

Run (cloud sessions hold hosted settings, so always through the wrapper):

```bash
npm run db:start && node scripts/local-env.mjs
scripts/local-only.sh npx vitest run tests/unit/mobile-auth.test.ts tests/unit/reply-view.test.ts tests/unit/mobile-api-docs.test.ts
scripts/local-only.sh npx vitest run tests/integration/mobile-api.test.ts
```

## Hosted changes before release (owner approves; none made yet)

1. **Deploy the server changes**: merge this branch to `main` so Vercel
   deploys it to `www.meetnavi.app`. Additive only: no database migration, no
   new environment variable, the web's behaviour is unchanged. Until it's
   deployed the app gets 401s (the old proxy refuses cookie-less API calls) and
   CORS errors.
2. **Supabase Auth email (sign-in code)**: nothing to change if hosted still
   matches `WORK_PROGRESS.md` (2026-11): custom SMTP (Resend), email OTP length
   **6**, expiry **600 s**, "Magic Link" template subject "Your Navi sign-in
   code" with `{{ .Token }}` (link kept for old sessions). Check in the
   dashboard (Authentication → Emails → Magic Link, and Providers → Email) that
   the template still contains `{{ .Token }}` and the OTP length is 6, since
   the app's code field expects 6 digits. If the template lost the code, set
   it to:
   ```html
   <h2>Your Navi sign-in code</h2>
   <p>Enter this code in Navi to sign in:</p>
   <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
   <p>It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>
   ```
3. **Keep invite-only**: "Allow new users to sign up" stays **off**, "Confirm
   email" **on**, the *Before User Created* hook on. No change; the app passes
   `shouldCreateUser: false` as the web does.
4. **No redirect URLs needed** for code sign-in. (Google sign-in in the app,
   planned later, will need a deep-link redirect URL added in Auth → URL
   configuration and the OAuth client.)
5. Supabase's own API already answers cross-origin calls from any origin, so
   the app's direct `auth` calls need no CORS setting.
