# Navi 1.5 Desktop — WORK_PROGRESS

Resume doc for the 1.5 desktop rebuild. Product brief: the "navi-1.5-desktop-handoff" package (START_HERE, 01–11). Older V1 history: `BUILD_INTELLIGENCE.md`.

## Current checkpoint

> **Latest: session 3 (cloud, 2026-11-07). See "Session 3" at the bottom.** The block below is the session-1 record.

- **Date:** 2026-11-06 (session 1 of 1.5)
- **Branch:** `claude/bold-cori-laltf6`. Fast-forwarded to `claude/trusting-rubin-pv5bgh` @ `ef55294` (approval-system work, see below). Baseline `main` = `2b330c9`.
- **Environment:** Claude Code Cloud container. Docker started manually (`dockerd`), local Supabase running (`npm run db:start`), `.env.local` from `scripts/local-env.mjs` (devsim AI, local DB). All tests run through `scripts/local-only.sh` (strips hosted credentials).
- **Preview URL:** NONE yet.
- **Production touched?** No writes. Read-only SQL on hosted to check approval migration state (see P0-PROD-1).
- **Milestone:** M0 done; M1 backend repairs running in a parallel worktree; Track B design round 2 awaiting owner feedback.

## Owner decisions (this pass)

- 2026-11-06: Owner on round 2: keep the layout (companion Home, collapsible sidebar, workspace + conversation panel), but it feels corporate/Linear. Wants a premium consumer Life OS: personal tasks, a planner built around a real day, Navi's personality in every workspace, less metadata/density, everyday life (school, hobbies, routines, friends, projects, work). Not childish, colourful or gamified. Opal as inspiration. Blacker blacks. Review before implementation.
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
| Design round 2 "Night Stone" (Home, Tasks+panel, Planner+docked panel, Focus, Home light) + clickable behavior prototype | Artifact https://claude.ai/artifact/52ooLVKUB77ZxGF1tGH267 | Owner: layout good, but too corporate/Linear |
| Design round 3 "Personal Life OS" (Home, Tasks+panel, My day+docked panel): pure black, Figtree, Navi sentence per page, time-of-day task groups, life Spaces, vertical day timeline with free-time suggestions | Same canvas, top row | AWAITING OWNER |
| Backend reliability repairs merged (98e0a9a): focus one-open-session + atomic end + pause/resume; capture claim; honest accept-all; idempotent task create (client id); chat `clientMessageId` + voice `clientTurnId` idempotency (server); voice saveTurn res.ok; recovery profile TZ; error.tsx + global-error.tsx | Integrator re-ran after merge: tsc OK, eslint OK, vitest **29 files / 264 passed** | PASS (local) |

## In progress

| Item | Owner | Files | Next |
|---|---|---|---|
| Client wiring for repairs: send `clientMessageId` from chat, use `newSubmitId()` in task forms, pause/resume in Focus UI | Integrator | chat.tsx, task-form.tsx, focus.tsx | Do with the shell rebuild |
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
- New migrations (LOCAL ONLY, idempotent, non-destructive): `20261108000001_focus_reliability.sql` (paused_at/paused_seconds, closes duplicate open sessions without adding minutes, unique open-session index, focus_* SQL functions), `20261108000002_capture_claim.sql` ('processing' status + claimed_at), `20261108000003_message_client_id.sql` (messages.client_id + unique (user_id, client_id)). **Must be applied to hosted before deploying this code; needs owner approval.**
- chat contract: POST /api/chat `clientMessageId` (uuid). Repeat with saved reply → 200 `replayed:true` (agent not re-run); repeat while running → 409 `turn_in_progress`; earlier attempt died → 409 `turn_incomplete` (resend with new id). Voice: `clientTurnId` on /api/voice/turn; exact repeat → `{ok:true, duplicate:true}`.
- Known caveats: voice cost may be slightly under/over-counted on retries; captures stuck in `processing` only recovered by a later retry (no sweeper).
- Env names present in Cloud: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `NAVI_ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `VERCEL_TOKEN`, `TRIGGER_*`. A real Anthropic key is now available (V1 notes said it wasn't); real-model tests should still use a local DB.

## Tests

- 2026-11-06, local, branch @ ef55294: `tsc` OK, `eslint` OK, `vitest run` 27 files / 243 passed.
- 2026-11-06, local, after merging repairs (98e0a9a + lint ignore a40769e): `tsc` OK, `eslint` OK, `vitest run` 29 files / 264 passed.
- Playwright: NOT RUN yet this session.

## Next three actions

1. Get owner feedback on design round 3; then lock D1 (shell) and build the shell + persistent Navi panel to the approved look. Run Playwright.
2. Build the persistent layout-level Navi panel + left nav + Focus override (functional, using approved visual tokens once owner picks).
3. Owner decision on P0-PROD-1 (production approval mismatch).

## Continuation prompt

"Resume Navi 1.5 desktop work from `WORK_PROGRESS.md`, read `CLAUDE.md`, verify the current branch and test state, then continue the highest-priority next action. Keep the parallel audit/engineering and owner-guided design tracks coordinated; do not deploy production or assume unverified success."

## ▶ Pause point (end of cloud session 1, 2026-11-06) — resume LOCALLY

- Handoff specs saved in `docs/navi-1.5/handoff/` (START_HERE.md, CLAUDE.md, 01–11). Read these first.
- Design canvas source saved in `docs/navi-1.5/design-canvas/` (`.dc.html` artboards + canvas.json). Live canvas: https://claude.ai/artifact/52ooLVKUB77ZxGF1tGH267 (owner-private).
- **Approved direction:** Round 3 (V3-Home, V3-Tasks, V3-Planner = "My Day"): pure black, Figtree, mint Navi stone, Navi sentence per page, time-of-day task groups, life Spaces, vertical day timeline.
- **Owner's round-4 refinements (in progress, only #2/#3 partly applied to V3-Home):**
  1. My Day stays the default timeline, plus a full interactive Day/Week calendar view (toggle "Timeline · Calendar").
  2. Don't repeat the same recommendation in Home headline and action card. (Applied to V3-Home.)
  3. Every contextual sentence must come from real data/actions; Navi only claims an action if it's in activity_log (with Undo). V3-Planner still says "I kept your evening clear for dinner with Maya" — replace with data-derived text, e.g. "A full afternoon. 9 hours planned, 3½ free — most of it before 2."
  4. Navi panel keeps state + workspace awareness when expanded/collapsed (context chip "Looking at: My day · Friday", draft kept, live voice shown on dock, badge for reply/action, Focus auto-collapse holding non-urgent items).
  5. Advanced features via progressive disclosure (task "More details": hard deadline, estimate, repeat, reminder; ⌘K command palette; calendar view) without cluttering default UI.
  Planned new boards: Calendar (week), Panel states, Advanced (⌘K + task details), "Where each sentence comes from" rules. Owner then approves → implement.
- Owner wants it to feel like a personal companion, not a productivity tool. Don't over-redesign what works.
- Still open owner decisions: P0-PROD-1 (prod approval mismatch: ship approval branch vs roll back migration); applying the 3 new local migrations to hosted.

## Session 2 (local, Windows, 2026-11-06) — round 4 design (complete, awaiting approval)

- Local setup verified: Node 22.23, Docker, local Supabase (10 migrations), `.env.local` = local DB + devsim. `npm run env:local` fails on Windows (`execFileSync("npx")` needs `shell: true` on win32); worked around with a preload shim outside the repo. Script fix still TODO.
- Tests: `tsc` OK, `eslint` OK, `vitest run` **29 files / 264 passed** (matches session 1).
- Round 4 published to the live canvas (version 18) and saved in `docs/navi-1.5/design-canvas/`:
  - DONE: V3-Planner sentence now data-derived ("A full afternoon. 9½ hours planned, 3½ free — most of it before 2."); Timeline · Calendar toggle (links to the new board); small ⌘K search icon in the sidebar on Home/Tasks/My day; Tasks panel header "Looking at · Tasks, Today".
  - DONE: `V4-Calendar.dc.html` (week view; Day/Week toggle; all-day row with due chip + birthday; ghost "Dentist call fits" slot; now-line).
  - DONE: `V4-Panel-States.dc.html` (open on My day with context chip, Undo action row and proposal card; same panel after switching to Tasks with draft kept; collapsed dock: draft kept / new badge / live voice with mute + end; Focus: auto-collapsed, "2 waiting", what breaks through).
  - DONE (version 19): `V4-Advanced.dc.html` (⌘K palette with Do / Tasks / Go to / Ask Navi groups over a dimmed page; task card default vs "More details": hard deadline = `tasks.due_is_hard` + `due_at`, estimate = `estimate_minutes`, repeat = `recurrence`, reminder = NEW field, not in schema).
  - DONE (version 19): `V4-Sources.dc.html` (5 rules; 15-row table: where / what Navi says / data it's built from / what happens when data is missing; "Navi never says" list including the old My day line). This is the contract for every page sentence in the build.
  - Canvas layout: row 1 = Home, Tasks, My day Timeline, Calendar; row 2 = Panel states, Advanced, Sources; R2 rows moved down. Stickies list the round-4 changes and the open calls.
- **Round 4 status: AWAITING OWNER APPROVAL.** Open calls for the owner: Calendar opens on Week or the last view used; keep the sidebar search icon for ⌘K; is the Focus break-through rule right (fixed event within 10 min, hard deadline today); OK to add two small fields (task reminder, dismissed suggestions), local first.
- Next after approval: implement the desktop shell against real data (left nav, companion Home, persistent Navi panel, Tasks, My day + calendar, Focus) + client wiring for clientMessageId / newSubmitId / focus pause-resume. Also fix `scripts/local-env.mjs` for Windows.
- 2026-11-06: Owner asked for **onboarding screens before building** (an earlier request was lost between sessions). Plan written to `docs/navi-1.5/ONBOARDING_PLAN.md`: sign-in → one gate in the `(app)` layout → full-screen `/welcome` (Hello · Basics · Talk it through with live "what Navi's picked up" · Review · Notifications · First plan), resumable, "Do this later". **Awaiting owner approval of the plan → then mockups on the canvas.** Shell build waits for both.
- 2026-11-06: Owner approved the onboarding plan + storyboard (invite-only; email = 6-digit code or optional password, no links; wake/bed as own step; notifications during onboarding; **morning briefing defaults to wake-up time**). 11 full-size boards published to the canvas (version 20), saved as `docs/navi-1.5/design-canvas/OB-*.dc.html`, clickable in Play from OB-01. **Awaiting owner approval of the boards and of round 4 → then build** (shell + onboarding gate + `/welcome`).

## ▶ Pause point 2 (2026-11-06, end of local session) — resume in cloud
See `docs/navi-1.5/RESUME_CLOUD.md` for the full resume brief: state, open owner decisions, next work, env setup.

## Session 3 (cloud, 2026-11-07): owner approved round 4 + onboarding; build

### Owner decisions (2026-11-07)
- Approved design round 4 and the 11 onboarding boards. "Keep in mind a Windows version as well." Taken as: the desktop app must feel native on Windows, i.e. Ctrl K / Ctrl J shortcut labels (⌘ on Apple), thin dark scrollbars, installable desktop PWA from Edge/Chrome, scripts that run on Windows. **Ask the owner to confirm this reading.**
- Calendar opens on **Week** by default.
- Focus break-through rule confirmed: a fixed event starting within 10 minutes, or a hard deadline today.
- Two new fields OK, **local migration only**: `tasks.remind_at` (+ `reminded_at`), `dismissed_suggestions`.
- Not asked again / still open: P0-PROD-1; applying the 4 local migrations to hosted; hosted auth email template (below).

### Built and verified (all on the local stack, devsim AI)
| Item | Where | Verified |
|---|---|---|
| Windows fix: `npx` via `shell: true` on win32 | `scripts/local-env.mjs` | Code change only; not run on Windows (no Windows box in cloud) |
| Local migration `20261109000001_reminders_dismissed.sql` (RLS owner-only) + tick sends task reminders once through quiet hours | `supabase/migrations`, `server/jobs/tick.ts` | Applied locally (`supabase migration up --local`); vitest |
| Approved look: pure black, Figtree (self-hosted OFL), mint stone default (Pebble face retired) | `globals.css`, `app/layout.tsx`, `navi-colors.ts` | Screenshots vs boards |
| **Onboarding gate in `(app)/layout.tsx`** (all app URLs; `/settings` allowed), path via `x-pathname` from proxy | `lib/onboarding.ts`, `proxy.ts` | Browser: unfinished user → `/tasks` redirected to `/welcome` |
| **`/welcome`** full screen: Hello · Basics (name, confirmed TZ, wake/bed steppers → quiet hours bed→wake, morning briefing = wake, availability) · Talk (onboarding chat + live "What Navi's picked up" with source words, topic chips, "That's enough for now") · Review (grouped, unsure unchecked, inline edit, "Turn on N and plan my week") · Stay in touch (opt-in push, "Navi never") · First plan (today + data sentence). Resumable via `preferences.onboarding_step`; "Do this later" → skipped; Home shows "Finish setting up" | `app/welcome/*` | Full run in browser with a new account, sign-in → Home (screenshots w-0..w-8) |
| Onboarding prompt: basics known, 4 topics, re-propose full draft as it grows; devsim keeps the live list in sync | `server/ai/prompts.ts`, `devsim.ts` | Integration tests (accuracy/flows/chats) pass |
| **Sign-in**: 6-digit email code (default), optional password, Google; no links; invite-only kept | `app/login/*`, `supabase/templates/magic-link.html`, `config.toml` (otp_expiry 600) | Browser: real code from Mailpit → signed in |
| **Shell**: left nav (Home, Tasks, My day, Inbox, Focus, Spaces with counts, collapsible, user menu with the other V1 pages), **layout-level Navi panel** (conversation + draft + voice survive navigation; "Looking at" chip sent as `viewing`; collapsed dock with draft/new badges and live voice + hang-up; Ctrl/⌘ J), **Ctrl/⌘ K palette** (Do / Tasks / Go to / Ask Navi) | `components/shell/*` | Browser: draft typed on Tasks kept after Home → Focus → Tasks |
| **Home** to V3-Home: greeting + summary, day bar, continue card (open focus / last progress / next due), one insight from a fixed list with remembered "Not now" | `app/(app)/page.tsx`, `components/home/*` | Screenshot vs board |
| Sentence builders for every page line (V4 sources contract) | `lib/sentences.ts` + tests | vitest |
| **Tasks** to V3-Tasks/V4-Advanced (fork): tabs Today/Upcoming/Anytime/Someday (Someday = priority 4), quick-add with day/space chips, time-of-day groups, task card with steps, Focus/Find a time/Ask Navi, More details (hard deadline, estimate, repeat, reminder), one old-task nudge | `app/(app)/tasks`, `components/tasks/*`, `lib/quick-add.ts` + tests | Fork's 15 browser checks; screenshot |
| **My day** timeline + **Calendar** week/day (fork): free gaps with "fits here / Put it there", still-needs-a-time, week grid, all-day row, now-line | `app/(app)/planner`, `components/day/*`, `lib/day-layout.ts` + tests | Fork's browser checks; screenshots |
| **Focus** page: timer, Pause/Resume (focus_pause/resume RPCs), I'm done → outcome/stop reasons, "while you focused", break-through banner; panel auto-collapses with "N waiting" | `app/(app)/focus`, `components/focus/*`, `lib/focus.ts` + tests | Browser: start → pause → resume → end |
| Client wiring: chat `clientMessageId` (reused on retry; 409 `turn_in_progress`/`turn_incomplete` handled), `newSubmitId()` in quick-add, steps and the old task form | `components/chat.tsx`, tasks | tsc/lint; integration tests for the server side |

### Tests (2026-11-07, local)
- `tsc` OK · `eslint` OK · `vitest run` **33 files / 289 passed** (was 29 / 264; new: sentences, quick-add, day-layout, focus break-through).
- Playwright (prod build, `NAVI_ALLOW_DEVSIM=true`, local DB): **58 tests, desktop + iPhone 13**. Last full run 57/58; the one failure was a timing flake in the e2e capture helper (Ctrl K pressed before hydration). The helper now retries, and the affected specs re-ran 6/6 twice. Specs were updated to the 1.5 UI (welcome flow, code sign-in, My day timeline/calendar, Focus page, palette capture).
- Real issues found by e2e and fixed: phone pages were wider than the screen (Home glow, week-strip sr-only text) → `overflow-x: clip` on the main column + positioned day links; axe label/visible-text mismatches (sidebar collapse button, week strip, calendar blocks); grey text contrast on My day/Tasks/Calendar; login link not underlined; phone touch targets (task circle, Start/Mark, chips); "Plan next 7 days" restored on My day; "N days have nothing planned" no longer counts days that have routines.

### Hosted / owner actions still needed (not done; ask first)
1. Apply migrations to hosted: `20261108000001..3` (session 1) and `20261109000001_reminders_dismissed`.
2. Hosted Supabase Auth: magic-link email template must show `{{ .Token }}` (the code), and OTP expiry 600 s, or email sign-in will send a link the app no longer uses. The local template is in `supabase/templates/magic-link.html`.
3. P0-PROD-1 unchanged.

### Known gaps / next
- Mobile: phone bottom dock and `/chat` still work but weren't redesigned (out of scope); Home composer on phones opens `/chat`.
- The waitlist approval email still sends a one-time sign-in link (now lands on `/welcome`); owner may want a code there too.
- Drag-and-drop on My day not built (click "Put it there" / "Place it" instead). "Plan this week" button removed from My day (Navi can still plan the week in chat).
- Old task editing for priority 1/2, project, goal, blocker is only on project pages now.

## Session 3, part 2 (2026-11-07): owner answers → desktop app, hosted setup

### Owner decisions
- **Navi is a desktop app for Windows and Mac. Not for mobile at all.** "Windows version" = a packaged Windows .exe (and Mac app). This supersedes the V1 "iPhone-installable PWA" goal in the root CLAUDE.md.
- **Hosted setup approved** (migrations + sign-in email).

### Done
- Mobile removed from the app: phone bottom dock, keyboard watcher, phone fallbacks; Playwright now desktop only (the PWA/service worker stays: offline capture, notifications in browsers).
- **Desktop app** (`desktop/`, Electron 45): opens the Navi web app at `config.json.url` (now `https://www.meetnavi.app`; `NAVI_APP_URL` overrides; the build workflow takes an `app_url` input). One instance, remembered window size, min 1024×640, Mac hidden-inset title bar, dark, standard menus, offline screen with retry; links to other sites open in the default browser, non-web schemes blocked; microphone/notifications allowed only for Navi; user agent tagged `NaviDesktop/<version>` (server opens sign-in instead of the marketing page). No secrets in the app.
  - Web app side: Google sign-in hidden inside the desktop app (Google blocks embedded sign-in); push reported as not available there.
  - Verified here: unit tests (navigation/permissions, 5/5); the real app driven by Playwright under Xvfb against the local server (sign-in, Home, session kept across launches, external navigation kept out, mic permission); packaged Linux build launches. Windows/Mac installers build in GitHub Actions (`.github/workflows/desktop.yml`), unsigned.
- **Hosted DB** (`gxfkumxjeemceoygtuod`): applied `focus_reliability` and `capture_claim` (before: 0 open focus sessions, so the data fix touched nothing). **Not applied yet:** `message_client_id` (failed: two migrations got the same timestamp version; nothing changed) and `reminders_dismissed` (the Supabase server asked a confirmation question that went unanswered; nothing changed). Hosted version numbers differ from the repo filenames (20261107144803/…804); align before using `supabase db push`.
- **Hosted sign-in email: BLOCKED.** Supabase refuses template changes on the free plan with its built-in mailer. Hosted sends 8-digit codes (expiry 1h) and the email has only a link, so the new 6-digit code screen won't work on hosted yet. Needs: a custom SMTP sender (e.g. Resend with a verified meetnavi.app domain) or a paid Supabase plan. Then set OTP length 6, expiry 600 s, and a template with `{{ .Token }}` (keep the link until 1.5 replaces `main`). Nothing was changed (request rejected as a whole); previous settings saved in the session scratchpad.

### Open / next
- Which address should the desktop app open? Production `www.meetnavi.app` runs `main` (V1 UI) until 1.5 is deployed; deploying 1.5 (or a preview) needs owner approval.
- Desktop notifications (briefings) for the desktop app: Electron has no web push; plan = native notifications from the app while it runs (tray/background), fed by the server.
- Code signing (Windows certificate, Apple Developer ID + notarization) costs money: owner decision. Until then the installers show "unknown publisher" warnings.
- Auto-update (electron-updater + GitHub Releases) once signing is decided.
