# Navi 1.5 — Desktop Build Handoff

**Status:** Product and engineering brief for Claude Code. **Not** a completed code audit, a completed design, or authorization to deploy production.

## Objective

Start building a reliable, coherent **desktop alpha** now; make it available in an isolated preview for the next testing session if technically feasible. Navi V1 has known reliability problems. The purpose of 1.5 is **a repaired/rebuilt product foundation plus an adaptive companion-first desktop experience**, not a cosmetic makeover.

Do two coordinated tracks **in parallel**:

- **Track A — Audit & Engineering:** inspect the real repository and running systems; reproduce and prioritize failures; repair, refactor or replace architecture whenever necessary; start low-risk work independently of design decisions.
- **Track B — Desktop Design:** collaborate directly with the owner on screen layouts, visual explorations and usable prototypes; obtain approval on major visual decisions. The owner and Claude decide color, typography, character styling and other visuals together.

Integrate these tracks through a shared interaction contract, decision log, and review gates. Do not hold all engineering work hostage to unresolved styling choices.

## Start in this order

1. Read `CLAUDE.md` plus `01_PRODUCT_DIRECTION.md` and `02_DESKTOP_UX.md`.
2. Inspect the repository and current environment, then use `04_V1_AUDIT.md` to make a **fact-based** audit. Avoid reporting assumptions as observations.
3. Open the two tracks described in `06_DESIGN_COLLABORATION.md` and `07_EXECUTION_PLAN.md`. Work in independent areas/worktrees if parallel agents are available; do not let them overwrite one another.
4. Protect data, credentials, production and waitlist per `09_SAFETY_AND_BOUNDARIES.md`.
5. Implement and test the minimum viable *full loop* described in `03_FUNCTIONAL_SCOPE.md` and `08_ACCEPTANCE_AND_QA.md`.
6. Keep the actual, continuously updated status in `WORK_PROGRESS.md` (based on `11_PROGRESS_TEMPLATE.md`).

## Source-of-truth and precedence

1. **User's direct decisions in the active Claude conversation**, especially changes made after this package.
2. **Verified repository behavior and live integration constraints**, as documented in the audit.
3. These specifications for product intent and interaction contracts.
4. Existing V1 implementation only where compatible and demonstrably reliable.

Do not silently discard requirements if a conflict is discovered; record the conflict, options, recommendation and required owner decision.

## Map of the files

| File | Purpose |
|---|---|
| `CLAUDE.md` | Concise persistent operating instructions for Claude Code |
| `01_PRODUCT_DIRECTION.md` | Product identity, non-goals, experience principles |
| `02_DESKTOP_UX.md` | Navigation, panel, companion and focus behavior |
| `03_FUNCTIONAL_SCOPE.md` | Core product flows, priorities and behavior contracts |
| `04_V1_AUDIT.md` | Audit methodology, defect triage and rewrite rules |
| `05_ARCHITECTURE_AND_DATA.md` | Engineering reference architecture, data consistency, AI/voice |
| `06_DESIGN_COLLABORATION.md` | Parallel design workflow and review gates; no prescribed styling |
| `07_EXECUTION_PLAN.md` | Sequenced alpha plan, dependencies, coordination, handoff |
| `08_ACCEPTANCE_AND_QA.md` | Test cases, acceptance criteria, release readiness |
| `09_SAFETY_AND_BOUNDARIES.md` | Production, privacy, migrations, approvals, autonomy |
| `10_DECISIONS_AND_OPEN_QUESTIONS.md` | Locked decisions versus issues to resolve with owner |
| `11_PROGRESS_TEMPLATE.md` | Durable session-resume document template |
| `KICKOFF_PROMPT.md` | Short prompt to paste into Claude Code |

## Important distinction

The owner explicitly authorizes **substantial internal refactoring or replacement** if that is the right fix. Do not preserve broken behavior for the sake of minimizing diffs. This is **not** permission for destructive changes to production data, production deploys, unapproved external actions, billing changes, or exposing secrets.

The target is a verifiable desktop alpha, not an unqualified promise that the full 1.5 system will be finished overnight. Report what truly works, what's unverified, and what's deferred.
