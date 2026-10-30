# Navi Build Intelligence — Persistent Checkpoint

**Purpose:** Development memory for Claude Code (not Navi's end-user memory). Reconcile with code before trusting it.
**Repo:** `https://github.com/adityaygit/navi` · **Dev branch:** `claude/charming-darwin-erd78b` (push verified working 2026-10-30).
**Scope rule from owner:** This cloud session also mounted `/home/user/fairylearn-ai` by mistake. **Never read, modify, or push anything in fairylearn.** Work only in `/home/user/navi`.

## Status legend
`not started` · `in progress` · `implemented` (code exists) · `verified` (tested, evidence below) · `blocked` (needs owner)

## V1 roadmap & status (as of 2026-10-30)

| Workstream | Status | Notes |
|---|---|---|
| Repo, push access, local dev stack | verified | Push OK. Local Supabase via Docker (`sudo dockerd &`, then `npm run db:start`). |
| Schema + RLS for all user tables | implemented | `supabase/migrations/20261030000001_core_schema.sql`. RLS integration test still TODO. |
| Invite-only access (auth hook allowlist) | verified | Non-allowlisted signup → 403; allowlisted → created (curl test vs local GoTrue). Needs full `supabase stop/start` after config changes. |
| Email auth (magic link + password) | implemented | `/login`, `/auth/callback`, `/auth/confirm`, `/auth/signout`. |
| Google sign-in | blocked | Needs Google OAuth client + enabling provider in Supabase project. Button hidden unless `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. |
| Domain layer (entities, activity log, approvals, proposals, memory, tasks/focus) | implemented | `src/server/domain/*`. Navi-actor consequential changes become approvals. |
| Deterministic planner + recovery | verified (unit) | `src/server/planner/scheduler.ts` 10 unit tests incl. DST; `plan.ts` persistence/recovery not yet integration-tested. |
| AI runtime (roles, pricing, $2/day guard, shared tools, agent loop) | implemented | `src/server/ai/*`. No ANTHROPIC_API_KEY in cloud → real model calls unverified. Dev simulator (`NAVI_AI_PROVIDER=devsim`) labelled, refused in prod. |
| Capture → review inbox | implemented | `/api/capture` idempotent on client_id; rule-based labelled fallback when AI unavailable. UI: `/inbox`, `ProposalCard`. |
| Conversational onboarding → reviewed setup | implemented | `/onboarding` chat → propose_items(batch=onboarding) → review → activate + week plan. |
| Today / Chat / Planner pages | implemented | Not yet browser-tested. |
| Tasks / Projects & Goals / Insights / Memory / Activity / Settings / More pages | in progress | Next up. |
| Briefings 06:00/21:00, weekly review, deadline reminders, tick job | not started | Plan: `/api/cron/tick` + Trigger.dev wrapper; DST via luxon. |
| Web push + PWA manifest + service worker | not started | VAPID keys generated into local `.env.local` only. |
| Offline capture queue | implemented | `src/lib/offline-queue.ts` (IndexedDB) + QuickCapture; SW not yet. |
| Real-time voice (Gemini Live) | in progress | Delegated to subagent: `src/app/api/voice/{session,tool,turn}`, `src/components/voice-session.tsx`. No GEMINI_API_KEY → unverifiable; browser-speech fallback labelled. |
| E2E tests / RLS tests / build / lint | not started | Playwright 1.63 preinstalled (use `@playwright/test@1.63.0`). |
| Deployment (Vercel) / Trigger.dev | blocked | No Vercel/Trigger.dev credentials in cloud env. |
| Physical iPhone verification | blocked | Requires owner device. |

## Key decisions
- Next.js 16.4 (Turbopack, `proxy.ts` not middleware), `cacheComponents: false` (all per-user dynamic data).
- One domain layer used by server actions, API routes and AI tools (`src/server/ai/tools.ts`) so chat/voice/UI stay in sync.
- AI never creates inferred commitments directly: `propose_items` → inbox. `create_task` only for explicit commands; `complete_task` only with quoted user statement.
- Planner never invents availability (empty availability ⇒ no flexible blocks + warning); never moves fixed items; never marks work done.
- Models only in `src/server/ai/config.ts` + env: fast=`claude-haiku-5-5` ($0.10/$0.50), planner=`claude-sonnet-5-5` ($2/$10, server-side refusal fallbacks "default"), voice=`gemini-3.8-live` ($0.005/min in, $0.018/min audio out). Forced tool_choice is a 400 on Sonnet 5.5 → use auto.
- Budget: aggregate across providers in `ai_usage`, day boundary `NAVI_BUDGET_TIMEZONE` (UTC default), override table (≤$20/day, owner-approved). App-side guard is not a hard cap; set provider spend limits too.
- Gemini free tier is "used to improve products" → disclose in Settings/voice UI.

## Local dev quickstart
```
sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
cd /home/user/navi && npm install && npm run db:start   # prints local keys
cp .env.example .env.local   # fill NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from `npx supabase status`; NAVI_AI_PROVIDER=devsim
npm run dev
```
Seeded allowlist (local only): dev@navi.test, alice@navi.test, bob@navi.test.

## Commits
- `e400992` handoff docs · `05863b4` scaffold/schema/planner · `095bcc9` AI runtime/capture/auth/shell · `9207241` Today/onboarding/inbox/chat/planner pages

## Exact next action
1. Remaining pages (tasks, projects/goals, insights, memory, activity+approvals, settings incl. budget/push/privacy, more).
2. Integrate voice subagent output; `npx tsc --noEmit`, `npm run lint`, `npm run build`.
3. Briefings/notifications/tick job + push + SW/manifest/icons.
4. RLS isolation integration test, Playwright e2e of onboarding→inbox→plan with devsim.
