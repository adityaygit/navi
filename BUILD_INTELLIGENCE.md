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
| Conversational onboarding → reviewed setup → activation | verified (simulator) | flows.test + e2e (desktop & iPhone): greeting → questions → proposals (workspaces/events/tasks/preferences labelled inferred vs stated) → nothing active until approved → partial approve leaves rest in review → week plan generated. Real-model behaviour unverified (no key). |
| Text + voice share one onboarding history | verified (domain) | flows.test "shares one history between text and voice turns". |
| Capture → review inbox → task | verified | flows.test (idempotent on client_id, raw words kept, nothing created until accept, edit-on-accept) + e2e quick capture → inbox → accept → /tasks. |
| Offline capture queue + sync | verified (browser) | e2e: offline capture shows "Saved offline"/"Waiting to sync (1)", syncs after reconnect, appears in inbox. |
| Planner (day/week, fixed vs flexible, DST) + recovery | verified | 10 scheduler unit tests incl. DST; flows.test recovery keeps unfinished work + records disruption; e2e "plan my day" via chat. |
| Today / Chat / Planner / Tasks / Projects & Goals / Insights / Memory / Activity / Settings / More | implemented; core pages browser-tested | e2e covers Today, Onboarding, Inbox, Tasks, Projects, Planner, Chat. Memory/Activity/Insights/Settings render in prod build but have no dedicated e2e yet. |
| Briefings 06:00/21:00, weekly review, deadline reminders, tick job | verified (local) | flows.test briefing once per local day. Manual: `/api/cron/tick` 401 without/with wrong secret; user at local 06:2x got exactly one morning briefing, second tick no-op; quiet hours 05–08 held the notification until 08:00 local. |
| Web push | implemented | VAPID local keys; subscribe/unsubscribe/test routes; notifications recorded `no_subscription` honestly when no device subscribed. Real delivery to a device unverified. |
| PWA manifest, service worker, icons | implemented | Prod build serves manifest/sw.js; offline page. Home-screen install on a real iPhone unverified. |
| Real-time voice (Gemini Live) | implemented, **not delivered** | Ephemeral-token session, shared tools, transcripts saved to the same conversation. No `GEMINI_API_KEY` → never connected to Gemini. e2e verifies the honest fallback ("Real-time voice isn't available … Using basic voice") and that the mic stays off until tapped. Keep open until tested with a key on a device. |
| AI runtime (roles, pricing, $2/day guard, shared tools, agent loop) | implemented; guard verified | flows.test "stops new AI calls at the daily cap". No `ANTHROPIC_API_KEY` → real model calls unverified. Dev simulator labelled, refused in prod unless `NAVI_ALLOW_DEVSIM=true`. |
| Build / typecheck / lint | verified | `npx tsc --noEmit`, `npm run lint`, `npm run build` clean (2026-10-30). |
| Deployment (Vercel) / Trigger.dev | blocked | No Vercel/Trigger.dev credentials in the cloud env. Steps in `docs/OPERATIONS.md`. |
| Physical iPhone verification | blocked | Needs owner device (install, push, mic). Emulated iPhone 13 viewport passes e2e. |
| Calendar/Gmail/Drive/GitHub integrations | not started (out of V1 core) | Shown as "not connected"; external approvals fail honestly ("isn't connected"). |

## Test commands & latest results (2026-10-30)
- `npx vitest run` → 4 files, 31 tests passed (unit + integration; needs local Supabase).
- `npx next build && NAVI_ALLOW_DEVSIM=true npx next start -p 3000` then `E2E_BASE_URL=http://localhost:3000 npx playwright test` → desktop + iPhone 13: onboarding→plan→capture→inbox→task, offline capture sync, voice fallback all passed (6 tests).
- e2e deletes/recreates seeded `dev@`/`alice@` users; all suites use password `test-password-123`.
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

## Local dev quickstart
```
sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
cd /home/user/navi && npm install && npm run db:start   # prints local keys
cp .env.example .env.local   # fill keys from `npx supabase status`; NAVI_AI_PROVIDER=devsim; CRON_SECRET; VAPID keys
npm run dev
```
Seeded allowlist (local only): dev@navi.test, alice@navi.test, bob@navi.test.

## Commits
`e400992` handoff docs · `05863b4` scaffold/schema/planner · `095bcc9` AI runtime/capture/auth/shell · `9207241` Today/onboarding/inbox/chat/planner · `361078b` tasks/projects/insights/briefings/tick/push · `92df02a` memory/activity/settings/PWA/voice · `5286be2` build fixes + RLS/flow tests · `967df64` ActionButton refactor + e2e suite · `8d28b26` availability parsing, capture FAB, e2e fixes · (next) ops guide, invite script, voice fallback e2e

## True blockers (owner action needed)
1. `ANTHROPIC_API_KEY` (and provider spend limit) to verify real chat/onboarding/capture/planning.
2. `GEMINI_API_KEY` + a real device to verify real-time voice.
3. Hosted Supabase project, Vercel project, Trigger.dev project (+ `CRON_SECRET`, VAPID keys) to deploy.
4. Google OAuth client for Google sign-in.
5. A physical iPhone for install, push and mic testing.

## Exact next action
1. e2e coverage for Memory (edit/forget), Activity (approve/reject approval, revert), Settings (schedule save, budget override), Focus start/stop, "My plan broke" from Today.
2. Accessibility pass (axe via Playwright) on core pages; fix violations.
3. Weekly review UI polish + Insights checks; restrict budget override to an admin list (`NAVI_ADMIN_EMAILS`).
4. When keys arrive: write and run a real-model smoke test against Anthropic/Gemini within the $2/day guard and record results here.
