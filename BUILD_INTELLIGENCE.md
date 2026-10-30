# Navi Build Intelligence — Persistent Checkpoint

**Purpose:** Development memory for Claude Code (not Navi's end-user memory). Reconcile with code before trusting it.
**Repo:** `https://github.com/adityaygit/navi` · **Dev branch:** `claude/charming-darwin-erd78b` (push verified working 2026-10-30).
**Scope rule from owner:** This cloud session also mounted `/home/user/fairylearn-ai` by mistake. **Never read, modify, or push anything in fairylearn.** Work only in `/home/user/navi`.
**Ops guide:** `docs/OPERATIONS.md` (local dev, tests, deploy steps, env vars, scheduler, spend limits).

## Status legend
`not started` · `in progress` · `implemented` (code exists) · `verified` (tested, evidence below) · `blocked` (needs owner)

## V1 roadmap & status (as of 2026-10-30)

| Workstream | Status | Evidence / notes |
|---|---|---|
| Repo, push access, local dev stack | verified | Pushes land on `claude/charming-darwin-erd78b`. Local Supabase in Docker. |
| Schema + RLS for all user tables | verified | `tests/integration/rls.test.ts`: own rows only, cross-user update/delete/forged insert blocked, anon sees nothing, users can't set approval execution state, allowlist unreadable. |
| Invite-only access (auth hook allowlist) | verified | rls.test "rejects sign-ups not on the invite list". `scripts/allow-email.mjs add/remove/list` tested locally. |
| Email auth (magic link + password) | verified (password) | e2e signs in via password (auto sign-up for invited emails). Magic link implemented; email delivery not exercised in tests. |
| Google sign-in | blocked | Needs Google OAuth client + provider enabled in a Supabase project. Button hidden unless `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. |
| Domain layer (entities, activity log + revert, approvals, proposals, memory, tasks, focus) | verified | flows.test: approval boundary (hard-deadline move + delete → approval, duplicate request reused, executes exactly once), Navi cannot mark work done. |
| Conversational onboarding → reviewed setup → activation | verified (simulator) | flows.test + e2e (desktop & iPhone): greeting → questions → proposals for areas, goals, projects (linked to areas/goals), fixed commitments, routines, tasks and preferences, each labelled stated vs inferred with source quote → nothing active until approved → partial approve leaves rest in review → week plan generated. Real-model behaviour unverified (no key). |
| Text + voice share one onboarding history | verified (domain) | flows.test "shares one history between text and voice turns". |
| Capture → review inbox → task | verified | flows.test (idempotent on client_id, raw words kept, nothing created until accept, edit-on-accept) + e2e quick capture → inbox → accept → /tasks. Voice capture: "Dictate" in quick capture (browser speech recognition) saves `source=voice`; e2e with a stubbed recognizer. |
| Offline capture queue + sync | verified (browser) | e2e: offline capture shows "Saved offline"/"Waiting to sync (1)", syncs after reconnect, appears in inbox. account.spec: on a shared browser, A's unsent capture is neither shown to nor synced into B's account, and syncs to A when A signs back in (test fails with the owner filter removed); cached offline pages are gone after sign-out. |
| Planner (day/week, fixed vs flexible, DST) + recovery | verified | 10 scheduler unit tests incl. DST; flows.test recovery keeps unfinished work + records disruption; finishing/cancelling/deleting a task settles its open blocks (flows.test); e2e "plan my day" via chat, focus → finish, "My plan broke" dialog. |
| Today / Chat / Planner / Tasks / Projects & Goals / Insights / Memory / Activity / Settings / More | verified (browser) | core.spec + manage.spec (desktop & iPhone): Today, Onboarding, Inbox, Tasks, Projects, Planner, Chat, focus, recovery, Memory add/correct/delete, Activity approve → executed, Settings save. a11y.spec: axe WCAG 2.1 A/AA clean on all pages + login, onboarding, capture dialog, light and dark. |
| Persistent memory with provenance | verified | Memory UI e2e; flows.test: a project's memory is recalled in a brand-new conversation when the project is mentioned; rejected memories are not. |
| Strict-but-fair accountability | verified | flows.test pins scoring: rest/interruptions/missing-info excluded, partial = half credit, unmarked counted and flagged, avoidance question asked. Only Navi-proof: Navi can't mark work done. |
| Briefings 06:00/21:00, weekly review, deadline reminders, tick job | verified (local) | Unit: briefing windows across both US DST transitions, +05:30 zone, 3h catch-up, weekly day, custom times, disabled. flows.test: one briefing per local day; reminders held by quiet hours, dropped if they'd arrive after the deadline. Manual: `/api/cron/tick` 401 without/with wrong secret; second tick no-op. |
| Web push | verified (local), device pending | push.test: real sender → local HTTPS push endpoint; payload decrypts (aes128gcm) to exactly what was sent, VAPID-signed, TTL set, 410 device removed. pwa.spec (full Chromium): a delivered push becomes the right notification with its deep link. Notifications without a device are recorded `no_subscription`. Subscribing via a real push service (FCM/APNs) and delivery to an iPhone unverified. |
| PWA manifest, service worker, icons | verified (Chromium), device pending | pwa.spec: manifest (standalone, any + maskable 192/512 PNG icons, capture shortcut); opened pages readable offline, others fall back to /offline. Home-screen install on a real iPhone unverified. |
| Real-time voice (Gemini Live) | client verified against a stand-in; **not delivered** | voice-live.spec (fake mic, stand-in Live socket via Playwright WebSocket routing): ephemeral-token URL, setup, 16 kHz PCM streaming, transcripts, tool calls run by the real server (create without quoted command refused), 24 kHz playback, barge-in, turn saved to the shared chat history, goAway → automatic resume with handle, End voice hangs up; onboarding by voice → proposals → review screen → activation. voice-server.test: session shares text+voice history and memory, same tools as chat (onboarding narrower), token single-use, ≤1 min to start / ≤30 min life, model+instructions+tools locked, resume handle carried, key never returned. Found and fixed: session hung up after the first saved turn; speaker AudioContext now created inside the tap (iOS). Ephemeral tokens are v1beta per current docs (SDK's "v1alpha only" warning is stale). Never connected to real Gemini (no `GEMINI_API_KEY`); keep open until tested with a key on a device. Fallback path also e2e-tested. |
| AI runtime (roles, pricing, $2/day guard, shared tools, agent loop) | loop verified with mocked network; real calls pending | flows.test "stops new AI calls at the daily cap"; only `NAVI_ADMIN_EMAILS` can approve an override (unit test; nobody in production if unset). agent.test: request shape (effort per role, cached system prompt, no forced tool_choice, server-side fallbacks only on Sonnet), real tool execution + tool_result feedback incl. errors, usage recorded for the served model, refusal, planner→backup model on 404, provider error message, budget stop before calling. Request shapes checked against the Claude API reference (2026-10). No `ANTHROPIC_API_KEY` → real model calls unverified (`npm run smoke:ai` ready). Dev simulator labelled, refused in prod unless `NAVI_ALLOW_DEVSIM=true`. |
| Data export + account deletion | verified (browser) | account.spec: `/api/export` returns only the person's rows (every row's user_id checked) as a dated JSON attachment; Settings → type DELETE → Delete everything removes the auth user, profile, tasks and memories, clears unsent captures on the device, lands on /login, and export then returns 401. |
| Secret protection / access control | verified (local) | No server secret in `.next/static` (checked service key, VAPID private key, cron secret); only `.env.example` tracked; every private API route returns 401 signed out; pages redirect to /login; X-Frame-Options DENY, nosniff, referrer policy, permissions policy (mic self only). Nonce-based CSP from `src/proxy.ts` (scripts self+nonce, connect only to app/Supabase/Gemini Live, no framing); a11y.spec asserts zero CSP violations on every page and that the voice worklet loads. |
| Phone layout (no sideways scrolling) | verified (emulated) | a11y.spec checks every main page on desktop and iPhone 13 with long titles and a pasted URL; screenshots reviewed 2026-10-30. |
| CI (GitHub Actions `.github/workflows/ci.yml`) | pending first run | Typecheck, lint, unit, local Supabase + integration, build, Playwright desktop+iPhone with devsim; on push to main/claude/**, PRs, manual. Repo is public, so Actions minutes are free. |
| Build / typecheck / lint | verified | `npx tsc --noEmit`, `npm run lint`, `npm run build` clean (2026-10-30). |
| Pre-deploy check (`npm run check:deploy`) | verified (local) | Read-only. Run against local env (flags devsim, http site, short CRON_SECRET, seeded @navi.test invites) and a production-shaped env (passes; mismatched VAPID pair caught). Live-app checks pass against local prod build. Management API fields (`hook_before_user_created_enabled/_uri`, `site_url`, `uri_allow_list`) confirmed in api.supabase.com/api/v1-json 2026-10-30; not yet run against a hosted project. |
| Deployment (Vercel) / Trigger.dev | blocked | No Vercel/Trigger.dev credentials in the cloud env. Steps in `docs/OPERATIONS.md`. |
| Physical iPhone verification | blocked | Needs owner device (install, push, mic). Emulated iPhone 13 viewport passes e2e. |
| Calendar/Gmail/Drive/GitHub integrations | not started (out of V1 core) | Shown as "not connected"; external approvals fail honestly ("isn't connected"). |

## Test commands & latest results (2026-10-30)
- `npx vitest run` → 9 files, 66 tests passed (unit + integration; needs local Supabase). Includes agent.test (Claude tool loop with only the network call mocked) and voice-server.test (Gemini token minting with only Google's endpoint mocked).
- `npx next build && NAVI_ALLOW_DEVSIM=true npx next start -p 3000` then `E2E_BASE_URL=http://localhost:3000 npx playwright test` → desktop + iPhone 13, 26 tests (latest 26/26 passed after 16c8aff): account.spec (shared-device capture privacy, export, deletion), core.spec (onboarding→plan→capture→inbox→task, offline sync, voice fallback, dictated capture), manage.spec (focus, recovery, memory, approvals, settings), structure.spec (goals/projects/milestones, planning around a fixed commitment), a11y.spec (axe light + dark, zero CSP violations), pwa.spec (manifest, push → notification, offline pages), voice-live.spec. pwa/voice specs use the full-Chromium channel (headless shell denies notifications).
- e2e deletes/recreates seeded `dev@`/`alice@` and its own `e2e-*`/`a11y-*@navi.test` users (added to the local allowlist by the tests); all use password `test-password-123`. Each test can run alone.
- Screenshots land in `test-results/` (gitignored).

## Key decisions
- Next.js 16.4 (Turbopack, `proxy.ts` not middleware), `cacheComponents: false` (all per-user dynamic data).
- One domain layer used by server actions, API routes and AI tools (`src/server/ai/tools.ts`) so chat/voice/UI stay in sync.
- AI never creates inferred commitments directly: `propose_items` → inbox. `create_task` only for explicit commands; `complete_task` only with quoted user statement.
- Planner never invents availability (empty availability ⇒ no flexible blocks + warning); never moves fixed items; never marks work done.
- Models only in `src/server/ai/config.ts` + env: fast=`claude-haiku-5-5` ($0.10/$0.50), planner=`claude-sonnet-5-5` ($2/$10, server-side refusal fallbacks "default"), voice=`gemini-3.8-live` ($0.005/min in, $0.018/min audio out). Forced tool_choice is a 400 on Sonnet 5.5 → use auto.
- Budget: aggregate across providers in `ai_usage`, day boundary `NAVI_BUDGET_TIMEZONE` (UTC default), override table (≤$20/day). App-side guard is not a hard cap; set provider spend limits too.
- Gemini free tier is "used to improve products" → disclosed in Settings/voice UI.
- Server actions are passed to client `ActionButton` by reference + `args` (closures can't cross the server/client boundary).
- Scheduler: one idempotent `/api/cron/tick`; Trigger.dev task every 10 min calls it. Vercel Hobby cron (daily) is insufficient.

## Learnings
- Supabase auth hooks reload only on full `supabase stop --no-backup` + start.
- Container resets kill dockerd: `sudo nohup dockerd > <log> 2>&1 &` then `npm run db:start` (re-run once if it reports "db not ready").
- `pkill -f "next start"` can kill the calling shell; use `fuser -k 3000/tcp`.
- In dev mode, wait for `networkidle` before `context.setOffline(true)` or hydration chunks never load.
- `scrollIntoView` returns a Promise in new Chromium; a concise-arrow effect returning it crashes React cleanup.
- supabase-js bulk insert with rows that omit different keys sends NULL for the missing ones (column defaults don't apply) → insert rows separately in tests.
- This Chromium ships an unprefixed `SpeechRecognition`; test stubs must replace both names.
- DevTools `ServiceWorker.deliverPushMessage` occasionally drops a push (~3/8 runs in one batch); pwa.spec redelivers up to 3 times (30/30 then passed on first delivery).
- Recurring tasks: the next occurrence is the first one after now at the same local time (finishing late no longer creates overdue copies); completing an already-done task is a no-op, so a double tap or voice+UI can't spawn two successors (flows.test "recurring tasks", written failing first).
- Simultaneous repeats: accepting a proposal claims it atomically (status flip guarded on the previous status, undone if creating the item fails); completing a task is a guarded update (`updateEntity` `unless`), so two requests at once create one item / one next occurrence (flows.test "simultaneous repeats", failed before).
- Push delivery claims each notification (attempts bumped from the value read) so overlapping scheduler runs send it once (push.test, failed before: 2 deliveries). Failed deliveries retry after 5 and 10 minutes, then become `failed` (previously never retried).
- Day plans are written by `replace_day_plan(p_user, p_day, p_blocks)` (migration `20261031000001`): security invoker (RLS applies), per-user-per-day advisory lock, replaces Navi's planned flexible blocks and inserts the new ones in one transaction. Two simultaneous runs used to leave a double booking (flows.test, failed before). rls.test: another user or anon can't use it on someone's plan. **Hosted deploy must `supabase db push` this migration.**
- Voice: tool results are cached by call id in the client, so a call the Live service sends again isn't run twice (voice-live.spec). A dropped connection during a tool call no longer claims "Nothing was changed"; it says it may or may not have gone through.
- Chat loop: if the provider fails after a tool step already ran, the turn is not restarted on the backup model (that could repeat actions); the reply lists what was done. A refusal after earlier steps no longer says "Nothing was changed" (agent.test, failed before).
- `serviceWorker.controller` is null on a page's first load, so privacy clean-up must not rely only on messaging the worker; the page clears `*-pages` caches itself.

## Local dev quickstart
```
sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
cd /home/user/navi && npm install && npm run db:start   # prints local keys
npm run env:local            # writes .env.local from local Supabase + fresh VAPID/CRON secrets (devsim)
npm run dev
```
Seeded allowlist (local only): dev@navi.test, alice@navi.test, bob@navi.test.

## Commits
`e400992` handoff docs · `05863b4` scaffold/schema/planner · `095bcc9` AI runtime/capture/auth/shell · `9207241` Today/onboarding/inbox/chat/planner · `361078b` tasks/projects/insights/briefings/tick/push · `92df02a` memory/activity/settings/PWA/voice · `5286be2` build fixes + RLS/flow tests · `967df64` ActionButton refactor + e2e suite · `8d28b26` availability parsing, capture FAB, e2e fixes · `7d4e8f2` ops guide, invite script, voice fallback e2e · `dfea149` settle blocks on task finish/cancel/delete + manage e2e · `0016554` axe a11y + contrast · `6e128d7` owner-only budget override · `ef7992b` goals/projects/routines in setup · `c228123` dictated capture · `157b180` project memory recall · `e5b03bb` accountability tests · `95df9ca` reminder expiry · `4d30a13` briefing DST tests + record · `f2b7d88` CSP · `3acb55d` time-ordered day view + structure e2e · `afadb63` push delivery + SW tests · `277c611` voice hang-up fix + live voice e2e · `97561de` voice onboarding e2e · `3cbeaf8` phone layout fixes · `22fae22` smoke:ai script · `6b83dd3` agent loop tests · `0100d5b` budget test fix · `4aeebff` voice server tests · `16c8aff` shared-device privacy + export/delete e2e · `cf6aac9` record · `df8c562` no-sideways-scroll check + Tasks filters · `d0811f1`/`8cfc1d1` check:deploy · `bca0996` recurring-task fixes · `b429943` simultaneous accept/complete guards · `6d2ba09` push sent once across overlapping ticks + retry · `d41e03f` locked day-plan replacement (migration 20261031000001) · `78f5d24` voice tool calls deduplicated by id · (this) chat loop partial-failure honesty

## True blockers (owner action needed)
Secrets go in the cloud environment's settings (environment menu → Edit) as env vars, never in chat. Full list given to owner 2026-10-30:
1. `ANTHROPIC_API_KEY` (+ a console spend limit) → verify real chat/onboarding/capture/planning (`npm run smoke:ai`).
2. `GEMINI_API_KEY` (AI Studio) → verify `gemini-3.8-live` real-time voice.
3. Hosted Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` (to push migrations).
4. Vercel: owner connects the repo, or `VERCEL_TOKEN`; chosen URL → `NEXT_PUBLIC_SITE_URL`.
5. Trigger.dev `TRIGGER_SECRET_KEY` + project id (or accept Vercel Cron fallback). `CRON_SECRET`/VAPID keys can be generated by Claude.
6. Google OAuth client (configured in Supabase Auth) for Google sign-in.
7. Owner decisions: invite-list emails, `NAVI_ADMIN_EMAILS`, home timezone (`NAVI_BUDGET_TIMEZONE`).
8. Physical iPhone check after deploy: install, push, mic/voice.
Network check 2026-10-30: api.anthropic.com, generativelanguage.googleapis.com, api.vercel.com, api.supabase.com, api.trigger.dev all reachable from the cloud env.

## Exact next action
1. Phone-width review done (a11y.spec now fails on sideways scrolling, saves `test-results/phone/*.png`). Next: make deployment a single scripted step once hosted credentials arrive (migrations push, VAPID/CRON secret generation, Trigger.dev deploy), verified as far as possible without credentials.
2. When hosted credentials arrive: `npm run check:deploy -- https://<app>` until clean. When AI keys arrive: run `npm run smoke:ai` (written, fails cleanly without keys; budget-checked, records usage), then run the app with `NAVI_AI_PROVIDER=anthropic` and repeat the core e2e flows manually with the real model; record results here.
