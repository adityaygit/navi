# Navi Build Intelligence — Persistent Checkpoint

**Purpose:** A small, reliable development memory for Claude Code. This file is **not** Navi's end-user memory. The repository and product brief are authoritative; reconcile this record with code before trusting it. Claude owns and updates this file as implementation progresses.

## Current verified status

- **As of:** October 29, 2026 (handoff preparation).
- **Repo URL supplied:** `https://github.com/adityaygit/navi` — **user reports repository created**.
- **Not yet inspected in this build environment:** repo contents, Git authentication, push permission, service credentials, source code, tests, or deployment.
- **Implemented/verified application features:** **none evidenced by these handoff files**.
- **First action:** inspect repo; verify development-branch push; audit authorized cloud services and model endpoints; choose first end-to-end vertical slice.
- **Initial external dependencies:** actual GitHub write access, dev Supabase account access, app-provider credentials, Vercel/worker access, Google OAuth configuration, and physical iPhone verification. Treat as **unknown**, not assumed blockers or confirmed successes.

## Full V1 scope to track (create detailed tasks as needed)

| Workstream | Initial status |
|---|---|
| Repo, environment, dev deployment and secrets | Not inspected |
| Google + email sign-in, privacy and per-user data isolation | Not started |
| Text/voice conversational onboarding → reviewed, populated OS | Not started |
| Shared text chat, task extraction and review inbox | Not started |
| Today dashboard, tasks, projects/goals and workspaces | Not started |
| Planner, focus, recovery, schedules and flexible replanning | Not started |
| Persistent inspectable/correctable memory and action log | Not started |
| Strict accountability; 06:00/21:00 briefings and weekly review | Not started |
| Agent tools, approvals, notifications and $2/day test guard | Not started |
| Real-time voice with shared text history and tools | Not started |
| iPhone PWA, web push, offline capture/sync | Not started |
| End-to-end tests, security checks, preview and device verification | Not started |

**Milestone rule:** Distinguish `not started`, `in progress`, `implemented`, `verified`, and `blocked`. Code being present is not proof that a feature works.

## Key product constraints

- Navi is a hybrid dashboard + AI OS; conversational text/voice onboarding builds real user setup after review.
- Review-first capture, internally autonomous planning, external approvals, strict/fair accountability.
- Text and live voice V1; iPhone PWA/push/basic offline V1.
- Default briefing times 06:00 and 21:00 local; configurable quiet hours.
- Google + email auth; private personal-first architecture; basic functional UI.
- Preferred Next.js/Supabase/Vercel/Trigger.dev; app model roles in `Navi_Product_Spec.md`.
- User-selected **$2/day AI testing guard**; do not raise without approval.

## Session checkpoint — replace with real findings

- **Branch / latest pushed commit:** Unknown — inspect.
- **Current task:** Repo access and environment preflight.
- **Completed since last checkpoint:** Handoff documents reviewed only.
- **Verified tests / evidence:** None yet.
- **Meaningful decisions:** Pending actual repo/environment inspection.
- **Lessons or failures:** None yet.
- **True blockers requiring user:** None established; do not assume.
- **Next executable steps:** 1) Inspect; 2) harmless test push; 3) build first real capture → review → persisted task slice.

## Resume protocol

When the user says **"resume"** (even in a new session):

1. Read `CLAUDE.md`, `Navi_Product_Spec.md`, this file, and relevant decision/test notes.
2. Inspect branch, remote, Git status, code, tests, and available credentials without disclosing secrets.
3. Reconcile checkpoint claims with actual evidence; fix inaccuracies.
4. Choose the highest-priority unblocked work and **implement**, verify, and commit/checkpoint it.
5. Preserve decisions, failures and fixes that materially affect later work; don't log trivial noise. Continue until truly blocked or session limits intervene.

Cloud usage/context limits may halt the runner. A new session may need to be started manually; this file makes the **work** resumable, not automatically restarted.
