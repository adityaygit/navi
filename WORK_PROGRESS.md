# Navi 1.5 Desktop — WORK_PROGRESS

Resume doc for the 1.5 desktop rebuild. Product brief: the "navi-1.5-desktop-handoff" package (START_HERE, 01–11). Older V1 history: `BUILD_INTELLIGENCE.md`.

## Current checkpoint

- **Date:** 2026-11-06 (session 1 of 1.5)
- **Branch:** `claude/bold-cori-laltf6`. Fast-forwarded to `claude/trusting-rubin-pv5bgh` @ `ef55294` (approval-system work, see below). Baseline `main` = `2b330c9`.
- **Environment:** Claude Code Cloud container. Docker started manually (`dockerd`), local Supabase running (`npm run db:start`), `.env.local` from `scripts/local-env.mjs` (devsim AI, local DB). All tests run through `scripts/local-only.sh` (strips hosted credentials).
- **Preview URL:** NONE yet.
- **Production touched?** No writes. Read-only SQL on hosted to check approval migration state (see P0-PROD-1).
- **Milestone:** M0 done; M1 backend repairs running in a parallel worktree; Track B design round 2 awaiting owner feedback.

## Owner decisions (this pass)

- 2026-11-06: Owner rejected design round 1 as generic ("slop"). Asked for Mobbin-grounded, elite-level references. Round 2 built from Opal (owner's "Navi – Look" board), Linear, Amie, Tana, Claude, Toggl.
- Mobile is out of scope for this phase.
- Approval system from `claude/trusting-rubin-pv5bgh`: integrate, don't rewrite.

## Completed and verified

| Item | Evidence | Status |
|---|---|---|
| Handoff package read (14 files) | — | DONE |
| Local isolated stack (Docker + Supabase, 7 migrations incl. inline_actions) | `supabase start` exit 0 | PASS |
| Approval branch verified locally | tsc OK, eslint OK, vitest **27 files / 243 tests pass** (local DB, devsim) | PASS (unit+integration). Playwright not yet run. |
| Read-only V1 code audit | Subagent report, summarized under Audit findings | DONE |
| Design round 1 (structure prototype + 3 directions) | Artifact canvas | REJECTED by owner (generic) |
| Design round 2 "Night Stone" (Home, Tasks+panel, Planner+docked panel, Focus, Home light) + clickable behavior prototype | Artifact https://claude.ai/artifact/52ooLVKUB77ZxGF1tGH267 | AWAITING OWNER |

## In progress

| Item | Owner | Files | Next |
|---|---|---|---|
| Backend reliability repairs (focus races + pause/resume, capture claim, accept-all honesty, task-create idempotency, chat/voice clientMessageId server side, voice saveTurn res.ok, recovery TZ, error boundaries) | Worktree agent | `src/server/**`, `src/app/api/**`, `(app)/actions.ts`, new migrations, tests | Review + merge its branch, rerun full suite |
| Desktop shell (left nav, persistent Navi panel in layout, Focus override) | Integrator (this session) | `(app)/layout.tsx`, `nav.tsx`, `chat*.tsx`, new shell components | Starts after D1 shell approval for visuals; structure can start now |

## Audit findings / bugs

| Sev | Defect | Evidence | Fix / next |
|---|---|---|---|
| **P0-PROD-1** | Production runs `main` code that writes approval status `pending`/`rejected`/`executed`, but hosted DB already has migration `20261107000001_inline_actions` (check constraint allows only `proposed/approved/executing/completed/declined/failed/expired`; insert policy requires `status='proposed'`). Every approval request in prod (hard deadline, cancel, delete, outside action) should fail. | Hosted `list_migrations` shows inline_actions; constraint read via SQL; `git grep` on origin/main approvals.ts | **Owner decision:** ship the approval branch to prod (merge PR) or roll back the migration. Not done without approval. |
| P1 | Chat + voice are mounted inside `/chat` page; conversation owned by `/chat?c=` URL; leaving the page hangs up voice | `chat.tsx:89-98,291`, `voice-session.tsx:612-621` | Refactor into layout-level Navi panel with client conversation store (M2) |
| P1 | Chat turns not idempotent; retry with null conversation creates new chat + repeats side effects | `server/ai/chat.ts:79-81`, `chat.tsx:182-234` | Server: agent. Client: integrator wires `clientMessageId` |
| P1 | Voice turn saved without checking `res.ok`; `/api/voice/turn` not idempotent | `voice-session.tsx:318-329` | Agent |
| P1 | Capture re-processing duplicates inbox proposals | `api/capture/route.ts:23-26`, `capture.ts:70-91` | Agent |
| P1 | Task create not idempotent; `safe()` masks committed writes as connection errors | `(app)/actions.ts:58`, `client-actions.ts:13-20` | Agent |
| P1 | Re-plan deletes AI-moved blocks, recreates past blocks with new ids, not undoable; no UI to create/move/pin blocks | `replace_day_plan.sql:12-18`, `planner/plan.ts:95,118` | Refactor plan persistence (M3) |
| P1 | Morning tick auto-plans the day without review | `server/jobs/tick.ts:40-46` | Conflicts with "no silent auto-scheduling"; owner call |
| P2 | Focus start/end races, double-counted minutes, no pause | `server/domain/tasks.ts:92-122` | Agent |
| P2 | "Accept all" reports success while items fail | `proposals.ts:284-299` | Agent |
| P2 | No `error.tsx`/`global-error.tsx`; page queries ignore `.error` | `src/app` | Agent (boundaries) |
| P2 | Overlapping events/blocks never flagged | `planner/scheduler.ts` | M3 |
| P2 | Recovery times in browser TZ | `recovery.tsx:38-43` | Agent |
| P2 | AI budget is one global $2/day across all users | `security_hardening.sql:62` | Owner call (per-user cap?) |
| P2 | Date-only due dates stored as UTC midnight / 23:59 local convention | `schemas.ts:8`, `tools.ts:244` | Decide representation (M3) |
| P3 | Home is a KPI dashboard, 12 queries, no continuity | `(app)/page.tsx` | Replace in M2/M3 |
| P3 | Every turn resends full overview (40 tasks, events, memories) on up to 8 iterations | `chat.ts:155-168`, `agent.ts:45` | Trim context later |

## Design review

- **Prototypes presented:** round 1 (rejected); round 2 "Night Stone" on the canvas above.
- **Owner questions open:** dark/light/both; keep stone vs Pebble face; mint as default Navi colour; sidebar labels vs rail.
- **UX contract deviations:** Home shows "Continue" + up to 2 "Later today" rows + 1 insight. "Later today" is extra continuity, flagged for owner.

## Data, migrations and environment

- Hosted Supabase project `gxfkumxjeemceoygtuod`: 7 migrations applied (incl. inline_actions). No changes made this session.
- New migrations: none committed yet (agent may add focus/capture/messages.client_id; local only).
- Env names present in Cloud: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `NAVI_ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `VERCEL_TOKEN`, `TRIGGER_*`. A real Anthropic key is now available (V1 notes said it wasn't); real-model tests should still use a local DB.

## Tests

- 2026-11-06, local, branch @ ef55294: `tsc` OK, `eslint` OK, `vitest run` 27 files / 243 passed.
- Playwright: NOT RUN yet this session.

## Next three actions

1. Merge the backend-repair worktree branch after review; full vitest + Playwright run.
2. Build the persistent layout-level Navi panel + left nav + Focus override (functional, using approved visual tokens once owner picks).
3. Owner decision on P0-PROD-1 (production approval mismatch).

## Continuation prompt

"Resume Navi 1.5 desktop work from `WORK_PROGRESS.md`, read `CLAUDE.md`, verify the current branch and test state, then continue the highest-priority next action. Keep the parallel audit/engineering and owner-guided design tracks coordinated; do not deploy production or assume unverified success."
