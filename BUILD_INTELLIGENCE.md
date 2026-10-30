# Navi Build Intelligence — Persistent Checkpoint

**Purpose:** Development memory for Claude Code (not Navi's end-user memory). Reconcile with code before trusting it.
**Repo:** `https://github.com/adityaygit/navi` · **Latest work:** `claude/dazzling-cray-isusbm` (session 3; contains all of `claude/sharp-keller-moxx93` plus newer commits; no PR open). Each new cloud session gets its own branch name: check out the latest branch, then push to the session's own designated branch.
**Scope rule from owner:** The original cloud session also mounted `/home/user/fairylearn-ai` by mistake. **Never read, modify, or push anything in fairylearn.** Work only in the Navi repo.
**Product source of truth:** `Navi_Product_Spec.md` · **Ops guide:** `docs/OPERATIONS.md` (local dev, tests, hosted Supabase, deploy, env vars, scheduler, spend limits).
**Last checkpoint:** 2026-10-30, session 3 (hosted Supabase + Vercel setup in progress). See `git log -1`.

## ▶ Session 3 status and what's waiting on the owner (2026-10-30)
Done in session 3 (owner approved hosted Supabase setup and Vercel env vars for Production + Preview):
- Credentials re-checked: `NAVI_ANTHROPIC_API_KEY` set (sk-ant-, works), `VERCEL_TOKEN` set (project-scoped: reads/writes project `navi`, can't list teams), `TRIGGER_SECRET_KEY` set but a **dev** key (`tr_dev_`), no project ref.
- `npm run smoke:ai anthropic` → PASS fast (`claude-haiku-5-5`) + planner (`claude-sonnet-5-5`), ≈$0.00008 (run without Supabase vars so nothing touched hosted).
- Full local suite PASS (tsc, lint, vitest 9 files 66/66, build, Playwright 30/30), including after migration `20261101000001_api_privileges`.
- **Hosted Supabase:** migrations `20261030000001` + `20261031000001` applied (Management API; recorded versions fixed to the file versions). Auth: Before-User-Created hook **on** → `navi_before_user_created`; Site URL `https://navi-sand.vercel.app`; redirects for `/auth/callback` + `/auth/confirm` on that domain and `https://navi-*-chairbook.vercel.app` previews.
- **Found:** this hosted project gives `anon`/`authenticated`/`service_role` no SELECT/INSERT/UPDATE/DELETE on new tables (newer Supabase default; local grants them). Even the secret key got "permission denied" → the deployed app could not work. Fixed in repo by migration `20261101000001_api_privileges.sql` (explicit grants + 2 advisor fixes), verified locally, then applied to hosted after the owner approved it separately (version fixed to `20261101000001`).
- Hosted verified: owner email on the invite list (1 email); uninvited sign-up (`…@example.com`) rejected with "Navi is invite-only right now…", 0 users created; anon read of `tasks` → 42501; service role reads tables. `check:deploy` hosted checks all PASS (schema, invite list, admin invited, hook); the only FAILs are this session's local values (`NEXT_PUBLIC_SITE_URL` empty, `.env.local` devsim), both set correctly in Vercel. Security advisor: only Supabase's own `rls_auto_enable` (template event trigger) and the intentional no-policy server-only tables remain.
- **Vercel:** project `navi` (team `chairbook`) was already Git-connected, production branch `main`, domain `navi-sand.vercel.app`. Builds were READY but every route 404'd: no framework preset. Fixed via `vercel.json` (`framework: nextjs`); preview of `1618f78` built with preset `nextjs` and 24 crons accepted. 14 env vars set for Production + Preview (Supabase URL/anon/service, `ANTHROPIC_API_KEY` from `NAVI_ANTHROPIC_API_KEY`, Gemini, `NAVI_AI_PROVIDER=anthropic`, `NEXT_PUBLIC_SITE_URL=https://navi-sand.vercel.app`, fresh `CRON_SECRET` + VAPID keys, `VAPID_SUBJECT=https://navi-sand.vercel.app`, budget $2, `NAVI_BUDGET_TIMEZONE=America/New_York`, admin emails). Secrets are "sensitive" (not readable back); the generated CRON_SECRET/VAPID exist only in Vercel.
- Previews are behind Vercel Authentication (Standard Protection); only the production domain is public, and crons only run on production.
- Scheduler: Trigger.dev can't be deployed from here (needs `tr_pat_` token + project ref + prod key). Owner chose the Vercel Cron fallback: 24 daily jobs, one per UTC hour (Hobby: 100 jobs/project, once/day each, ±59 min).

Waiting on the owner:
1. ~~Apply the grants migration~~ — done.
2. Owner chose a PR to `main`: review and merge it. How the code gets onto production (`navi-sand.vercel.app` currently serves an old 404ing build from `claude/charming-darwin-erd78b`): merge to `main` via PR, or promote the preview deployment. Then `npm run check:deploy -- https://navi-sand.vercel.app`, a real sign-in, and a real-model run of onboarding/capture/planning/voice.

## How to resume in a fresh session ("resume")
1. Check out the latest branch (`claude/dazzling-cray-isusbm` as of session 3); read `Navi_Product_Spec.md`, this file, then `git log --oneline -15` and `git status`.
2. Local stack (container resets kill Docker; see Learnings if `dockerd` complains about a stale pid):
   ```bash
   sudo nohup dockerd > /tmp/dockerd.log 2>&1 &
   npm ci
   npm run db:start          # re-run once if it reports "db not ready"
   npm run env:local         # writes .env.local (local keys, fresh VAPID + CRON secret, simulator); won't overwrite
   ```
3. **Always run tests and local builds through `scripts/local-only.sh`** when the session environment holds hosted/provider settings (it does now). It strips them and uses `.env.local`, and the test helpers refuse any non-local Supabase URL:
   ```bash
   scripts/local-only.sh npx vitest run
   scripts/local-only.sh npx next build
   NAVI_ALLOW_DEVSIM=true scripts/local-only.sh npx next start -p 3000 &
   E2E_BASE_URL=http://localhost:3000 scripts/local-only.sh npx playwright test
   ```
4. Re-check the credential table below (names/lengths only, never print values), then continue from **Exact next steps**.

## Credentials & environment status (re-checked 2026-10-30 ~17:30 UTC, session 2, read-only)
Secrets live only in the cloud environment's settings ("Unrestricted full autonomous" environment → Edit → environment variables). Never in chat, never committed. A session only sees variables set before it started.

| Variable | State in the environment | Verified |
|---|---|---|
| `GEMINI_API_KEY` | set | **Works, real Live session verified.** `npm run smoke:ai gemini` (session 2): ephemeral token minted, live session spoke "OK." in 1.7s, ≈$0.0002. SDK warns token connections are officially `v1alpha`-only; the default endpoint worked — consider `httpOptions: { apiVersion: 'v1alpha' }` in `voice-session.tsx` + smoke script (then update the e2e URL match in `voice-live.spec.ts`), verified with a real session. |
| `SUPABASE_SERVICE_ROLE_KEY` | **fixed** | JWT role `service_role`, ref `gxfkumxjeemceoygtuod`; auth admin API → 200. |
| `SUPABASE_ACCESS_TOKEN` | **fixed** (`sbp_…`) | Management API → 200. Supabase MCP tools load. |
| `NEXT_PUBLIC_SUPABASE_URL` | **fixed** | `https://gxfkumxjeemceoygtuod.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **fixed** | JWT role `anon`, same ref; auth settings → 200. |
| `NAVI_ADMIN_EMAILS` | set | owner's email |
| `VERCEL_TOKEN` | set (session 3) | Project-scoped: project `navi` read/write works; `/v2/user` and teams list refused. |
| `TRIGGER_SECRET_KEY` | set (session 3), **dev** key `tr_dev_` | Can't deploy (needs `tr_pat_` + project ref). |
| `NEXT_PUBLIC_SITE_URL` | empty in the session env | Set in Vercel to `https://navi-sand.vercel.app`. |
| `NAVI_ANTHROPIC_API_KEY` | set, `sk-ant-` (session 3) | **Works:** `smoke:ai anthropic` PASS for haiku + sonnet. Real app flows still unverified. |
| `TZ` | `America/New_York` | Likely the owner's home timezone (confirm; use for `NAVI_BUDGET_TIMEZONE`). |

**Hosted Supabase project state (session 3):** all 3 migrations applied (versions match the files). Invite hook on; Site URL + redirects set for `navi-sand.vercel.app`; Google provider off; invite list = owner email only; 0 auth users. Supabase MCP tools load in session 3.

**Connectors:** no Supabase/Vercel connector in the account; Composio has no Supabase/Vercel account. `.mcp.json` (Supabase MCP) loads only when `SUPABASE_ACCESS_TOKEN` is set at session start.

## Status legend
`not started` · `in progress` · `implemented` (code exists) · `verified` (tested, evidence below) · `blocked` (needs owner)

## V1 roadmap & status

| Workstream | Status | Evidence / notes |
|---|---|---|
| Repo, push access, local dev stack | verified | Pushes land on `claude/charming-darwin-erd78b`. Local Supabase in Docker. |
| Schema + RLS for all user tables | verified | `tests/integration/rls.test.ts`: own rows only, cross-user update/delete/forged insert blocked, anon sees nothing, users can't set approval execution state, allowlist unreadable, `replace_day_plan` can't touch another user's plan. Two migrations: `20261030000001_core_schema`, `20261031000001_replace_day_plan`. |
| Invite-only access (auth hook allowlist) | verified (local) | rls.test "rejects sign-ups not on the invite list". `scripts/allow-email.mjs add/remove/list`. **Hook is off on the hosted project** until configured. |
| Email auth (magic link + password) | verified (password) | e2e signs in via password (auto sign-up for invited emails). Magic link implemented; email delivery not exercised. |
| Google sign-in | blocked | Needs Google OAuth client + provider enabled in Supabase. Button hidden unless `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. |
| Domain layer (entities, activity log + revert, approvals, proposals, memory, tasks, focus) | verified | flows.test: approval boundary (hard-deadline move + delete → approval, duplicate request reused, executes exactly once), Navi cannot mark work done; simultaneous accept/complete create one item. |
| Conversational onboarding → reviewed setup → activation | verified (simulator + **real Claude**, text) | flows.test + e2e (desktop & iPhone). Real run (session 3, Sonnet 5.5): 3 turns → 14 proposals with source quotes/stated-vs-inferred, 0 active rows before approval, activation 2.1 s → week plan. Turn latency 3–4 s, proposal turn ~20 s. Voice onboarding only against the stand-in. |
| Text + voice share one history | verified | flows.test (onboarding), voice-live.spec (chat: voice turn appears in text history). |
| Capture → review inbox → task | verified | flows.test (idempotent on client_id, raw words kept, nothing created until accept, edit-on-accept) + e2e. Dictated capture saves `source=voice`. |
| Offline capture queue + sync | verified (browser) | e2e offline capture → "Waiting to sync" → syncs on reconnect. account.spec: shared browser keeps each person's queue private; cached offline pages cleared on sign-out. offline-actions.spec: buttons offline say they didn't go through, page survives. |
| Planner (day/week, fixed vs flexible, DST) + recovery | verified | Scheduler unit tests incl. DST; recovery keeps unfinished work; blocks settle on finish/cancel/delete; plans written atomically (no double booking); structure.spec plans around a fixed commitment. |
| Tasks: subtasks, priorities, estimates, blockers, recurrence | verified | Recurrence: next occurrence after now at same local time, no duplicates (flows.test "recurring tasks"). |
| UI: Today / Chat / Inbox / Planner / Tasks / Projects & Goals / Insights / Memory / Activity / Settings / More | verified (browser) | core/manage/structure specs on desktop + iPhone 13; a11y.spec axe WCAG 2.2 AA clean (light + dark), no sideways scrolling, ≥44px touch targets on iPhone, zero CSP violations. |
| Persistent memory with provenance | verified | Memory UI e2e; project memory recalled in a new conversation; rejected memories excluded. |
| Strict-but-fair accountability | verified | flows.test pins scoring (rest/interruptions/missing info excluded, partial = half, unmarked flagged, avoidance question). |
| Briefings 06:00/21:00, weekly review, reminders, tick | verified (local) | Unit tests across US DST, +05:30, catch-up; one briefing per local day; reminders respect quiet hours/expiry; overlapping ticks send a push once; failed pushes retry ×2. **No scheduler deployed.** |
| Web push | verified (local), device pending | push.test (real encryption to a local endpoint, VAPID, TTL, 410 cleanup, overlap, retry); pwa.spec (push → notification + deep link). Real push service + iPhone unverified. |
| PWA manifest, service worker, icons | verified (Chromium), device pending | pwa.spec. Home-screen install on a real iPhone unverified. |
| Real-time voice (Gemini Live) | **verified with a real Live session (local)**; device + barge-in pending | Session 3: flite speech via Chromium fake mic → real Live socket (v1beta, ephemeral token OK), audio + transcript reply in ~3–4 s, turn saved to shared history, real `create_task` tool call ran once. Not yet: real barge-in/reconnect, physical iPhone. Stand-in coverage: voice-live.spec + voice-server.test. |
| AI runtime (roles, pricing, $2/day guard, tools, agent loop) | verified with real calls (local) | agent.test (mocked) + session 3 real run: usage recorded per call in ai_usage ($0.123 for the full run: Sonnet onboarding $0.057, Sonnet chat $0.051, Haiku $0.006, Gemini $0.009). |
| Data export + account deletion | verified (browser) | account.spec. |
| Secret protection / access control | verified (local) | No server secret in `.next/static`; only `.env.example` tracked; private APIs 401 signed out; nonce CSP; security headers. Tests can't reach a hosted project (`tests/local-guard.ts`, `scripts/local-only.sh`). |
| CI (`.github/workflows/ci.yml`) | verified | Green on GitHub for `8acf091`, `6beb342`, `bfb32f8` (typecheck, lint, unit, integration on local Supabase, build, Playwright desktop+iPhone with the simulator). |
| Pre-deploy check (`npm run check:deploy`) | verified (local) | Read-only; not yet run against the hosted project (needs URL + keys). |
| Hosted Supabase | verified | All 3 migrations, invite hook, Site URL/redirects, owner invited; uninvited sign-up rejected; check:deploy hosted checks pass. |
| Deployment (Vercel) | in progress | Framework fix + 14 env vars + 24 hourly crons; preview `1618f78` READY (behind Vercel login). Production still the old 404 build until this branch reaches `main` / is promoted. |
| Scheduler | implemented (Vercel Cron fallback) | Hourly via 24 daily jobs; runs only on production. Trigger.dev blocked (needs `tr_pat_` + ref + prod key). |
| Physical iPhone verification | blocked | Needs owner device (install, push, mic). |
| Calendar/Gmail/Drive/GitHub integrations | not started (out of V1 core) | Shown as "not connected"; external approvals fail honestly. |

## Acceptance gates (spec §7) — where each stands
1. Google + email sign-in in a configured environment — email verified locally; **Google blocked; hosted not configured**.
2. Conversational onboarding (text or voice) → review → saved — verified with simulator and **real Claude (text)**; voice onboarding only with stand-in.
3. Capture → proposals → review, survives reload, syncs — verified.
4. Real views with working controls and honest empty states — verified (browser, emulated iPhone).
5. Fixed/flexible blocks, focus, recovery, nothing lost — verified.
6. Memory view/correct/delete with provenance; recall across sessions — verified.
7. Saved 06:00/21:00 briefings, reminders, TZ/DST, quiet hours — verified locally; **no deployed scheduler**.
8. Accountability grounded in real events — verified.
9. Internal autonomy + external approval boundary, failure + duplicate protection — verified.
10. Working real-time voice, interrupt, back to text with tools — **real Gemini Live round trip + tool call verified locally**; real barge-in and device pending.
11. iPhone install, push, offline capture — offline verified; **install/push on a real iPhone pending**.
12. Usage recorded, $2/day guard — verified; real usage recorded in session 3 ($0.12 for a full real-model run).
13. Persistence, secrets, access control, automated checks, mobile usability, deployed preview — all verified locally + CI; **no deployed preview yet**.
14. Resume from repo + checkpoint — this file + `docs/OPERATIONS.md`.

## Real-model run (session 3, local app + local Supabase, real Claude + Gemini Live)
- PASS: text onboarding; planner respects fixed items/availability, invents nothing; voice round trip + tool call; capture → inbox (after fix).
- Fixed (commit `3d72b03`, tests added): incomplete proposals (event without `ends_at`) failed on Accept → now validated at propose time; `*_ref` to an existing id was dropped; vague `update_item` summaries made later turns misremember; literal `**bold**`.
- Open (fix pass in progress): AI can only see today's plan ("tomorrow" answers miss blocks, chat + voice); Haiku answers state questions from history without tools (wrong inbox/duplicate claims); "task on Sunday" overstated (tasks have no do-date); non-fixed routine labelled fixed; display_name not captured; accepted question items vanish; 30-min call split 15+15.
- Scripts/screenshots were in the session scratchpad (not in the repo).

## Test commands & latest results (2026-10-30, session 3 run with migration 20261101000001: same counts, all pass; below is the session 2 handoff run, all via `scripts/local-only.sh`)
- `npx tsc --noEmit` → pass · `npm run lint` → pass.
- `npx vitest run` → **9 files, 66/66 passed** (unit + integration on local Supabase; Claude and Gemini network calls mocked).
- `npx next build` → pass.
- `npx playwright test` (prod build + `NAVI_ALLOW_DEVSIM=true`) → **30/30 passed** (desktop + iPhone 13): account, offline-actions, core, manage, structure, a11y, pwa, voice-live. First run in this container failed `structure.spec` ×2 because the machine is now `TZ=America/New_York` and the app adopts the browser timezone; fixed by pinning the test browser to UTC (`playwright.config.ts` `timezoneId`), then 30/30.
- Not tested: real Claude calls, a real Gemini Live session, hosted Supabase, Vercel deploy, Trigger.dev, Google sign-in, real push service, physical iPhone.
- e2e deletes/recreates seeded `dev@`/`alice@` and its own `*@navi.test` users (local allowlist); password `test-password-123`. Screenshots in `test-results/` (gitignored).

## Agent tooling in the repo
- `.mcp.json`: Supabase MCP for project `gxfkumxjeemceoygtuod` (owner's URL + features), auth header `Bearer ${SUPABASE_ACCESS_TOKEN}` (OAuth browser flow can't run in cloud sessions). Never commit a token.
- `.claude/skills/supabase`, `.claude/skills/supabase-postgres-best-practices` (from `supabase/agent-skills`, pinned in `skills-lock.json`; Markdown only, reviewed). Their feedback flow files a GitHub issue only after asking the owner.
- Schema checked against the skill's security checklist: SECURITY DEFINER invite hook revoked from anon/authenticated/public; owner policies `TO authenticated` + ownership `USING` + `WITH CHECK`; `replace_day_plan` SECURITY INVOKER.
- Scripts: `env:local`, `check:deploy`, `smoke:ai`, `allow-email`, `scripts/local-only.sh`.

## Key decisions
- Next.js 16.4 (Turbopack, `proxy.ts` not middleware), `cacheComponents: false` (all per-user dynamic data).
- One domain layer used by server actions, API routes and AI tools (`src/server/ai/tools.ts`) so chat/voice/UI stay in sync.
- AI never creates inferred commitments directly: `propose_items` → inbox. `create_task` only for explicit commands; `complete_task` only with quoted user statement.
- Planner never invents availability; never moves fixed items; never marks work done. Day plans written by the locked `replace_day_plan` function.
- Models only in `src/server/ai/config.ts` + env: fast=`claude-haiku-5-5`, planner=`claude-sonnet-5-5` (server-side refusal fallbacks "default"), voice=`gemini-3.8-live`. Forced tool_choice is a 400 on Sonnet 5.5 → auto. The backup model is used only if no tool step has run.
- Budget: aggregate across providers in `ai_usage`, day boundary `NAVI_BUDGET_TIMEZONE` (UTC default), override only by `NAVI_ADMIN_EMAILS` (≤$20/day). App guard isn't a hard cap; set provider spend limits.
- Gemini free tier is "used to improve products" → disclosed in Settings/voice UI.
- Client components import server actions from `@/app/(app)/client-actions` (network failures return `{ ok:false }` instead of crashing the page); server components pass originals to `ActionButton`.
- Scheduler: one idempotent `/api/cron/tick`; Trigger.dev task every 10 min calls it (Vercel Hobby cron is daily only).
- Tests run only against local Supabase (guard + wrapper); browser tests run in UTC.

## Learnings
- Supabase auth hooks reload only on full `supabase stop --no-backup` + start.
- Newer hosted Supabase projects don't grant API roles table privileges by default (local does) → grants must be explicit in migrations.
- Hosted PostgREST answers HEAD for a missing table with 204 and no error → existence checks must use GET (`select().limit(0)`).
- Management API `POST /database/migrations` records the apply time as the version; fix to the file version.
- A Vercel project with no framework preset builds Next.js successfully but serves 404 for everything.
- Environment-variable edits can reach a running session (the container restarts); that restart also kills dockerd. A session's first credential check may predate the owner's edit — re-check before declaring a blocker.
- Container resets kill dockerd. If `dockerd` says "process with PID … is still running" but nothing runs: `sudo rm -f /var/run/docker.pid /var/run/docker.sock` then start it again. `npm run db:start` may need a second run ("db not ready").
- Session env vars that exist but are **empty** still block `.env.local` (dotenv and Next.js never override existing variables) → use `scripts/local-only.sh`.
- `pkill -f "next start"` can kill the calling shell; use `fuser -k 3000/tcp`.
- In dev mode, wait for `networkidle` before `context.setOffline(true)`.
- `scrollIntoView` returns a Promise in new Chromium; a concise-arrow effect returning it crashes React cleanup.
- supabase-js bulk insert with differing keys sends NULLs → insert rows separately in tests.
- This Chromium ships an unprefixed `SpeechRecognition`; test stubs must replace both names.
- DevTools `ServiceWorker.deliverPushMessage` occasionally drops a push; pwa.spec redelivers up to 3 times.
- `serviceWorker.controller` is null on first load → the page clears `*-pages` caches itself on sign-out/login.
- A server action that can't reach the server throws; in React 19 that replaced the page with the error screen → handled (see Key decisions).
- Supabase admin `createUser` bypasses the before-user-created hook, so it can't be used to probe the invite hook.
- Concurrency fixes (each with a test that failed first): proposal accept claim, guarded task completion, recurring successor, push claim + retry, locked day plan, voice tool-call dedupe, chat partial-failure honesty, voice mic release on connection loss, voice turn kept on save failure.

## Commits (chronological)
`e400992` handoff docs · `05863b4` scaffold/schema/planner · `095bcc9` AI runtime/capture/auth/shell · `9207241` Today/onboarding/inbox/chat/planner · `361078b` tasks/projects/insights/briefings/tick/push · `92df02a` memory/activity/settings/PWA/voice · `5286be2` build fixes + RLS/flow tests · `967df64` ActionButton refactor + e2e suite · `8d28b26` availability parsing, capture FAB · `7d4e8f2` ops guide, invite script, voice fallback e2e · `dfea149` settle blocks + manage e2e · `0016554` axe a11y + contrast · `6e128d7` owner-only budget override · `ef7992b` goals/projects/routines in setup · `c228123` dictated capture · `157b180` project memory recall · `e5b03bb` accountability tests · `95df9ca` reminder expiry · `4d30a13` briefing DST tests · `f2b7d88` CSP · `3acb55d` time-ordered day view + structure e2e · `afadb63` push delivery + SW tests · `277c611` voice hang-up fix + live voice e2e · `97561de` voice onboarding e2e · `3cbeaf8` phone layout fixes · `22fae22` smoke:ai · `6b83dd3` agent loop tests · `0100d5b` budget test fix · `4aeebff` voice server tests · `16c8aff` shared-device privacy + export/delete e2e · `cf6aac9` record · `df8c562` no-sideways-scroll check · `d0811f1`/`8cfc1d1` check:deploy · `bca0996` recurring-task fixes · `b429943` simultaneous accept/complete · `6d2ba09` push once + retry · `d41e03f` locked day plan (migration `20261031000001`) · `78f5d24` voice tool-call dedupe · `34546fb` chat partial-failure honesty · `8acf091` CI · `6beb342` touch targets · `bfb32f8` voice mic release + mute test · `9e76a96` offline actions don't crash · `0d5e9b9` voice turn kept; push/delete errors · `0151b43` Supabase MCP + agent skills · `9b7c180` handoff (test safety guard, UTC test browser, record, hosted Supabase guide) · **session 2 (`claude/sharp-keller-moxx93`):** accept `NAVI_ANTHROPIC_API_KEY` · `134bbec` checkpoint · **session 3 (`claude/dazzling-cray-isusbm`):** `1618f78` vercel.json (Next.js preset + hourly crons), API-privileges migration, check:deploy HEAD fix · this checkpoint.

## True blockers (owner action needed)
1. ~~Fix Supabase variables~~ — done (verified session 2).
2. Anthropic key as **`NAVI_ANTHROPIC_API_KEY`** in the environment (+ console spend limit). Owner doing this now.
3. Vercel: connect the repo or fill `VERCEL_TOKEN`; choose the URL → `NEXT_PUBLIC_SITE_URL`.
4. Trigger.dev: fill `TRIGGER_SECRET_KEY` + project ref (or accept the Vercel Cron fallback).
5. Google OAuth client (configured in Supabase Auth) for Google sign-in.
6. Owner decisions: further invite-list emails (owner's own email: use `NAVI_ADMIN_EMAILS`); confirm home timezone (environment says America/New_York).
7. Physical iPhone check after deploy: install, push, mic/voice.

## Exact next steps (after the "Job for the next session" above)
1. Re-check credentials (names/lengths only). If Supabase variables are fixed: run `npm run check:deploy` (read-only) to see the hosted gaps.
2. Hosted Supabase setup (owner already asked for it; these are writes to the owner's project — follow `docs/OPERATIONS.md` → "Moving to hosted Supabase"): apply both migrations (`supabase link` + `supabase db push`, or MCP), enable the Before-User-Created hook → `public.navi_before_user_created`, set Site URL + redirect URLs once the app URL is known, add the owner's email to `allowed_emails`. Never run `supabase/seed.sql` on hosted. Verify with `check:deploy` and an uninvited sign-up attempt.
3. `npm run smoke:ai gemini` (fraction of a cent, budget-checked) to open one real Gemini Live session; then `npm run smoke:ai anthropic` once the Anthropic key exists.
4. Run the app locally against real models (`NAVI_AI_PROVIDER=anthropic`) and repeat onboarding/capture/planning/voice flows; record results here.
5. Deploy to Vercel with production env (see OPERATIONS), Trigger.dev tick, then `npm run check:deploy -- https://<app>`.
6. Owner iPhone verification; then Google sign-in.
