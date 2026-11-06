# Navi UI rebuild: overnight build plan

Status: **planned, not started.** Starts only when the owner says go.
Design source: canvas page "v5 · Landing style" (https://claude.ai/artifact/6HUenJGa1yifXfT9YKHJNZ) and `docs/REDESIGN_PLAN.md` → "Decisions so far".
Rule for the whole run: **change how the app looks and presents real data. Never fake data, never drop working behaviour, never skip or delete a test to get green.**

## What "done by morning" means
1. Every screen in the app uses the new look (not only the three mocked screens).
2. Today, Navi chat and Insights match the v5 mockups closely, on phone and desktop.
3. Chat shows Navi's actions as live steps and cards.
4. Full test suite green (typecheck, lint, unit, integration, Playwright desktop + iPhone, axe accessibility).
5. Screenshots of every screen at phone and desktop width are attached to the PR.
6. It is visible to the owner in the way the owner chose (PR + preview, or merged to production).

## The design system (built first, used everywhere)
- **Tokens** in `src/app/globals.css`, taken from `landing/src/styles.css`: background `#060608` with soft glows (the final 10%-lower values from v5) and grain, text `#f2f2f2 / #a3a5aa / #6c6f76`, hairlines, radii 14px surfaces / 8px controls / pill actions.
- **Meaning colours only:** fixed `#f0f0f0`, flexible `#8fb8ff`, focus `#5fd39a`, recovery `#f2c46b`, clash `#ff8f8a`. Navi amber `#F5A83A` only for Pebble and Navi's own badge.
- **Area colours:** `workspaces.color` already exists in the schema. Use it when set; otherwise a stable colour picked from a fixed palette by workspace id. No migration.
- **Surfaces:** `surf` (translucent card), `lg` (liquid glass: follow-through, approvals, Navi's panel and composer, the dock), `glass` (chips and floating controls).
- **Font:** Instrument Sans, self-hosted through `next/font` so the strict CSP still holds.
- **Pebble component:** SVG with the eight states (idle, listening, working, speaking, done, needs your OK, gentle nudge, quiet hours). Animations are off under reduced motion.
- **Dark only** for this pass (the landing page is dark-only). Light theme can come later.
- **Photography:** `horizon.jpg` and `wall-dawn.jpg` copied from the landing into `public/img/`, served optimised.

## Order of work
| # | Step | Who | Done when |
|---|---|---|---|
| 0 | Set up: `npm ci`, start Docker + local Supabase, run the full suite on the current code as a baseline | lead | baseline results recorded |
| 1 | Foundation: tokens, font, surfaces, Pebble, app shell (desktop top nav, phone glass dock with Today, Navi, Inbox, Planner, Insights + More) | lead | every page renders in the new shell; suite green; commit |
| 2 | Today (phone + desktop) to match v5 | subagent A | matches mockup, real data, tests green |
| 3 | Navi chat: streamed action steps + cards, approval card, glass composer, voice screen with Pebble | subagent B | live steps show for a real turn and survive reload; tests green |
| 4 | Insights + daily/weekly review screens | subagent C | real numbers from the existing review code, honest "not enough data" states |
| 5 | Inbox, Planner, Tasks, Projects & goals | subagent D | restyled, all controls still work |
| 6 | Memory, Notes, Activity, Settings, Onboarding, Login, Early access, Admin waitlist | subagent E | restyled, all controls still work |
| 7 | Integration: merge, full suite, axe contrast on glass, no sideways scroll, 44px touch targets, reduced motion | lead | all green |
| 8 | Screenshots of every screen (390px and 1440px), PR, BUILD_INTELLIGENCE update | lead | PR open with evidence |

Steps 2 to 6 run in parallel. Each subagent works in its own git worktree on its own files. The lead owns the shared files (tokens, shell, Pebble) and merges results one at a time, running the suite after each merge.

## Data the new screens need, and where it comes from
- **Follow-through and its parts (Done, Focus, On time):** derived from the existing day review and week insights (planned vs done minutes, focus minutes, deadlines met). The "how it's worked out" text says exactly that. If a week has too little data, show "Not enough days yet" and no score.
- **Deep work by area:** focus sessions → task → project → workspace. If a session has no area, show "Other".
- **Live chat steps:** the chat API currently returns one finished reply. It becomes a streamed response (server-sent events) that sends each tool step as it starts and finishes, then the reply. Saved history keeps the same `tool_events`, so reload shows the same cards. This is the only backend change in the run.

## Safety rails
- Commit after every step to `claude/blissful-goodall-6u0obg` and push. Never force-push.
- No production deploy, no migration on the hosted database, no merge to `main` unless the owner said so.
- If a test fails because visible copy changed, update the test to the new copy. If it fails because behaviour changed, fix the code.
- Tests always run through `scripts/local-only.sh` (never against hosted Supabase).
- If the session stops: `BUILD_INTELLIGENCE.md` holds the step reached, so "resume" continues from there.
