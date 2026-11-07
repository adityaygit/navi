# Resume Navi 1.5 in a new session (cloud or local)

Branch: `claude/bold-cori-laltf6`. Everything is committed here. Live design canvas (owner-private): https://claude.ai/artifact/52ooLVKUB77ZxGF1tGH267 — its source is mirrored in `docs/navi-1.5/design-canvas/` (canvas.json + *.dc.html).

## Read in this order
1. `CLAUDE.md` (repo root)
2. `docs/navi-1.5/handoff/START_HERE.md`, `docs/navi-1.5/handoff/CLAUDE.md`
3. `WORK_PROGRESS.md` — bottom sections ("Pause point", "Session 2", latest dated bullets)
4. `docs/navi-1.5/ONBOARDING_PLAN.md`
5. `docs/navi-1.5/design-canvas/V4-Sources.dc.html` (rules for every Navi sentence)

## State at handoff (2026-11-06)
- Tests last run locally: tsc OK, eslint OK, vitest 29 files / 264 passed.
- Design round 4 (Home, Tasks, My day timeline + week Calendar, Navi panel states, ⌘K + task "More details", sentence sources) — DONE, awaiting owner approval.
- Onboarding: plan approved; 11 boards (OB-*.dc.html) DONE, awaiting owner approval.
- No app code changed yet for 1.5 shell/onboarding.

## Open owner decisions (ask before building if unanswered)
1. Approve round 4 + onboarding boards.
2. Calendar opens on Week or last-used view? (default: Week)
3. Keep sidebar search icon for ⌘K? (default: keep)
4. Focus break-through rule: fixed event within 10 min, or hard deadline today? (default: yes)
5. Add two fields locally: task reminder, dismissed suggestions? (default: yes, local migration only)
6. Still open from session 1: P0-PROD-1 (prod approval mismatch) and applying 3 local migrations to hosted. Do NOT touch hosted without asking.

## Next work after approval
1. Onboarding: gate in `src/app/(app)/layout.tsx` (not only Home); full-screen `/welcome` with steps Hello · Basics · Talk · Review · Stay in touch · First plan; resumable via `profiles.preferences.onboarding_step`; login = Google, email 6-digit OTP (no link), optional password; morning briefing default = wake-up time.
2. Desktop shell against real data: left nav, companion Home, persistent layout-level Navi panel, Tasks, My day + Calendar, Focus.
3. Client wiring: chat `clientMessageId`, `newSubmitId()` in task forms, focus pause/resume UI.
4. Fix `scripts/local-env.mjs` on Windows (`execFileSync("npx")` needs `shell: true` on win32).
5. Run Playwright; keep WORK_PROGRESS.md updated; commit + push to this branch.

## Environment setup (cloud)
Start Docker (`dockerd` manually if needed) → `npm ci` → `npm run db:start` → `npm run env:local` → run everything through `scripts/local-only.sh` (e.g. `scripts/local-only.sh npx vitest run`). Use devsim AI, local DB only. No production deploys, no hosted data or migrations without owner approval.

## Design canvas editing
The canvas is a Design-type artifact. To change it: read `project/canvas.json` and the board files from the artifact, edit, publish with `url` + `root`. If the artifact isn't reachable from the session, edit the mirrored files in `docs/navi-1.5/design-canvas/` and tell the owner.
